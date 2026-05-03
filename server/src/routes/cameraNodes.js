import { Router } from 'express';
import { pool } from '../db/index.js';
import { startCamera, getState, triggerMotionRecording } from '../camera/manager.js';
import { createAlert } from '../alerts/service.js';
import { sendPushNotification } from './push.js';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import multer from 'multer';
import { RECORDINGS_DIR } from '../camera/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT_CN = path.resolve(__dirname, '..', '..', '..');
const AI_SCRIPT = path.join(PROJECT_ROOT_CN, 'server', 'motion_detector.py');
const VENV_PYTHON = path.join(PROJECT_ROOT_CN, 'venv', 'bin', 'python');
const OFFLINE_RECORDINGS_DIR = path.join(PROJECT_ROOT_CN, 'recordings', 'offline');
mkdirSync(OFFLINE_RECORDINGS_DIR, { recursive: true });

const offlineStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, OFFLINE_RECORDINGS_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const uploadOffline = multer({ storage: offlineStorage, limits: { fileSize: 500 * 1024 * 1024 } });

function classifyNodeMotion(rtspUrl) {
  return new Promise((resolve) => {
    const pythonBin = os.platform() === 'win32' ? 'python' : (existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3');
    const child = spawn(pythonBin, [AI_SCRIPT, '--analyze'], {
      env: { ...process.env, RTSP_URL: rtspUrl },
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      console.warn('[CLASSIFY] Timeout YOLO après 20s — fallback motion');
      resolve({ type: 'motion', label: 'Mouvement détecté', confidence: 0 });
    }, 20000);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', () => {
      clearTimeout(timeout);
      if (stderr) console.warn('[CLASSIFY] stderr:', stderr.slice(0, 300));
      try {
        const lastLine = stdout.trim().split('\n').findLast(l => l.startsWith('{'));
        resolve(lastLine ? JSON.parse(lastLine) : { type: 'motion', label: 'Mouvement détecté', confidence: 0 });
      } catch {
        resolve({ type: 'motion', label: 'Mouvement détecté', confidence: 0 });
      }
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[CLASSIFY] Erreur spawn Python:', err.message);
      resolve({ type: 'motion', label: 'Mouvement détecté', confidence: 0 });
    });
  });
}

const router = Router();
const MOTION_ACTIVE_WINDOW_SECONDS = Number(process.env.CAMERA_NODE_MOTION_WINDOW_SECONDS || 20);

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

