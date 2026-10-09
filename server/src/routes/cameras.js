import { Router } from 'express';
import path from 'path';
import { networkInterfaces } from 'os';
import { Socket } from 'net';
import { existsSync, promises as fs, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
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
  holdRecordingAsEvidence,
} from '../camera/manager.js';
import { logAudit } from '../audit/log.js';
import { splitStreamCredentials, encryptCameraCredentials, resolveCameraSourceUrl, publicCameraFields } from '../camera/credentials.js';
import { isSurveillanceArmed } from '../alerts/service.js';
import { raiseAlert } from '../alerts/engine.js';
import { requestPiWake, requestPiSleep } from './cameraNodes.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getHostFromStreamUrl, maskStreamUrl, stripStreamCredentials } from '../utils/streamUtils.js';
import { signLivePrefix, signRecordingUrl, LIVE_URL_TTL_SECONDS } from '../security/urlSigning.js';
import { numericIdParam } from '../utils/validators.js';
import { requireDevice, requireDeviceIfPaired } from '../security/deviceAuth.js';
import { lanOnly } from '../security/networkZone.js';

const router = Router();
router.param('id', numericIdParam);

const DISCOVERY_TTL_MINUTES = Number(process.env.CAMERA_DISCOVERY_TTL_MINUTES || 10);
const ENABLE_SCAN_FALLBACK = process.env.CAMERA_DISCOVERY_ENABLE_SCAN_FALLBACK !== 'false';
const MOTION_ACTIVE_WINDOW_SECONDS = Number(process.env.CAMERA_NODE_MOTION_WINDOW_SECONDS || 20);
const MAX_DEVICE_UPLOAD_BYTES = Number(process.env.MAX_DEVICE_UPLOAD_MB || 200) * 1024 * 1024;

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
    ...publicCameraFields(camera),
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
    [normalized.deviceId, normalized.name, normalized.host, stripStreamCredentials(normalized.streamUrl), normalized.location, normalized.model, normalized.source]
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

