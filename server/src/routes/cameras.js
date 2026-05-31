import { Router } from 'express';
import path from 'path';
import { networkInterfaces } from 'os';
import { Socket } from 'net';
import { existsSync, promises as fs, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import { pool } from '../db/index.js';
import {
  startCamera, startHlsStream, stopHlsStream, heartbeatStream,
  pauseCamera, resumeCamera,
  stopCamera,  getState,    getAllStates,
  detectCameraStreamUrl, scanLocalNetworkForCameraStreams,
  RECORDINGS_DIR,
  deleteRecording,
  deleteAllRecordings,
  getRecordingsRetentionDays,
  triggerMotionRecording,
  setPiWaiting,
} from '../camera/manager.js';
import { createAlert } from '../alerts/service.js';
import { requestPiWake, requestPiSleep } from './cameraNodes.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getHostFromStreamUrl, maskStreamUrl } from '../utils/streamUtils.js';

const router = Router();
const DISCOVERY_TTL_MINUTES = Number(process.env.CAMERA_DISCOVERY_TTL_MINUTES || 10);
const ENABLE_SCAN_FALLBACK = process.env.CAMERA_DISCOVERY_ENABLE_SCAN_FALLBACK !== 'false';
const MOTION_ACTIVE_WINDOW_SECONDS = Number(process.env.CAMERA_NODE_MOTION_WINDOW_SECONDS || 20);

function normalizeDiscoveryPayload(body = {}) {
  const host = String(body.host || body.ip || '').trim();
  const streamUrl = String(body.streamUrl || body.rtsp_url || '').trim();
  const deviceId = String(body.deviceId || body.device_id || host || '').trim();
  const name = String(body.name || body.hostname || body.deviceName || deviceId || 'Caméra Réseau').trim();
  const location = String(body.location || '').trim();
  const model = String(body.model || '').trim();
  const source = String(body.source || 'announce').trim() || 'announce';

  if (!host || !streamUrl || !deviceId) return null;

  return {
    deviceId,
    name,
    host,
    streamUrl,
    location,
    model,
    source,
  };
}

function isMotionActive(lastMotionAt) {
  if (!lastMotionAt) return false;
  const timestamp = new Date(lastMotionAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= MOTION_ACTIVE_WINDOW_SECONDS * 1000;
}

function serializeCamera(camera, node = null) {
  return {
    ...camera,
    rtsp_url: maskStreamUrl(camera.rtsp_url),
    motionActive: node ? isMotionActive(node.last_motion_at) : false,
    lastMotionAt: node?.last_motion_at || null,
    nodeDeviceId: node?.device_id || null,
    ...getState(camera.id),
  };
}

async function getCameraNodesByHost() {
  const { rows } = await pool.query('SELECT device_id, host, last_motion_at FROM camera_nodes');
  return new Map(rows.map(row => [row.host, row]));
}

function normalizeCreateCameraPayload(body = {}) {
  const name = String(body.name || '').trim();
  const location = String(body.location || '').trim();
  const rtspUrl = String(body.rtsp_url || body.streamUrl || '').trim();
  if (!name || !rtspUrl) {
    return { ok: false, error: 'Nom et URL RTSP requis' };
  }

  return {
    ok: true,
    name,
    rtspUrl,
    location,
    discoverySource: 'manual',
  };
}

async function upsertDiscovery(payload) {
  const normalized = normalizeDiscoveryPayload(payload);
  if (!normalized) return null;

  const { rows } = await pool.query(
    `INSERT INTO camera_discoveries (device_id, name, host, stream_url, location, model, source, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (device_id) DO UPDATE SET
       name = EXCLUDED.name,
       host = EXCLUDED.host,
       stream_url = EXCLUDED.stream_url,
       location = EXCLUDED.location,
       model = EXCLUDED.model,
       source = EXCLUDED.source,
       last_seen_at = NOW()
     RETURNING *`,
    [normalized.deviceId, normalized.name, normalized.host, normalized.streamUrl, normalized.location, normalized.model, normalized.source]
  );

  return rows[0] || null;
}

async function getPreferredScanHosts() {
  const preferred = new Set();
  const add = (host) => {
    const value = String(host || '').trim();
    if (value) preferred.add(value);
  };

  const [discoveriesResult, camerasResult] = await Promise.all([
    pool.query(
      `SELECT host
       FROM camera_discoveries
       ORDER BY last_seen_at DESC
       LIMIT 25`
    ),
    pool.query(
      `SELECT rtsp_url
       FROM cameras
       ORDER BY created_at DESC
       LIMIT 25`
    ),
  ]);

  discoveriesResult.rows.forEach(row => add(row.host));
  camerasResult.rows.forEach(row => add(getHostFromStreamUrl(row.rtsp_url)));

  return [...preferred];
}

async function deleteExpiredDiscoveries() {
  await pool.query(
    `DELETE FROM camera_discoveries
     WHERE last_seen_at < NOW() - ($1::int * INTERVAL '1 minute')`,
    [DISCOVERY_TTL_MINUTES]
  );
}

// GET /api/cameras — liste + état live
router.get('/', async (req, res) => {
  try {
    const [camerasResult, nodeMap] = await Promise.all([
      pool.query('SELECT * FROM cameras ORDER BY id'),
      getCameraNodesByHost().catch(() => new Map()),
    ]);
    const result = camerasResult.rows.map(cam => {
      const host = getHostFromStreamUrl(cam.rtsp_url);
      return serializeCamera(cam, nodeMap.get(host));
    });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras — ajouter
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const normalized = normalizeCreateCameraPayload(req.body);
  if (!normalized.ok) {
    return res.status(400).json({ error: normalized.error || 'Parametres camera invalides' });
  }

  const { name, rtspUrl, location, discoverySource } = normalized;
  try {
    const { rows } = await pool.query(
      'INSERT INTO cameras (name, rtsp_url, location) VALUES ($1,$2,$3) RETURNING *',
      [name, rtspUrl, location || '']
    );
    const camera = rows[0];
    // Démarre en mode veille (pas de FFmpeg) — le stream démarre sur demande de l'utilisateur
    await startCamera(camera).catch(err => console.error('[CAM ADD START]', err));
    req.app.get('go2rtc:register')?.(camera.id, rtspUrl)
      .catch(err => console.error('[go2rtc ADD]', err));
    const host = getHostFromStreamUrl(rtspUrl);
    if (host) {
      await upsertDiscovery({
        deviceId: `manual:${host}`,
        name,
        host,
        streamUrl: rtspUrl,
        location: location || '',
        source: discoverySource,
      }).catch(err => console.error('[CAM DISCOVERY UPSERT]', err));
    }
    const nodeMap = await getCameraNodesByHost().catch(() => new Map());
    res.status(201).json(serializeCamera(camera, nodeMap.get(host)));
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/announce — annonce d'une ESP32-CAM au démarrage
router.post('/announce', async (req, res) => {
  const payload = normalizeDiscoveryPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'deviceId, host et streamUrl sont requis' });
  }

  try {
    const discovery = await upsertDiscovery(payload);

    res.status(200).json({
      message: 'Annonce enregistrée',
      discovery,
    });
  } catch (err) {
    console.error('[CAM ANNOUNCE]', err);
    res.status(500).json({ error: 'Erreur serveur lors de l’annonce' });
  }
});

// GET /api/cameras/discoveries — liste des ESP32-CAM + noeuds Pi vus récemment
router.get('/discoveries', async (_req, res) => {
  try {
    await deleteExpiredDiscoveries();
    const [discResult, nodesResult] = await Promise.all([
      pool.query(
        `SELECT id, device_id, name, host, stream_url, location, model, source, last_seen_at, created_at
         FROM camera_discoveries
         ORDER BY last_seen_at DESC, created_at DESC`
      ),
      pool.query(
        `SELECT id, device_id, name, host, stream_url, location, model, source, last_seen_at, created_at
         FROM camera_nodes
         WHERE last_seen_at > NOW() - INTERVAL '${DISCOVERY_TTL_MINUTES} minutes'
         ORDER BY last_seen_at DESC`
      ),
    ]);

    const seen = new Set(discResult.rows.map(r => r.host));
    const piNodes = nodesResult.rows
      .filter(r => !seen.has(r.host))
      .map(r => ({ ...r, source: r.source || 'pi-node' }));

    const devices = [...discResult.rows, ...piNodes]
      .sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));

    res.json({ ttlMinutes: DISCOVERY_TTL_MINUTES, devices });
  } catch (err) {
    console.error('[CAM DISCOVERIES]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture des appareils détectés' });
  }
});

