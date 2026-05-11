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
const uploadOffline = multer({
  storage: offlineStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['video/mp4', 'video/quicktime', 'application/octet-stream'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers MP4 sont acceptés'));
    }
  },
});

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
  const onBattery = body.onBattery === true || body.on_battery === true;
  const batteryPercent = body.batteryPercent != null ? Number(body.batteryPercent)
    : body.battery_percent != null ? Number(body.battery_percent)
    : null;

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
    onBattery,
    batteryPercent: batteryPercent != null && Number.isFinite(batteryPercent) ? Math.round(batteryPercent) : null,
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

  // Lire l'état batterie actuel pour détecter les changements
  const { rows: existing } = await pool.query(
    'SELECT on_battery FROM camera_nodes WHERE device_id = $1',
    [normalized.deviceId]
  );
  const previousOnBattery = existing[0]?.on_battery ?? null;

  const { rows } = await pool.query(
    `INSERT INTO camera_nodes (device_id, name, host, stream_url, location, model, source, on_battery, battery_percent, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (device_id) DO UPDATE SET
       name = EXCLUDED.name,
       host = EXCLUDED.host,
       stream_url = EXCLUDED.stream_url,
       location = EXCLUDED.location,
       model = EXCLUDED.model,
       source = EXCLUDED.source,
       on_battery = EXCLUDED.on_battery,
       battery_percent = EXCLUDED.battery_percent,
       last_seen_at = NOW()
     RETURNING *`,
    [normalized.deviceId, normalized.name, normalized.host, normalized.streamUrl, normalized.location, normalized.model, normalized.source, normalized.onBattery, normalized.batteryPercent]
  );

  const node = rows[0] || null;

  // Notif push si le statut batterie a changé
  if (node && previousOnBattery !== null && previousOnBattery !== normalized.onBattery) {
    const camName = node.name || normalized.deviceId;
    const title = normalized.onBattery
      ? `🔋 Sur batterie — ${camName}`
      : `⚡ Sur secteur — ${camName}`;
    const body = normalized.onBattery
      ? `La caméra ${camName} fonctionne maintenant sur batterie${normalized.batteryPercent != null ? ` (${normalized.batteryPercent}%)` : ''}.`
      : `La caméra ${camName} est de nouveau alimentée par le secteur.`;

    const pushPayload = JSON.stringify({ title, body, icon: '/pwa-192.png', data: { url: '/' } });
    pool.query('SELECT * FROM push_subscriptions').then(({ rows: subs }) => {
      subs.forEach(sub =>
        sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          pushPayload
        ).catch(async err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
          }
        })
      );
    }).catch(() => {});
  }

  return node;
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
      pool.query('SELECT id, name FROM cameras WHERE rtsp_url = $1 LIMIT 1', [rows[0].stream_url])
        .then(({ rows: camRows }) => { if (camRows[0]) triggerMotionRecording(camRows[0].id, 30, null, camRows[0].name); })
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
        // Résoudre la caméra DB associée à ce nœud (via stream_url)
        let linkedCamera = null;
        try {
          const { rows: camRows } = await pool.query(
            'SELECT id, name FROM cameras WHERE rtsp_url = $1 LIMIT 1',
            [node.stream_url]
          );
          linkedCamera = camRows[0] || null;
        } catch { /* fallback sans caméra liée */ }

        const camId    = linkedCamera ? String(linkedCamera.id) : null;
        const camLabel = linkedCamera ? `CAM ${linkedCamera.id} — ${linkedCamera.name}` : node.name;
        const dedupeId = camId ? `cam:${camId}` : `node:${deviceId}`;

        let classification = { type: 'motion', label: 'Mouvement détecté', confidence: 0 };
        try {
          classification = await classifyNodeMotion(node.stream_url);
        } catch { /* fallback */ }

        const confSuffix = classification.confidence > 0 ? ` (${Math.round(classification.confidence * 100)}%)` : '';
        const alertTitle   = `${classification.label}${confSuffix} — ${camLabel}`;
        const alertMessage = node.location
          ? `${classification.label} sur le flux de la caméra (Hôte: ${node.host}). Zone : ${node.location}.`
          : `${classification.label} sur le flux de la caméra (Hôte: ${node.host}).`;

        await createAlert({
          sourceType: 'camera-node',
          sourceId: camId || deviceId,
          cameraId: camId ? Number(camId) : null,
          alertType: 'motion_detected',
          level: classification.type === 'person' ? 'critical' : 'warning',
          title: alertTitle,
          message: alertMessage,
          metadata: {
            deviceId,
            cameraId: camId,
            cameraName: linkedCamera?.name || null,
            host: node.host,
            location: node.location,
            detectedAt: detectedAt.toISOString(),
            detectionType: classification.type,
            confidence: classification.confidence,
          },
          dedupeKey: `motion:${dedupeId}`,
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
    const { rows: camRows } = await pool.query('SELECT id, name FROM cameras WHERE rtsp_url = $1 LIMIT 1', [node.stream_url]);
    const linkedCam = camRows[0] || null;
    if (linkedCam) {
      const cameraId = linkedCam.id;
      const camDir = path.join(RECORDINGS_DIR, String(cameraId));
      mkdirSync(camDir, { recursive: true });
      const newPath = path.join(camDir, req.file.filename);
      try {
        renameSync(req.file.path, newPath);
        finalFilename = req.file.filename;
      } catch { /* garde le fichier dans offline si échec */ }
    }

    const offlineCamId    = linkedCam ? String(linkedCam.id) : null;
    const offlineCamLabel = linkedCam ? `CAM ${linkedCam.id} — ${linkedCam.name}` : node.name;

    await pool.query(
      `INSERT INTO camera_node_motion_events (device_id, motion, detected_at, offline_recording, recording_path)
       VALUES ($1, true, $2, true, $3)`,
      [deviceId, detectedAt.toISOString(), finalFilename]
    );

    await createAlert({
      sourceType: 'camera-node',
      sourceId: offlineCamId || deviceId,
      cameraId: linkedCam ? Number(linkedCam.id) : null,
      alertType: 'offline_recording',
      level: 'warning',
      title: `Enregistrement hors ligne — ${offlineCamLabel}`,
      message: node.location
        ? `Enregistrement local effectué pendant une déconnexion. Zone : ${node.location}. (${detectedAt.toLocaleString('fr-FR')})`
        : `Enregistrement local effectué pendant une déconnexion (${detectedAt.toLocaleString('fr-FR')}).`,
      metadata: {
        deviceId,
        cameraId: offlineCamId,
        cameraName: linkedCam?.name || null,
        host: node.host,
        location: node.location,
        detectedAt: detectedAt.toISOString(),
        recordingFile: req.file.filename,
      },
      dedupeKey: `offline:${offlineCamId || deviceId}:${detectedAt.toISOString()}`,
      cooldownSeconds: 0,
    }).catch(err => console.error('[ALERT OFFLINE RECORDING]', err));

    res.json({ message: 'Enregistrement reçu', filename: req.file.filename });
  } catch (err) {
    console.error('[UPLOAD RECORDING]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la reception de l\'enregistrement' });
  }
});