// liste
router.get('/', requireAuth, async (req, res) => {
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

// ajout
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const normalized = normalizeCreateCameraPayload(req.body);
  if (!normalized.ok) {
    return res.status(400).json({ error: normalized.error || 'Parametres camera invalides' });
  }

  const { name, rtspUrl, location, discoverySource } = normalized;
  try {
    // identifiants retirés de l'URL et chiffrés (AES-256-GCM, liés à la caméra)
    const { cleanUrl, username, password } = splitStreamCredentials(rtspUrl);
    const { rows: inserted } = await pool.query(
      'INSERT INTO cameras (name, rtsp_url, location) VALUES ($1,$2,$3) RETURNING id',
      [name, cleanUrl, location || '']
    );
    const { rows } = await pool.query(
      'UPDATE cameras SET credentials_enc = $2 WHERE id = $1 RETURNING *',
      [inserted[0].id, encryptCameraCredentials(inserted[0].id, { username, password })]
    );
    const camera = rows[0];
    await logAudit(req.user.username, 'CAMERA_CREATE', `Caméra ${camera.id} « ${name} »${username ? ' (identifiants chiffrés)' : ''}`, req.ip);
    // veille
    await startCamera(camera).catch(err => console.error('[CAM ADD START]', err));
    req.app.get('go2rtc:register')?.(camera.id, resolveCameraSourceUrl(camera))
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

// annonce ESP32
router.post('/announce', lanOnly, requireDeviceIfPaired(req => normalizeDiscoveryPayload(req.body)?.deviceId || ''), async (req, res) => {
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
    res.status(500).json({ error: "Erreur serveur lors de l'annonce" });
  }
});

// découvertes
router.get('/discoveries', requireAuth, async (_req, res) => {
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
         WHERE last_seen_at > NOW() - ($1 || ' minutes')::INTERVAL
         ORDER BY last_seen_at DESC`,
        [DISCOVERY_TTL_MINUTES]
      ),
    ]);

    const seen = new Set(discResult.rows.map(r => r.host));
    const piNodes = nodesResult.rows
      .filter(r => !seen.has(r.host))
      .map(r => ({ ...r, source: r.source || 'pi-node' }));

    const devices = [...discResult.rows, ...piNodes]
      .map(d => ({ ...d, stream_url: maskStreamUrl(d.stream_url) }))
      .sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));

    res.json({ ttlMinutes: DISCOVERY_TTL_MINUTES, devices });
  } catch (err) {
    console.error('[CAM DISCOVERIES]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture des appareils détectés' });
  }
});

// détection ciblée ou scan réseau
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
      console.log(`[CAM DISCOVER] flux trouvé pour ${host} en ${Math.round((Date.now() - startedAt) / 1000)}s -> ${maskStreamUrl(streamUrl)}`);
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

// scan MediaMTX
router.get('/scan', requireAuth, async (req, res) => {
  const foundCameras = [];
  const port = 9997;
  const auth = process.env.MEDIAMTX_USER
    ? Buffer.from(`${process.env.MEDIAMTX_USER}:${process.env.MEDIAMTX_PASSWORD || ''}`).toString('base64')
    : null;

  // sous-réseaux dynamiques
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

  // scan TCP par lots
  const BATCH_SIZE = 500;
  for (let i = 0; i < allIps.length; i += BATCH_SIZE) {
    const batch = allIps.slice(i, i + BATCH_SIZE);
    const checks = await Promise.all(batch.map(ip => {
      return new Promise((resolve) => {
        const socket = new Socket();
        socket.setTimeout(1500);
        socket.once('connect', () => { socket.destroy(); resolve(ip); });
        socket.once('timeout', () => { socket.destroy(); resolve(null); });
        socket.once('error', () => { socket.destroy(); resolve(null); });
        socket.connect(port, ip);
      });
    }));
    activeIps.push(...checks.filter(Boolean));
  }

  // requêtes HTTP
  await Promise.all(activeIps.map(async (ip) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3500);
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

          // upsert node
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

// renommage
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom invalide' });

    const { rows } = await pool.query(
      'UPDATE cameras SET name = $1 WHERE id = $2 RETURNING *',
      [String(name).trim(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });

    await logAudit(req.user.username, 'CAMERA_UPDATE', `Caméra ${req.params.id} renommée`, req.ip);
    res.json({ message: 'Caméra renommée', camera: publicCameraFields(rows[0]) });
  } catch (err) {
    console.error('[CAM UPDATE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// suppression
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    stopCamera(req.params.id);
    req.app.get('go2rtc:unregister')?.(req.params.id)
      .catch(err => console.error('[go2rtc DEL]', err));
    await pool.query('DELETE FROM cameras WHERE id=$1', [req.params.id]);
    await logAudit(req.user.username, 'CAMERA_DELETE', `Caméra ${req.params.id} supprimée`, req.ip);
    res.json({ message: 'Supprimée' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// démarrage
router.post('/:id/start', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });
    const camera = rows[0];

    const alertBase = {
      type: 'camera_started',
      subject: `cam:${req.params.id}`,
      sourceType: 'camera',
      sourceId: String(req.params.id),
      cameraId: Number(req.params.id),
      title: `Stream démarré — ${camera.name}`,
      metadata: { cameraId: req.params.id, cameraName: camera.name, triggeredBy: req.user?.username || 'system' },
    };

    // réveil Pi
    const host = getHostFromStreamUrl(camera.rtsp_url);
    if (host) {
      const { rows: nodeRows } = await pool.query(
        'SELECT device_id FROM camera_nodes WHERE host = $1 LIMIT 1', [host]
      ).catch(() => ({ rows: [] }));
      if (nodeRows[0]) {
        setPiWaiting(req.params.id);
        requestPiWake(nodeRows[0].device_id);
        raiseAlert({ ...alertBase, message: `Réveil du noeud Pi demandé pour la caméra "${camera.name}".` })
          .catch(err => console.error('[ALERT CAM START]', err));
        return res.json({ message: 'Réveil Pi demandé', ...getState(req.params.id) });
      }
    }

    await startHlsStream(camera);
    raiseAlert({ ...alertBase, message: `Le flux de la caméra "${camera.name}" a été activé.` })
      .catch(err => console.error('[ALERT CAM START]', err));
    res.json({ message: 'Stream démarré', ...getState(req.params.id) });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// URL signée du flux live (valable LIVE_URL_TTL_SECONDS, liée à l'utilisateur)
router.get('/:id/hls-url', requireAuth, (req, res) => {
  const state = getState(req.params.id);
  if (!state?.hlsUrl) return res.status(409).json({ error: 'Flux non démarré' });
  res.json({
    url: `${signLivePrefix(req.params.id, req.user.id)}/index.m3u8`,
    expiresIn: LIVE_URL_TTL_SECONDS,
  });
});

// heartbeat
router.post('/:id/stream/heartbeat', requireAuth, (req, res) => {
  const ok = heartbeatStream(req.params.id);
  res.json({ alive: ok });
});

// pause
router.post('/:id/pause', requireAuth, (req, res) => {
  const ok = pauseCamera(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Caméra non active' });
  res.json({ message: 'En pause', ...getState(req.params.id) });
});

// reprise
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

// arrêt
router.post('/:id/stop', requireAuth, async (req, res) => {
  stopCamera(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT c.name, cn.device_id AS node_device_id
       FROM cameras c
       LEFT JOIN camera_nodes cn ON cn.stream_url = c.rtsp_url
       WHERE c.id = $1
       LIMIT 1`,
      [req.params.id]
    );
    const camera = rows[0];
    if (camera?.node_device_id) requestPiSleep(camera.node_device_id);
    if (camera) {
      raiseAlert({
        type: 'camera_stopped',
        subject: `cam:${req.params.id}`,
        sourceType: 'camera',
        sourceId: String(req.params.id),
        cameraId: Number(req.params.id),
        title: `Stream arrêté — ${camera.name}`,
        message: `Le flux de la caméra "${camera.name}" a été désactivé.`,
        metadata: { cameraId: req.params.id, cameraName: camera.name, triggeredBy: req.user?.username || 'system' },
      }).catch(err => console.error('[ALERT CAM STOP]', err));
    }
  } catch { /* non bloquant */ }
  res.json({ message: 'Arrêtée', ...getState(req.params.id) });
});