// GET /api/cameras/discover?host=192.168.0.101
// GET /api/cameras/discover          -> recherche automatique sur le réseau local
router.get('/discover', requireAuth, async (req, res) => {
  const host = String(req.query.host || '').trim();
  const abortController = new AbortController();
  const startedAt = Date.now();
  req.on('close', () => abortController.abort());
  try {
    if (host) {
      console.log(`[CAM DISCOVER] détection ciblée pour ${host}`);
      const streamUrl = await detectCameraStreamUrl(host, abortController.signal, { probeRtsp: true });
      if (!streamUrl) return res.status(404).json({ error: 'Aucun flux trouvé pour cette adresse' });
      await upsertDiscovery({
        deviceId: `probe:${host}`,
        name: `Caméra ${host}`,
        host,
        streamUrl,
        source: 'probe',
      }).catch(err => console.error('[CAM DISCOVER UPSERT]', err));
      console.log(`[CAM DISCOVER] flux trouvé pour ${host} en ${Math.round((Date.now() - startedAt) / 1000)}s -> ${streamUrl}`);
      return res.json({ streamUrl });
    }

    if (!ENABLE_SCAN_FALLBACK) {
      return res.status(404).json({
        error: 'Le scan réseau est désactivé sur le serveur (CAMERA_DISCOVERY_ENABLE_SCAN_FALLBACK).',
      });
    }

    const preferredHosts = await getPreferredScanHosts().catch(() => []);
    console.log(`[CAM DISCOVER] Lancement du scan réseau (${preferredHosts.length} hôtes prioritaires)`);
    const scanResults = await scanLocalNetworkForCameraStreams({
      signal: abortController.signal,
      preferredHosts,
    });
    if (!scanResults.length) return res.status(404).json({ error: 'Aucune caméra trouvée sur le réseau local' });
    await Promise.all(scanResults.map(result => (
      upsertDiscovery({
        deviceId: `probe:${result.host}`,
        name: `Caméra ${result.host}`,
        host: result.host,
        streamUrl: result.streamUrl,
        source: 'probe',
      }).catch(err => console.error('[CAM DISCOVER UPSERT]', err))
    )));
    console.log(`[CAM DISCOVER] ${scanResults.length} flux trouvé(s) via scan en ${Math.round((Date.now() - startedAt) / 1000)}s`);
    return res.json({ results: scanResults, preferredHostsUsed: preferredHosts.length, method: 'scan' });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('[CAM DISCOVER]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la découverte' });
  }
});