// GET /:deviceId/config — lu par le Pi à chaque démarrage/annonce (pas d'auth requis)
router.get('/:deviceId/config', async (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId requis' });
  try {
    const { rows } = await pool.query(
      `SELECT name, location, cfg_clip_duration, cfg_max_storage_mb, cfg_announce_interval, cfg_rtsp_port, cfg_rtsp_path
       FROM camera_nodes WHERE device_id = $1`,
      [deviceId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Noeud introuvable' });
    const r = rows[0];
    res.json({
      name:             r.name,
      location:         r.location,
      clipDuration:     r.cfg_clip_duration,
      maxStorageMb:     r.cfg_max_storage_mb,
      announceInterval: r.cfg_announce_interval,
      rtspPort:         r.cfg_rtsp_port,
      rtspPath:         r.cfg_rtsp_path,
    });
  } catch (err) {
    console.error('[NODE CONFIG GET]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /:deviceId/config — modifié depuis l'interface admin
router.patch('/:deviceId/config', async (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId requis' });

  const { name, location, clipDuration, maxStorageMb, announceInterval, rtspPort, rtspPath } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE camera_nodes SET
         name                 = COALESCE($2, name),
         location             = COALESCE($3, location),
         cfg_clip_duration    = COALESCE($4, cfg_clip_duration),
         cfg_max_storage_mb   = COALESCE($5, cfg_max_storage_mb),
         cfg_announce_interval = COALESCE($6, cfg_announce_interval),
         cfg_rtsp_port        = COALESCE($7, cfg_rtsp_port),
         cfg_rtsp_path        = COALESCE($8, cfg_rtsp_path)
       WHERE device_id = $1
       RETURNING *`,
      [
        deviceId,
        name        != null ? String(name).trim()        : null,
        location    != null ? String(location).trim()    : null,
        clipDuration    != null ? Number(clipDuration)    : null,
        maxStorageMb    != null ? Number(maxStorageMb)    : null,
        announceInterval != null ? Number(announceInterval) : null,
        rtspPort    != null ? Number(rtspPort)    : null,
        rtspPath    != null ? String(rtspPath).trim()    : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Noeud introuvable' });
    res.json({ message: 'Configuration mise à jour', node: rows[0] });
  } catch (err) {
    console.error('[NODE CONFIG PATCH]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /:deviceId — supprime un noeud
router.delete('/:deviceId', async (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'deviceId requis' });
  try {
    await pool.query('DELETE FROM camera_nodes WHERE device_id = $1', [deviceId]);
    res.json({ message: 'Noeud supprimé' });
  } catch (err) {
    console.error('[NODE DELETE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;