// archives orphelines
router.get('/archives', requireAuth, async (req, res) => {
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
          url: signRecordingUrl(`/recordings/${folder}/${encodeURIComponent(filename)}`, req.user.id),
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

// suppression archive
router.delete('/archives/:id', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM cameras WHERE id = $1', [req.params.id]);
  if (rows.length > 0) {
    return res.status(400).json({ error: 'Cette caméra existe encore, utilisez /history' });
  }
  try {
    const result = await deleteAllRecordings(req.params.id);
    res.json({ message: 'Archive supprimée', deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[ARCHIVE DELETE]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// état
router.get('/:id/state', requireAuth, (req, res) => {
  res.json(getState(req.params.id));
});

// webhook IA
// webhook du détecteur IA (jeton interne) ou d'un appareil appairé
router.post('/:id/motion', lanOnly, requireDevice({ allowInternal: true }), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, rtsp_url, credentials_enc, name FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });
    if (!(await isSurveillanceArmed())) {
      return res.json({ message: 'Surveillance désarmée — mouvement ignoré', ignored: true });
    }

    const detectionLabel = req.body?.label || null;
    const detectionType  = req.body?.type  || null;
    triggerMotionRecording(req.params.id, 30, resolveCameraSourceUrl(rows[0]));

    // badge mouvement + historique (statistiques), rattachés au noeud de la caméra
    const host = getHostFromStreamUrl(rows[0].rtsp_url);
    if (host) {
      const updateRes = await pool.query('UPDATE camera_nodes SET last_motion_at = NOW() WHERE host = $1 RETURNING device_id', [host]);
      let deviceId = updateRes.rows[0]?.device_id || null;

      // caméra IP sans Pi : noeud virtuel « détecteur IA »
      if (!deviceId) {
        deviceId = `ai_node:${host}`;
        await pool.query(
          `INSERT INTO camera_nodes (device_id, name, host, stream_url, source, last_seen_at, last_motion_at)
           VALUES ($1, $2, $3, $4, 'ia_detector', NOW(), NOW())
           ON CONFLICT (device_id) DO UPDATE SET name = EXCLUDED.name, stream_url = EXCLUDED.stream_url, last_motion_at = NOW(), last_seen_at = NOW()`,
          [deviceId, rows[0].name, host, rows[0].rtsp_url]
        ).catch(err => console.error('[IA MOTION UPDATE ERROR]', err));
      }

      await pool.query(
        'INSERT INTO camera_node_motion_events (device_id, motion, detected_at) VALUES ($1, true, NOW())',
        [deviceId]
      );
    }

    // alerte (+ push, temps réel) : même sujet que les Pi, une seule alerte par caméra
    await raiseAlert({
      type: 'motion_detected',
      subject: `cam:${req.params.id}`,
      sourceType: 'camera',
      sourceId: String(req.params.id),
      cameraId: Number(req.params.id),
      level: detectionType === 'person' ? 'critical' : 'warning',
      title: `${detectionLabel || 'Mouvement détecté'} — CAM ${req.params.id} — ${rows[0].name}`,
      message: `${detectionLabel || 'Mouvement'} détecté sur le flux de la caméra${host ? ` (Hôte: ${host})` : ''}.`,
      metadata: { host, detectionType, detectedAt: new Date().toISOString() },
    }).catch(err => console.error('[ALERT AI MOTION ERROR]', err));

    res.json({ message: 'Mouvement détecté, enregistrement en cours' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// upload hors ligne
router.post('/:id/upload-offline', lanOnly, requireDevice(), async (req, res) => {
  let filePath = null;
  try {
    const cameraId = String(req.params.id);
    const { rows: camRows } = await pool.query('SELECT id FROM cameras WHERE id = $1', [cameraId]);
    if (!camRows[0]) return res.status(404).json({ error: 'Caméra introuvable' });

    const declaredSize = Number(req.headers['content-length'] || 0);
    if (declaredSize > MAX_DEVICE_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'Fichier trop volumineux' });
    }

    const camDir = path.join(RECORDINGS_DIR, cameraId);
    if (!existsSync(camDir)) {
      await fs.mkdir(camDir, { recursive: true });
    }

    const filename = `offline_sync_${Date.now()}.mp4`;
    filePath = path.join(camDir, filename);

    // stream binaire borné (le Content-Length peut être absent ou faux)
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_DEVICE_UPLOAD_BYTES) return callback(Object.assign(new Error('too large'), { code: 'TOO_LARGE' }));
        callback(null, chunk);
      },
    });
    await pipeline(req, limiter, createWriteStream(filePath));

    res.json({ message: 'Fichier hors-ligne reçu avec succès', filename });

    // analyse ffmpeg
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

          await raiseAlert({
            type: 'offline_motion_detected',
            sourceType: 'camera',
            sourceId: cameraId,
            cameraId: Number(cameraId),
            title: `Mouvement détecté (hors ligne) — CAM ${cameraId}`,
            message: `Un mouvement a été détecté dans la vidéo synchronisée après la coupure réseau (${filename}).`,
            metadata: { host, filename, detectedAt: new Date().toISOString() },
          });
        } catch (dbErr) {
          console.error('[OFFLINE SYNC ALERT ERROR]', dbErr);
        }
      }
    });
  } catch (err) {
    if (filePath) await fs.unlink(filePath).catch(() => {});
    if (err?.code === 'TOO_LARGE') {
      if (!res.headersSent) res.status(413).json({ error: 'Fichier trop volumineux' });
      return;
    }
    console.error('[OFFLINE SYNC ERROR]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la réception du fichier' });
  }
});