// GET /api/cameras/scan — Scan rapide MediaMTX (Pi Zero 2W) sur le réseau local
router.get('/scan', requireAuth, async (req, res) => {
  const foundCameras = [];
  const port = 9997;
  const auth = process.env.MEDIAMTX_USER
    ? Buffer.from(`${process.env.MEDIAMTX_USER}:${process.env.MEDIAMTX_PASSWORD || ''}`).toString('base64')
    : null;

  // Détection dynamique des sous-réseaux (inclut ton réseau, localhost, et d'éventuels réseaux VPN/Docker)
  const interfaces = networkInterfaces();
  const subnets = new Set(['192.168.0']); 
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
  }

  const allIps = ['127.0.0.1'];
  for (const subnet of subnets) {
    for (let i = 1; i <= 254; i++) {
      allIps.push(`${subnet}.${i}`);
    }
  }

  const activeIps = [];

  // 1. Scan TCP (très rapide) par lots pour éviter de saturer Node.js
  const BATCH_SIZE = 500;
  for (let i = 0; i < allIps.length; i += BATCH_SIZE) {
    const batch = allIps.slice(i, i + BATCH_SIZE);
    const checks = await Promise.all(batch.map(ip => {
      return new Promise((resolve) => {
        const socket = new Socket();
        socket.setTimeout(1500); // 1500ms max pour le ping TCP (Pi Zero 2W Wi-Fi)
        socket.once('connect', () => { socket.destroy(); resolve(ip); });
        socket.once('timeout', () => { socket.destroy(); resolve(null); });
        socket.once('error', () => { socket.destroy(); resolve(null); });
        socket.connect(port, ip);
      });
    }));
    activeIps.push(...checks.filter(Boolean));
  }

  // 2. Requêtes HTTP en parallèle sur les IPs ouvertes
  await Promise.all(activeIps.map(async (ip) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3500); // 3.5s de marge pour le Pi Zero
      const response = await fetch(`http://${ip}:${port}/v3/paths/list`, { 
        signal: controller.signal,
        headers: auth ? { 'Authorization': `Basic ${auth}` } : {}
      });
      clearTimeout(id);
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.items && data.items.length > 0) {
          const name = data.items[0].name;
          const rtspUrl = `rtsp://${ip}:8554/${name}`;
          
          // On enregistre la caméra MediaMTX dans la table persistante des Nœuds
          await pool.query(
            `INSERT INTO camera_nodes (device_id, name, host, stream_url, location, model, source, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (device_id) DO UPDATE SET
               name = EXCLUDED.name,
               stream_url = EXCLUDED.stream_url,
               last_seen_at = NOW()`,
            [`mediamtx:${ip}`, `Pi Zero 2W (${name})`, ip, rtspUrl, ip, 'MediaMTX Pi Zero', 'mediamtx']
          ).catch(err => console.error('[SCAN UPSERT NODE]', err));

          foundCameras.push({
            ip: ip,
            name: name,
            hlsUrl: `http://${ip}:8888/${name}`,
            rtspUrl: rtspUrl
          });
        }
      }
    } catch (err) {
      // ignore
    }
  }));

  res.json(foundCameras);
});