function normalizeNodePayload(body = {}) {
  const streamUrl = String(body.streamUrl || body.rtsp_url || '').trim();
  const host = String(body.host || getHostFromStreamUrl(streamUrl) || '').trim();
  const deviceId = String(body.deviceId || body.device_id || host || '').trim();
  const name = String(body.name || body.hostname || body.deviceName || deviceId || 'Noeud camera Pi').trim();
  const location = String(body.location || '').trim();
  const model = String(body.model || 'Raspberry Pi Camera Node').trim();
  const source = String(body.source || 'pi-node').trim() || 'pi-node';

  if (!deviceId || !host || !streamUrl) {
    return null;
  }

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

function computeMotionActive(lastMotionAt) {
  if (!lastMotionAt) return false;
  const timestamp = new Date(lastMotionAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= MOTION_ACTIVE_WINDOW_SECONDS * 1000;
}

function serializeNode(row, connectedHosts = new Set()) {
  return {
    ...row,
    stream_url: maskStreamUrl(row.stream_url),
    motionActive: computeMotionActive(row.last_motion_at),
    connected: connectedHosts.has(row.host),
  };
}

function serializeCamera(camera) {
  return {
    ...camera,
    rtsp_url: maskStreamUrl(camera.rtsp_url),
    ...getState(camera.id),
  };
}

async function upsertNode(payload) {
  const normalized = normalizeNodePayload(payload);
  if (!normalized) return null;

  const { rows } = await pool.query(
    `INSERT INTO camera_nodes (device_id, name, host, stream_url, location, model, source, last_seen_at)
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

async function getConnectedHosts() {
  const { rows } = await pool.query('SELECT rtsp_url FROM cameras');
  return new Set(rows.map(row => getHostFromStreamUrl(row.rtsp_url)).filter(Boolean));
}

router.get('/', async (_req, res) => {
  try {
    const [nodesResult, connectedHosts] = await Promise.all([
      pool.query(
        `SELECT id, device_id, name, host, stream_url, location, model, source, motion_detected, last_motion_at, last_seen_at, created_at
         FROM camera_nodes
         ORDER BY last_seen_at DESC, created_at DESC`
      ),
      getConnectedHosts(),
    ]);

    res.json({
      motionActiveWindowSeconds: MOTION_ACTIVE_WINDOW_SECONDS,
      nodes: nodesResult.rows.map(row => serializeNode(row, connectedHosts)),
    });
  } catch (err) {
    console.error('[CAM NODE LIST]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture des noeuds camera' });
  }
});

router.post('/announce', async (req, res) => {
  const payload = normalizeNodePayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: 'deviceId, host et streamUrl sont requis' });
  }

  try {
    const node = await upsertNode(payload);
    const connectedHosts = await getConnectedHosts();
    res.status(200).json({
      message: 'Noeud camera enregistre',
      node: serializeNode(node, connectedHosts),
    });
  } catch (err) {
    console.error('[CAM NODE ANNOUNCE]', err);
    res.status(500).json({ error: 'Erreur serveur lors de l’annonce du noeud camera' });
  }
});

router.post('/motion', async (req, res) => {
  const deviceId = String(req.body.deviceId || req.body.device_id || '').trim();
  const motion = req.body.motion !== false;
  const detectedAtInput = String(req.body.detectedAt || req.body.detected_at || '').trim();
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId requis' });
  }

  let detectedAt = new Date();
  if (detectedAtInput) {
    const parsed = new Date(detectedAtInput);
    if (!Number.isNaN(parsed.getTime())) detectedAt = parsed;
  }

  try {
    const { rows } = await pool.query(
      `UPDATE camera_nodes
       SET motion_detected = $2,
           last_motion_at = CASE WHEN $2 THEN $3 ELSE last_motion_at END,
           last_seen_at = NOW()
       WHERE device_id = $1
       RETURNING *`,
      [deviceId, motion, detectedAt.toISOString()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Noeud camera introuvable' });

    if (motion) {
      await pool.query(
        `INSERT INTO camera_node_motion_events (device_id, motion, detected_at)
         VALUES ($1, $2, $3)`,
        [deviceId, true, detectedAt.toISOString()]
      );

      // Déclenche l'enregistrement vidéo immédiatement
      pool.query('SELECT id FROM cameras WHERE rtsp_url = $1 LIMIT 1', [rows[0].stream_url])
        .then(({ rows: camRows }) => { if (camRows[0]) triggerMotionRecording(camRows[0].id, 30); })
        .catch(() => {});
    }

    // Répond au Pi immédiatement — la classification se fait en tâche de fond
    const connectedHosts = await getConnectedHosts();
    res.json({
      message: motion ? 'Mouvement enregistre' : 'Mouvement acquitte',
      node: serializeNode(rows[0], connectedHosts),
    });

    // ── Tâche de fond : classification YOLO + alerte ──────────────
    if (motion) {
      const node = rows[0];
      setImmediate(async () => {
        let classification = { type: 'motion', label: 'Mouvement détecté', confidence: 0 };
        try {
          classification = await classifyNodeMotion(node.stream_url);
        } catch { /* fallback */ }

        const confSuffix = classification.confidence > 0 ? ` (${Math.round(classification.confidence * 100)}%)` : '';
        const alertTitle   = `${classification.label}${confSuffix} — ${node.name}`;
        const alertMessage = node.location
          ? `${classification.label} sur le flux de la caméra (Hôte: ${node.host}). Zone : ${node.location}.`
          : `${classification.label} sur le flux de la caméra (Hôte: ${node.host}).`;

        await createAlert({
          sourceType: 'camera-node',
          sourceId: deviceId,
          alertType: 'motion_detected',
          level: classification.type === 'person' ? 'critical' : 'warning',
          title: alertTitle,
          message: alertMessage,
          metadata: {
            deviceId,
            host: node.host,
            location: node.location,
            detectedAt: detectedAt.toISOString(),
            detectionType: classification.type,
            confidence: classification.confidence,
          },
          dedupeKey: `motion:${deviceId}`,
          cooldownSeconds: 300,
        }).catch((err) => console.error('[ALERT MOTION]', err));

        const payload = JSON.stringify({
          title: alertTitle,
          body: node.location ? `Zone : ${node.location}` : classification.label,
          icon: '/pwa-192.png',
          data: { url: '/alerts' },
        });
        pool.query('SELECT * FROM push_subscriptions').then(({ rows: subs }) => {
          subs.forEach(sub =>
            sendPushNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload
            ).catch(async err => {
              if (err.statusCode === 410 || err.statusCode === 404) {
                await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
              }
            })
          );
        }).catch(err => console.error('[PUSH MOTION]', err));
      });
    }
  } catch (err) {
    console.error('[CAM NODE MOTION]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la mise a jour du mouvement' });
  }
});

router.get('/:deviceId/motion-history', async (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId requis' });

  try {
    const { rows } = await pool.query(
      `SELECT id, device_id, motion, detected_at, created_at, offline_recording, recording_path
       FROM camera_node_motion_events
       WHERE device_id = $1
       ORDER BY detected_at DESC
       LIMIT 50`,
      [deviceId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[CAM NODE MOTION HISTORY]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture de l’historique mouvement' });
  }
});

router.post('/:deviceId/connect', async (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId requis' });

  try {
    const { rows: nodeRows } = await pool.query('SELECT * FROM camera_nodes WHERE device_id = $1', [deviceId]);
    const node = nodeRows[0];
    if (!node) return res.status(404).json({ error: 'Noeud camera introuvable' });

    const { rows: existingRows } = await pool.query('SELECT * FROM cameras WHERE rtsp_url = $1 LIMIT 1', [node.stream_url]);
    if (existingRows[0]) {
      return res.json({ message: 'Camera deja connectee', alreadyConnected: true, camera: serializeCamera(existingRows[0]) });
    }

    const { rows } = await pool.query(
      'INSERT INTO cameras (name, rtsp_url, location) VALUES ($1, $2, $3) RETURNING *',
      [node.name, node.stream_url, node.location || node.host]
    );
    const camera = rows[0];
    await startCamera(camera).catch(err => console.error('[CAM NODE CONNECT START]', err));

    res.status(201).json({ message: 'Camera connectee', camera: serializeCamera(camera) });
  } catch (err) {
    console.error('[CAM NODE CONNECT]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion du noeud camera' });
  }
});

router.post('/:deviceId/upload-recording', uploadOffline.single('recording'), async (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId || !req.file) return res.status(400).json({ error: 'deviceId et fichier requis' });
  if (req.file.size < 50 * 1024) {
    try { unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.status(400).json({ error: 'Fichier trop petit — clip invalide' });
  }

  const detectedAtInput = String(req.body.detectedAt || '').trim();
  let detectedAt = new Date();
  if (detectedAtInput) {
    const parsed = new Date(detectedAtInput);
    if (!Number.isNaN(parsed.getTime())) detectedAt = parsed;
  }

  try {
    const { rows: nodeRows } = await pool.query('SELECT * FROM camera_nodes WHERE device_id = $1', [deviceId]);
    const node = nodeRows[0];
    if (!node) return res.status(404).json({ error: 'Noeud introuvable' });

    // Déplacer le fichier dans le dossier de la caméra associée si elle existe
    let finalFilename = req.file.filename;
    const { rows: camRows } = await pool.query('SELECT id FROM cameras WHERE rtsp_url = $1 LIMIT 1', [node.stream_url]);
    if (camRows[0]) {
      const cameraId = camRows[0].id;
      const camDir = path.join(RECORDINGS_DIR, String(cameraId));
      mkdirSync(camDir, { recursive: true });
      const newPath = path.join(camDir, req.file.filename);
      try {
        renameSync(req.file.path, newPath);
        finalFilename = req.file.filename;
      } catch { /* garde le fichier dans offline si échec */ }
    }

    await pool.query(
      `INSERT INTO camera_node_motion_events (device_id, motion, detected_at, offline_recording, recording_path)
       VALUES ($1, true, $2, true, $3)`,
      [deviceId, detectedAt.toISOString(), finalFilename]
    );

    await createAlert({
      sourceType: 'camera-node',
      sourceId: deviceId,
      alertType: 'offline_recording',
      level: 'warning',
      title: `Enregistrement hors ligne — ${node.name}`,
      message: node.location
        ? `Enregistrement local effectué pendant une déconnexion. Zone : ${node.location}. (${detectedAt.toLocaleString('fr-FR')})`
        : `Enregistrement local effectué pendant une déconnexion (${detectedAt.toLocaleString('fr-FR')}).`,
      metadata: {
        deviceId,
        host: node.host,
        location: node.location,
        detectedAt: detectedAt.toISOString(),
        recordingFile: req.file.filename,
      },
      dedupeKey: `offline:${deviceId}:${detectedAt.toISOString()}`,
      cooldownSeconds: 0,
    }).catch(err => console.error('[ALERT OFFLINE RECORDING]', err));

    res.json({ message: 'Enregistrement reçu', filename: req.file.filename });
  } catch (err) {
    console.error('[UPLOAD RECORDING]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la reception de l\'enregistrement' });
  }
});

export default router;