// historique
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
        url: signRecordingUrl(`/recordings/${cameraId}/${encodeURIComponent(filename)}`, req.user.id),
        createdAt: stats.mtime.toISOString(),
        size: stats.size,
      });
    }
    recordings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ recordings, retentionDays: getRecordingsRetentionDays() });
  } catch (err) {
    console.error('[CAM HISTORY]', err);
    res.status(500).json({ error: "Impossible de lire l'historique" });
  }
});

router.delete('/:id/history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await deleteAllRecordings(req.params.id);
    res.json({ message: 'Historique supprimé', deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[CAM HISTORY DELETE ALL]', err);
    res.status(500).json({ error: "Impossible de supprimer l'historique" });
  }
});

// conservation comme preuve (loi caméras : au-delà d'un mois uniquement pour prouver une
// infraction, un dommage ou identifier un auteur) — motif obligatoire, journalisé
router.post('/:id/history/:filename/evidence', requireAuth, requireAdmin, async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (reason.length < 10) return res.status(400).json({ error: 'Motif requis (10 caractères minimum)' });
  try {
    const result = await holdRecordingAsEvidence(req.params.id, req.params.filename);
    if (!result.held) {
      return res.status(result.reason === 'not-found' ? 404 : 400).json({ error: 'Enregistrement introuvable ou nom invalide' });
    }
    await logAudit(req.user.username, 'EVIDENCE_HOLD', `Caméra ${req.params.id} — ${req.params.filename} → _preuves/${result.filename} — motif : ${reason}`, req.ip);
    res.json({ message: 'Enregistrement conservé comme preuve (exclu de la purge automatique)', filename: result.filename });
  } catch (err) {
    console.error('[EVIDENCE HOLD]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
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
    res.status(500).json({ error: "Impossible de supprimer l'enregistrement" });
  }
});

export default router;