// PATCH /api/cameras/:id — modifier le nom
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom invalide' });

    const { rows } = await pool.query(
      'UPDATE cameras SET name = $1 WHERE id = $2 RETURNING *',
      [String(name).trim(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });

    res.json({ message: 'Caméra renommée', camera: rows[0] });
  } catch (err) {
    console.error('[CAM UPDATE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    stopCamera(req.params.id);
    req.app.get('go2rtc:unregister')?.(req.params.id)
      .catch(err => console.error('[go2rtc DEL]', err));
    await pool.query('DELETE FROM cameras WHERE id=$1', [req.params.id]);
    res.json({ message: 'Supprimée' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/start
router.post('/:id/start', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });

    // Si la caméra vient d'un nœud Pi : envoyer le signal wake et attendre que le Pi
    // confirme via notify_motion(True) — c'est là que FFmpeg sera déclenché.
    const host = getHostFromStreamUrl(rows[0].rtsp_url);
    if (host) {
      const { rows: nodeRows } = await pool.query(
        'SELECT device_id FROM camera_nodes WHERE host = $1 LIMIT 1', [host]
      ).catch(() => ({ rows: [] }));
      if (nodeRows[0]) {
        setPiWaiting(req.params.id);
        requestPiWake(nodeRows[0].device_id);
        return res.json({ message: 'Réveil Pi demandé', ...getState(req.params.id) });
      }
    }

    await startHlsStream(rows[0]);
    res.json({ message: 'Stream démarré', ...getState(req.params.id) });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/stream/heartbeat — maintient le stream actif (envoyé par le client toutes les 60s)
router.post('/:id/stream/heartbeat', requireAuth, (req, res) => {
  const ok = heartbeatStream(req.params.id);
  res.json({ alive: ok });
});

// POST /api/cameras/:id/pause
router.post('/:id/pause', requireAuth, (req, res) => {
  const ok = pauseCamera(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Caméra non active' });
  res.json({ message: 'En pause', ...getState(req.params.id) });
});

// POST /api/cameras/:id/resume
router.post('/:id/resume', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });
    resumeCamera(rows[0]);
    res.json({ message: 'Reprise', ...getState(req.params.id) });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/stop
router.post('/:id/stop', requireAuth, async (req, res) => {
  stopCamera(req.params.id);
  try {
    const { rows } = await pool.query(`
      SELECT cn.device_id FROM camera_nodes cn
      JOIN cameras c ON c.rtsp_url = cn.stream_url
      WHERE c.id = $1 LIMIT 1`, [req.params.id]);
    if (rows[0]) requestPiSleep(rows[0].device_id);
  } catch { /* non bloquant */ }
  res.json({ message: 'Arrêtée', ...getState(req.params.id) });
});

// GET /api/cameras/archives — dossiers d'enregistrements sans caméra correspondante
router.get('/archives', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM cameras');
    const existingIds = new Set(rows.map(r => String(r.id)));

    let folders = [];
    try { folders = await fs.readdir(RECORDINGS_DIR); } catch { /* dossier vide */ }

    const orphans = [];
    for (const folder of folders) {
      if (existingIds.has(folder)) continue;
      const folderPath = path.join(RECORDINGS_DIR, folder);
      const stat = await fs.stat(folderPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const files = await fs.readdir(folderPath).catch(() => []);
      const recordings = [];
      for (const filename of files) {
        const filePath = path.join(folderPath, filename);
        const fstat = await fs.stat(filePath).catch(() => null);
        if (!fstat?.isFile()) continue;
        recordings.push({
          filename,
          url: `/recordings/${folder}/${encodeURIComponent(filename)}`,
          createdAt: fstat.mtime.toISOString(),
          size: fstat.size,
        });
      }
      recordings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      orphans.push({ cameraId: folder, recordings });
    }

    res.json(orphans);
  } catch (err) {
    console.error('[ARCHIVES]', err);
    res.status(500).json({ error: 'Erreur lecture archives' });
  }
});

// DELETE /api/cameras/archives/:id — purge un dossier orphelin
router.delete('/archives/:id', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM cameras WHERE id = $1', [req.params.id]);
  if (rows.length > 0) {
    return res.status(400).json({ error: 'Cette caméra existe encore, utilisez /history' });
  }
  try {
    const result = await deleteAllRecordings(req.params.id);
    res.json({ message: 'Archive supprimée', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/state
router.get('/:id/state', (req, res) => {
  res.json(getState(req.params.id));
});

// POST /api/cameras/:id/motion — Webhook pour l'IA
router.post('/:id/motion', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT rtsp_url, name FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });

    const detectionLabel = req.body?.label || null;
    const detectionType  = req.body?.type  || null;
    triggerMotionRecording(req.params.id, 30, detectionLabel, rows[0].name);

    // NOUVEAU : On allume le badge "MOUVEMENT" en mettant à jour le noeud dans la base
    if (rows[0]) {
      const host = getHostFromStreamUrl(rows[0].rtsp_url);
      if (host) {
        let deviceId = null;
        // Met à jour la date de mouvement du noeud (s'il a été ajouté via un scan réseau)
        const updateRes = await pool.query('UPDATE camera_nodes SET last_motion_at = NOW() WHERE host = $1 RETURNING device_id', [host]);
        
        // Si aucun noeud n'existe pour cet hôte, on crée un noeud virtuel "IA"
        if (updateRes.rowCount === 0) {
          deviceId = `ai_node:${host}`;
          await pool.query(
            `INSERT INTO camera_nodes (device_id, name, host, stream_url, source, last_seen_at, last_motion_at)
             VALUES ($1, $2, $3, $4, 'ia_detector', NOW(), NOW())
             ON CONFLICT (device_id) DO UPDATE SET name = EXCLUDED.name, stream_url = EXCLUDED.stream_url, last_motion_at = NOW(), last_seen_at = NOW()`,
            [deviceId, rows[0].name, host, rows[0].rtsp_url]
          ).catch(err => console.error('[IA MOTION UPDATE ERROR]', err));
        } else {
          deviceId = updateRes.rows[0].device_id;
        }

        // Ajoute l'événement dans le journal d'historique texte
        if (deviceId) {
          await pool.query(
            `INSERT INTO camera_node_motion_events (device_id, motion, detected_at)
             VALUES ($1, true, NOW())`,
            [deviceId]
          ).catch(err => console.error('[IA MOTION EVENT INSERT ERROR]', err));

          // Génère une alerte globale visible dans le Centre d'Alertes
          await createAlert({
            sourceType: 'camera',
            sourceId: String(req.params.id),
            cameraId: req.params.id,
            alertType: 'motion_detected',
            level: 'warning',
            title: `${detectionLabel || 'Mouvement détecté'} - Caméra ${req.params.id}`,
            message: `${detectionLabel || 'Mouvement'} détecté sur le flux de la caméra (Hôte: ${host}).`,
            metadata: { deviceId, host, detectedAt: new Date().toISOString() },
            dedupeKey: `motion:ai:${req.params.id}`,
            cooldownSeconds: 60, // Limite à 1 alerte par minute
          }).catch(err => console.error('[ALERT AI MOTION ERROR]', err));

          // Déclenche une notification en temps réel (WebSocket)
          try {
            const io = req.app.get('io');
            if (io) io.emit('new_alert', { level: 'warning', title: `${detectionLabel || 'Mouvement détecté'} - Caméra ${req.params.id}` });
          } catch (e) {}
        }
      }
    }

    res.json({ message: 'Mouvement détecté, enregistrement en cours' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/upload-offline — Récupération des vidéos après coupure Wi-Fi (US-09)
router.post('/:id/upload-offline', async (req, res) => {
  try {
    const cameraId = String(req.params.id);
    const camDir = path.join(RECORDINGS_DIR, cameraId);
    if (!existsSync(camDir)) {
      await fs.mkdir(camDir, { recursive: true });
    }

    // Nom spécifique pour bien les identifier dans le frontend
    const filename = `offline_sync_${Date.now()}.mp4`;
    const filePath = path.join(camDir, filename);

    // On récupère le fichier binaire streamé par le nœud caméra (ex: Pi ou ESP32)
    await pipeline(req, createWriteStream(filePath));
    
    res.json({ message: 'Fichier hors-ligne reçu avec succès', filename });

    // Détection de mouvements a posteriori via ffmpeg (analyse du fichier sauvegardé)
    const ffmpegProc = spawn('ffmpeg', ['-i', filePath, '-vf', "select='gt(scene,0.05)'", '-f', 'null', '-']);
    let ffmpegOut = '';
    ffmpegProc.stdout.on('data', d => { ffmpegOut += d.toString(); });
    ffmpegProc.stderr.on('data', d => { ffmpegOut += d.toString(); });
    ffmpegProc.on('close', async () => {
      const output = ffmpegOut;
      if (output.includes('Parsed_select') || output.includes('scene:')) {
        console.log(`[OFFLINE SYNC] Mouvement détecté a posteriori dans ${filename}`);
        try {
          const { rows } = await pool.query('SELECT rtsp_url FROM cameras WHERE id=$1', [cameraId]);
          const host = rows[0] ? getHostFromStreamUrl(rows[0].rtsp_url) : 'offline_cam';
          
          await createAlert({
            sourceType: 'camera',
            sourceId: cameraId,
            cameraId: cameraId,
            alertType: 'offline_motion_detected',
            level: 'warning',
            title: `Mouvement détecté (Hors-ligne) - Caméra ${cameraId}`,
            message: `Un mouvement a été détecté dans la vidéo synchronisée après la coupure réseau (${filename}).`,
            metadata: { host, filename, detectedAt: new Date().toISOString() },
            dedupeKey: `motion:offline:${cameraId}:${filename}`
          });
        } catch (dbErr) {
          console.error('[OFFLINE SYNC ALERT ERROR]', dbErr);
        }
      }
    });
  } catch (err) {
    console.error('[OFFLINE SYNC ERROR]', err);
    res.status(500).json({ error: 'Erreur lors de la réception du fichier' });
  }
});

// GET /api/cameras/:id/history
router.get('/:id/history', requireAuth, async (req, res) => {
  const cameraId = String(req.params.id);
  const camDir = path.join(RECORDINGS_DIR, cameraId);
  if (!existsSync(camDir)) {
    return res.json({ recordings: [], retentionDays: getRecordingsRetentionDays() });
  }

  try {
    const files = await fs.readdir(camDir);
    const recordings = [];
    for (const filename of files) {
      const filePath = path.join(camDir, filename);
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) continue;
      recordings.push({
        filename,
        url: `/recordings/${cameraId}/${encodeURIComponent(filename)}`,
        createdAt: stats.mtime.toISOString(),
        size: stats.size,
      });
    }
    recordings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ recordings, retentionDays: getRecordingsRetentionDays() });
  } catch (err) {
    console.error('[CAM HISTORY]', err);
    res.status(500).json({ error: 'Impossible de lire l’historique' });
  }
});

router.delete('/:id/history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await deleteAllRecordings(req.params.id);
    res.json({ message: 'Historique supprimé', deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[CAM HISTORY DELETE ALL]', err);
    res.status(500).json({ error: 'Impossible de supprimer l’historique' });
  }
});

router.delete('/:id/history/:filename', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await deleteRecording(req.params.id, req.params.filename);
    if (!result.deleted) {
      const status = result.reason === 'not-found' ? 404 : 400;
      return res.status(status).json({ error: 'Enregistrement introuvable ou nom invalide' });
    }
    res.json({ message: 'Enregistrement supprimé', filename: result.filename });
  } catch (err) {
    console.error('[CAM HISTORY DELETE]', err);
    res.status(500).json({ error: 'Impossible de supprimer l’enregistrement' });
  }
});

export default router;