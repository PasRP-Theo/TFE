import { Router } from 'express';
import path from 'path';
import { existsSync, promises as fs } from 'fs';
import { pool } from '../db/index.js';
import {
  startCamera, pauseCamera, resumeCamera,
  stopCamera,  getState,    getAllStates,
  detectCameraStreamUrl, scanLocalNetworkForCameraStreams,
  RECORDINGS_DIR,
} from '../camera/manager.js';

const router = Router();

// GET /api/cameras — liste + état live
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras ORDER BY id');
    const result   = rows.map(cam => ({ ...cam, ...getState(cam.id) }));
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras — ajouter
router.post('/', async (req, res) => {
  const { name, rtsp_url, location } = req.body;
  if (!name || !rtsp_url)
    return res.status(400).json({ error: 'Nom et URL RTSP requis' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO cameras (name, rtsp_url, location) VALUES ($1,$2,$3) RETURNING *',
      [name, rtsp_url, location || '']
    );
    const camera = rows[0];
    await startCamera(camera).catch(err => console.error('[CAM ADD START]', err));
    res.status(201).json({ ...camera, ...getState(camera.id) });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/cameras/discover?host=192.168.0.101
// GET /api/cameras/discover          -> recherche automatique sur le réseau local
router.get('/discover', async (req, res) => {
  const host = String(req.query.host || '').trim();
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());
  try {
    if (host) {
      const streamUrl = await detectCameraStreamUrl(host, abortController.signal, { probeRtsp: true });
      if (!streamUrl) return res.status(404).json({ error: 'Aucun flux trouvé pour cette adresse' });
      return res.json({ streamUrl });
    }

    const results = await scanLocalNetworkForCameraStreams({ signal: abortController.signal });
    if (!results.length) return res.status(404).json({ error: 'Aucun flux trouvé sur le réseau local' });
    return res.json({ results });
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
  if (!existsSync(camDir)) return res.json([]);

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
    res.json(recordings);
  } catch (err) {
    console.error('[CAM HISTORY]', err);
    res.status(500).json({ error: 'Impossible de lire l’historique' });
  }
});

export default router;