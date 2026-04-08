import { Router } from 'express';
import path from 'path';
import { existsSync, promises as fs } from 'fs';
import { pool } from '../db/index.js';
import {
  startCamera, pauseCamera, resumeCamera,
  stopCamera,  getState,    getAllStates,
  detectCameraStreamUrl, scanLocalNetworkForCameraStreams,
  RECORDINGS_DIR,
  deleteRecording,
  deleteAllRecordings,
  getRecordingsRetentionDays,
} from '../camera/manager.js';
import { discoverMdnsEsp32Cameras } from '../camera/mdns.js';

const router = Router();
const DISCOVERY_TTL_MINUTES = Number(process.env.CAMERA_DISCOVERY_TTL_MINUTES || 10);
const ENABLE_SCAN_FALLBACK = process.env.CAMERA_DISCOVERY_ENABLE_SCAN_FALLBACK !== 'false';
const MOTION_ACTIVE_WINDOW_SECONDS = Number(process.env.CAMERA_NODE_MOTION_WINDOW_SECONDS || 20);

function normalizeDiscoveryPayload(body = {}) {
  const host = String(body.host || body.ip || '').trim();
  const streamUrl = String(body.streamUrl || body.rtsp_url || '').trim();
  const deviceId = String(body.deviceId || body.device_id || host || '').trim();
  const name = String(body.name || body.hostname || body.deviceName || deviceId || 'ESP32-CAM').trim();
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

function getHostFromStreamUrl(streamUrl) {
  const value = String(streamUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = /^[a-z]+:/i.test(value) ? new URL(value) : new URL(`http://${value}`);
    return parsed.hostname || parsed.host || '';
  } catch {
    return '';
  }
}

function maskStreamUrl(streamUrl) {
  const value = String(streamUrl || '').trim();
  if (!value) return value;

  try {
    const parsed = /^[a-z]+:/i.test(value) ? new URL(value) : new URL(`http://${value}`);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return value.replace(/\/\/([^:@/]+):([^@/]+)@/g, '//***:***@');
  }
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
router.post('/', async (req, res) => {
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
    await startCamera(camera).catch(err => console.error('[CAM ADD START]', err));
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

// GET /api/cameras/discoveries — liste des ESP32-CAM vues récemment
router.get('/discoveries', async (_req, res) => {
  try {
    await deleteExpiredDiscoveries();
    const { rows } = await pool.query(
      `SELECT id, device_id, name, host, stream_url, location, model, source, last_seen_at, created_at
       FROM camera_discoveries
       ORDER BY last_seen_at DESC, created_at DESC`
    );
    res.json({ ttlMinutes: DISCOVERY_TTL_MINUTES, devices: rows });
  } catch (err) {
    console.error('[CAM DISCOVERIES]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture des appareils détectés' });
  }
});

// GET /api/cameras/discover?host=192.168.0.101
// GET /api/cameras/discover          -> recherche automatique sur le réseau local
router.get('/discover', async (req, res) => {
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
        name: `ESP32-CAM ${host}`,
        host,
        streamUrl,
        source: 'probe',
      }).catch(err => console.error('[CAM DISCOVER UPSERT]', err));
      console.log(`[CAM DISCOVER] flux trouvé pour ${host} en ${Math.round((Date.now() - startedAt) / 1000)}s -> ${streamUrl}`);
      return res.json({ streamUrl });
    }

    console.log('[CAM DISCOVER] recherche mDNS ESP32-CAM lancée');
    const mdnsResults = await discoverMdnsEsp32Cameras();
    if (mdnsResults.length > 0) {
      await Promise.all(mdnsResults.map((result) => (
        upsertDiscovery(result).catch(err => console.error('[CAM DISCOVER UPSERT]', err))
      )));
      console.log(`[CAM DISCOVER] ${mdnsResults.length} ESP32-CAM trouvée(s) via mDNS en ${Math.round((Date.now() - startedAt) / 1000)}s`);
      return res.json({ results: mdnsResults, method: 'mdns' });
    }

    if (!ENABLE_SCAN_FALLBACK) {
      return res.status(404).json({
        error: 'Aucune ESP32-CAM trouvée via mDNS. Activez l’annonce HTTP ou le fallback de scan si nécessaire.',
      });
    }

    const preferredHosts = await getPreferredScanHosts().catch(() => []);
    console.log(`[CAM DISCOVER] fallback scan réseau lancé (${preferredHosts.length} hôtes prioritaires)`);
    const scanResults = await scanLocalNetworkForCameraStreams({
      signal: abortController.signal,
      preferredHosts,
    });
    if (!scanResults.length) return res.status(404).json({ error: 'Aucune ESP32-CAM trouvée sur le réseau local' });
    await Promise.all(scanResults.map(result => (
      upsertDiscovery({
        deviceId: `probe:${result.host}`,
        name: `ESP32-CAM ${result.host}`,
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

// DELETE /api/cameras/:id
router.delete('/:id', async (req, res) => {
  try {
    stopCamera(req.params.id);
    await pool.query('DELETE FROM cameras WHERE id=$1', [req.params.id]);
    res.json({ message: 'Supprimée' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });
    await startCamera(rows[0]);
    res.json({ message: 'Démarrée', ...getState(req.params.id) });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/pause
router.post('/:id/pause', (req, res) => {
  const ok = pauseCamera(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Caméra non active' });
  res.json({ message: 'En pause', ...getState(req.params.id) });
});

// POST /api/cameras/:id/resume
router.post('/:id/resume', async (req, res) => {
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
router.post('/:id/stop', (req, res) => {
  stopCamera(req.params.id);
  res.json({ message: 'Arrêtée', ...getState(req.params.id) });
});

// GET /api/cameras/:id/state
router.get('/:id/state', (req, res) => {
  res.json(getState(req.params.id));
});

// GET /api/cameras/:id/history
router.get('/:id/history', async (req, res) => {
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

router.delete('/:id/history', async (req, res) => {
  try {
    const result = await deleteAllRecordings(req.params.id);
    res.json({ message: 'Historique supprimé', deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[CAM HISTORY DELETE ALL]', err);
    res.status(500).json({ error: 'Impossible de supprimer l’historique' });
  }
});

router.delete('/:id/history/:filename', async (req, res) => {
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