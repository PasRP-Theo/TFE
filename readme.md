


**Backend** — un service FFmpeg par caméra qui :
- Convertit RTSP → HLS pour le live dans le navigateur
- Enregistre simultanément en MP4 continu + segments de 10 min
- Expose des routes API pour play/pause/stop/status
- WebSocket pour l'état en temps réel

**Frontend** — `CameraFeed` refait avec :
- Lecteur HLS natif
- Boutons play/pause/stop par caméra
- Indicateur d'enregistrement (rouge clignotant)
- Gestion des caméras en base (ajout/suppression d'URL RTSP)

Commençons par le backend :Maintenant j'ajoute la table `cameras` dans `db/index.js` et je mets à jour `server.js` :Tout est bien injecté. Maintenant le frontend `CameraFeed` :Il faut aussi installer `hls.js` côté client :5 fichiers à copier/créer :

| Fichier | Destination |
|---|---|
| `manager.js` | `server/src/camera/manager.js` ← nouveau dossier à créer |
| `cameras.js` | `server/src/routes/cameras.js` |
| `db/index.js` | `server/src/db/index.js` |
| `server.js` | `server/server.js` |
| `CameraFeed.tsx` | `client/src/components/CameraFeed.tsx` |

---

**Puis dans les deux terminaux :**

```powershell
# Terminal serveur
cd surveillance\server
npm start

# Terminal client — installer hls.js d'abord
cd surveillance\client
npm install hls.js
npm run dev
```

---

**Utilisation :**

1. Clique **+ Ajouter** → renseigne le nom + URL RTSP (`rtsp://192.168.1.xx:554/stream`)
2. Clique **▶ START** sur la caméra → FFmpeg démarre, le flux HLS apparaît dans 5-10s
3. **⏸ PAUSE** coupe l'affichage et l'enregistrement temporairement
4. **⏹ STOP** arrête définitivement jusqu'au prochain START
5. Clic sur la carte → vue plein écran

---

**Enregistrements** sauvegardés dans :
- `C:\surveillance\recordings\{id}\` → MP4 continu + segments 10 min
- Tu peux changer ce chemin dans `server/.env` : `RECORDINGS_DIR=D:\videos`


Manager
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// Dossier de base pour les enregistrements et le HLS
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'C:/surveillance/recordings';
const HLS_DIR        = process.env.HLS_DIR        || 'C:/surveillance/hls';

export const cameraEvents = new EventEmitter();

// État de chaque caméra : { process, status, startedAt, ... }
const cameraStates = new Map();

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function broadcastState(cameraId) {
  const state = getCameraState(cameraId);
  cameraEvents.emit('state', { cameraId, ...state });
}

export function getCameraState(cameraId) {
  const s = cameraStates.get(String(cameraId));
  if (!s) return { status: 'stopped', recording: false };
  return {
    status:    s.status,
    recording: s.recording,
    startedAt: s.startedAt,
    hlsUrl:    s.hlsUrl,
  };
}

export function getAllStates() {
  const out = {};
  cameraStates.forEach((v, k) => { out[k] = getCameraState(k); });
  return out;
}

/**
 * Démarre le flux HLS + enregistrement pour une caméra
 * @param {object} camera  - objet caméra depuis la BDD { id, name, rtsp_url }
 */
export function startCamera(camera) {
  const id  = String(camera.id);
  const existing = cameraStates.get(id);
  if (existing && existing.status === 'running') return;

  const hlsDir  = path.join(HLS_DIR, id);
  const recDir  = path.join(RECORDINGS_DIR, id);
  ensureDir(hlsDir);
  ensureDir(recDir);

  const now       = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mp4File   = path.join(recDir, `${timestamp}.mp4`);
  const hlsIndex  = path.join(hlsDir, 'index.m3u8');

  // FFmpeg : RTSP → HLS live + MP4 continu + segments 10 min
  // -hls_time 2        : segments HLS de 2s pour la latence
  // -hls_list_size 10  : garde 10 segments en mémoire (20s)
  // -segment_time 600  : segments MP4 de 10 min
  const ffmpegArgs = [
    '-rtsp_transport', 'tcp',
    '-i', camera.rtsp_url,
    // Sortie 1 : HLS live
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(hlsDir, 'seg%05d.ts'),
    hlsIndex,
    // Sortie 2 : MP4 continu
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-movflags', 'frag_keyframe+empty_moov',
    mp4File,
    // Sortie 3 : segments 10 min
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-f', 'segment',
    '-segment_time', '600',
    '-segment_format', 'mp4',
    '-reset_timestamps', '1',
    path.join(recDir, `seg_${timestamp}_%03d.mp4`),
  ];

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  const state = {
    proc,
    status:    'running',
    recording: true,
    startedAt: now.toISOString(),
    hlsUrl:    `/hls/${id}/index.m3u8`,
    mp4File,
  };

  cameraStates.set(id, state);
  broadcastState(id);

  proc.stderr.on('data', data => {
    // FFmpeg écrit sa progression sur stderr, on ignore sauf erreurs graves
    const txt = data.toString();
    if (txt.includes('Error') || txt.includes('error')) {
      console.error(`[CAM ${id}] FFmpeg:`, txt.slice(0, 200));
    }
  });

  proc.on('close', code => {
    const s = cameraStates.get(id);
    if (s && s.status !== 'stopped') {
      console.log(`[CAM ${id}] FFmpeg fermé (code ${code}), redémarrage dans 5s...`);
      s.status = 'reconnecting';
      broadcastState(id);
      setTimeout(() => startCamera(camera), 5000);
    }
  });

  console.log(`[CAM ${id}] Démarré : ${camera.rtsp_url}`);
}

/**
 * Met en pause l'enregistrement (coupe FFmpeg, HLS s'arrête aussi)
 */
export function pauseCamera(cameraId) {
  const id    = String(cameraId);
  const state = cameraStates.get(id);
  if (!state || state.status !== 'running') return false;

  state.proc.kill('SIGSTOP');  // SIGSTOP = pause (Linux/Mac) — Windows : on tue et marque paused
  state.status    = 'paused';
  state.recording = false;
  broadcastState(id);
  return true;
}

/**
 * Reprend après pause
 */
export function resumeCamera(camera) {
  const id    = String(camera.id);
  const state = cameraStates.get(id);
  if (!state) { startCamera(camera); return true; }

  if (state.status === 'paused') {
    // Sur Windows, SIGCONT ne fonctionne pas — on redémarre FFmpeg
    state.proc.kill('SIGKILL');
    cameraStates.delete(id);
    startCamera(camera);
    return true;
  }
  return false;
}

/**
 * Arrête complètement une caméra
 */
export function stopCamera(cameraId) {
  const id    = String(cameraId);
  const state = cameraStates.get(id);
  if (!state) return false;

  state.status    = 'stopped';
  state.recording = false;
  state.proc.kill('SIGKILL');
  cameraStates.delete(id);
  broadcastState(id);
  console.log(`[CAM ${id}] Arrêtée`);
  return true;
}

/**
 * Arrête toutes les caméras (appelé à l'arrêt du serveur)
 */
export function stopAllCameras() {
  cameraStates.forEach((state, id) => {
    state.proc?.kill('SIGKILL');
    console.log(`[CAM ${id}] Arrêtée (shutdown)`);
  });
  cameraStates.clear();
}

Cameras
import { Router } from 'express';
import { pool }   from '../db/index.js';
import {
  startCamera, pauseCamera, resumeCamera,
  stopCamera, getCameraState, getAllStates,
} from '../camera/manager.js';

const router = Router();

// GET /api/cameras — liste + état live
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM cameras ORDER BY id'
    );
    const states = getAllStates();
    const result = rows.map(cam => ({
      ...cam,
      ...getCameraState(cam.id),
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras — ajouter une caméra
router.post('/', async (req, res) => {
  const { name, rtsp_url, location } = req.body;
  if (!name || !rtsp_url)
    return res.status(400).json({ error: 'Nom et URL RTSP requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO cameras (name, rtsp_url, location)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, rtsp_url, location || '']
    );
    res.status(201).json({ ...rows[0], ...getCameraState(rows[0].id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    stopCamera(id);
    await pool.query('DELETE FROM cameras WHERE id=$1', [id]);
    res.json({ message: 'Caméra supprimée' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Contrôle flux ──────────────────────────────────────────

// POST /api/cameras/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });
    startCamera(rows[0]);
    res.json({ message: 'Démarré', ...getCameraState(req.params.id) });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/pause
router.post('/:id/pause', async (req, res) => {
  const ok = pauseCamera(req.params.id);
  if (!ok) return res.status(400).json({ error: 'Caméra non active' });
  res.json({ message: 'En pause', ...getCameraState(req.params.id) });
});

// POST /api/cameras/:id/resume
router.post('/:id/resume', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });
    resumeCamera(rows[0]);
    res.json({ message: 'Repris', ...getCameraState(req.params.id) });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras/:id/stop
router.post('/:id/stop', async (req, res) => {
  stopCamera(req.params.id);
  res.json({ message: 'Arrêté', ...getCameraState(req.params.id) });
});

// GET /api/cameras/:id/state
router.get('/:id/state', (req, res) => {
  res.json(getCameraState(req.params.id));
});

export default router;

index
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'aubepines',
  user:     process.env.DB_USER     || 'postgres',
  password: String(process.env.DB_PASSWORD || 'admin'),
});

pool.on('error', err => console.error('❌ PostgreSQL:', err.message));

export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        email      VARCHAR(255) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        role       VARCHAR(20)  DEFAULT 'user',
        created_at TIMESTAMP    DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sensors (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        type       VARCHAR(50)  NOT NULL,
        location   VARCHAR(100),
        mqtt_topic VARCHAR(200) UNIQUE,
        unit       VARCHAR(20),
        alert_at   FLOAT,
        active     BOOLEAN     DEFAULT true,
        created_at TIMESTAMP   DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sensor_readings (
        id          SERIAL PRIMARY KEY,
        sensor_id   INT REFERENCES sensors(id) ON DELETE CASCADE,
        value       FLOAT       NOT NULL,
        status      VARCHAR(20) DEFAULT 'OK',
        recorded_at TIMESTAMP   DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS grocery_items (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        category   VARCHAR(100),
        quantity   FLOAT       DEFAULT 1,
        unit       VARCHAR(30),
        checked    BOOLEAN     DEFAULT false,
        created_at TIMESTAMP   DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cameras (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        rtsp_url   VARCHAR(500) NOT NULL,
        location   VARCHAR(100),
        active     BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_readings_sensor
        ON sensor_readings(sensor_id, recorded_at DESC);
    `);
    console.log('✅ Base de données "aubepines" initialisée');
  } finally {
    client.release();
  }
}

server
import 'dotenv/config';
import express from 'express';
import cors    from 'cors';
import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';
import { initDB, pool } from './src/db/index.js';
import sensorRoutes  from './src/routes/sensors.js';
import groceryRoutes from './src/routes/grocery.js';
import userRoutes    from './src/routes/users.js';
import cameraRoutes  from './src/routes/cameras.js';
import { startCamera, stopAllCameras, cameraEvents } from './src/camera/manager.js';

const app = express();

// ── CORS ───────────────────────────────────────────────────
app.use(cors({
  origin:      ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('/{*path}', cors()); // preflight pour toutes les routes
app.use(express.json());

// ── Auth ───────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { email, password, role = 'user' } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password, role)
       VALUES ($1, $2, $3) RETURNING id, email, role`,
      [email.toLowerCase().trim(), password, role]
    );
    res.status(201).json({ message: 'Utilisateur créé !', user: rows[0] });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Email déjà utilisé' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Champs manquants' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [username.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || password !== user.password)
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/auth/me', async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Non authentifié' });
  try {
    const user = jwt.verify(header.slice(7), process.env.JWT_SECRET || 'fallback_secret');
    const { rows } = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1', [user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json({ user: rows[0] });
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
});

// ── HLS static files (flux live) ─────────────────────────
app.use('/hls', express.static(process.env.HLS_DIR || 'C:/surveillance/hls'));

// ── Routes API ─────────────────────────────────────────────
app.use('/api/sensors', sensorRoutes);
app.use('/api/grocery', groceryRoutes);
app.use('/api/users',   userRoutes);
app.use('/api/cameras', cameraRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Démarrage ──────────────────────────────────────────────
async function start() {
  await initDB();
  // Auto-démarrage des caméras actives
  try {
    const { rows } = await pool.query("SELECT * FROM cameras WHERE active=true");
    rows.forEach(cam => startCamera(cam));
    console.log(\);
  } catch (e) { console.warn('Pas de caméras à démarrer'); }

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
}

start().catch(err => { console.error('❌', err); process.exit(1); });

process.on('SIGINT',  () => { stopAllCameras(); process.exit(0); });
process.on('SIGTERM', () => { stopAllCameras(); process.exit(0); });

cameraFeed
import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface Camera {
  id:        number;
  name:      string;
  rtsp_url:  string;
  location:  string;
  status:    "running" | "paused" | "stopped" | "reconnecting";
  recording: boolean;
  startedAt: string | null;
  hlsUrl:    string | null;
}

// ── Lecteur HLS natif ──────────────────────────────────────
function HlsPlayer({ hlsUrl, cameraId }: { hlsUrl: string; cameraId: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullUrl  = `${API}${hlsUrl}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // HLS natif (Safari) ou via hls.js
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = fullUrl;
    } else {
      // Chargement dynamique de hls.js
      import('hls.js').then(({ default: Hls }) => {
        if (!Hls.isSupported()) return;
        const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3 });
        hls.loadSource(fullUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
        return () => hls.destroy();
      });
    }
  }, [fullUrl]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}

// ── Badge statut ───────────────────────────────────────────
function StatusBadge({ status, recording }: { status: Camera["status"]; recording: boolean }) {
  const label = status === "running"      ? "EN LIGNE"
               : status === "paused"      ? "EN PAUSE"
               : status === "reconnecting"? "RECONNEXION"
               : "ARRÊTÉE";
  const cls   = status === "running"      ? "cam-badge--online"
               : status === "paused"      ? "cam-badge--paused"
               : status === "reconnecting"? "cam-badge--reconnect"
               : "cam-badge--offline";

  return (
    <span className={`cam-badge ${cls}`}>
      <span className="cam-badge-dot" />
      {label}
      {recording && <span className="cam-rec-dot" title="Enregistrement en cours">⏺</span>}
    </span>
  );
}

// ── Contrôles ──────────────────────────────────────────────
function CameraControls({ camera, onAction }: {
  camera: Camera;
  onAction: (id: number, action: "start"|"pause"|"resume"|"stop") => void;
}) {
  const { id, status } = camera;

  return (
    <div className="cam-controls">
      {status === "stopped" && (
        <button className="cam-btn cam-btn--start" onClick={() => onAction(id, "start")} title="Démarrer">
          ▶ START
        </button>
      )}
      {status === "running" && (
        <>
          <button className="cam-btn cam-btn--pause" onClick={() => onAction(id, "pause")} title="Pause">
            ⏸ PAUSE
          </button>
          <button className="cam-btn cam-btn--stop" onClick={() => onAction(id, "stop")} title="Arrêter">
            ⏹ STOP
          </button>
        </>
      )}
      {status === "paused" && (
        <>
          <button className="cam-btn cam-btn--start" onClick={() => onAction(id, "resume")} title="Reprendre">
            ▶ REPRENDRE
          </button>
          <button className="cam-btn cam-btn--stop" onClick={() => onAction(id, "stop")} title="Arrêter">
            ⏹ STOP
          </button>
        </>
      )}
      {status === "reconnecting" && (
        <button className="cam-btn cam-btn--stop" onClick={() => onAction(id, "stop")} title="Arrêter">
          ⏹ STOP
        </button>
      )}
    </div>
  );
}

// ── Composant principal ────────────────────────────────────
export default function CameraFeed() {
  const [cameras,   setCameras]   = useState<Camera[]>([]);
  const [focused,   setFocused]   = useState<number | null>(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [newName,   setNewName]   = useState("");
  const [newRtsp,   setNewRtsp]   = useState("");
  const [newLoc,    setNewLoc]    = useState("");
  const [loading,   setLoading]   = useState(true);
  const [time,      setTime]      = useState(new Date());

  // Horloge
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Chargement des caméras
  async function fetchCameras() {
    try {
      const res  = await fetch(`${API}/api/cameras`);
      const data = await res.json();
      if (Array.isArray(data)) setCameras(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchCameras();
    // Rafraîchissement état toutes les 3s
    const t = setInterval(fetchCameras, 3000);
    return () => clearInterval(t);
  }, []);

  // Actions play/pause/stop
  async function handleAction(id: number, action: "start"|"pause"|"resume"|"stop") {
    try {
      await fetch(`${API}/api/cameras/${id}/${action}`, { method: "POST" });
      fetchCameras();
    } catch { /* ignore */ }
  }

  // Ajouter une caméra
  async function addCamera() {
    if (!newName.trim() || !newRtsp.trim()) return;
    try {
      const res  = await fetch(`${API}/api/cameras`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: newName, rtsp_url: newRtsp, location: newLoc }),
      });
      const data = await res.json();
      setCameras(prev => [...prev, data]);
      setNewName(""); setNewRtsp(""); setNewLoc(""); setShowAdd(false);
    } catch { /* ignore */ }
  }

  // Supprimer une caméra
  async function deleteCamera(id: number) {
    if (!confirm("Supprimer cette caméra ?")) return;
    await fetch(`${API}/api/cameras/${id}`, { method: "DELETE" });
    setCameras(prev => prev.filter(c => c.id !== id));
    if (focused === id) setFocused(null);
  }

  const onlineCount = cameras.filter(c => c.status === "running").length;
  const recCount    = cameras.filter(c => c.recording).length;
  const focusedCam  = cameras.find(c => c.id === focused);

  return (
    <>
      <style>{`
        .cam-page { display:flex; flex-direction:column; gap:1rem; }

        /* Header */
        .cam-header {
          display:flex; justify-content:space-between; align-items:center;
          padding-bottom:1rem; border-bottom:1px solid var(--border); flex-wrap:wrap; gap:8px;
        }
        .cam-header-left { display:flex; flex-direction:column; gap:4px; }
        .cam-header-title { font-size:13px; font-weight:700; letter-spacing:0.2em; color:var(--text-primary); }
        .cam-header-meta  { display:flex; gap:12px; }
        .cam-header-stat  { font-size:10px; letter-spacing:0.08em; color:var(--text-muted); }
        .cam-header-stat span { color:var(--accent-green); }
        .cam-header-stat.rec span { color:var(--accent-red); }
        .cam-header-right { display:flex; align-items:center; gap:8px; }
        .cam-clock { font-size:11px; color:var(--text-muted); letter-spacing:0.1em; }

        /* Form ajout */
        .cam-add-form {
          display:flex; gap:8px; align-items:center; flex-wrap:wrap;
          padding:12px 16px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:4px;
        }
        .cam-add-form input { flex:1; min-width:160px; }

        /* Badge */
        .cam-badge {
          display:inline-flex; align-items:center; gap:5px;
          font-size:9px; font-weight:700; letter-spacing:0.12em;
          padding:2px 7px; border-radius:2px; border:1px solid;
        }
        .cam-badge--online   { color:var(--accent-green); background:rgba(34,197,94,0.08);  border-color:rgba(34,197,94,0.25); }
        .cam-badge--offline  { color:var(--text-muted);   background:rgba(75,85,99,0.08);   border-color:rgba(75,85,99,0.2);  }
        .cam-badge--paused   { color:#f59e0b;              background:rgba(245,158,11,0.08); border-color:rgba(245,158,11,0.25); }
        .cam-badge--reconnect{ color:#a78bfa;              background:rgba(167,139,250,0.08);border-color:rgba(167,139,250,0.25);}
        .cam-badge-dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
        .cam-rec-dot { color:var(--accent-red); animation:pulse 1s ease-in-out infinite; margin-left:4px; font-size:8px; }

        /* Grid */
        .cam-grid {
          display:grid;
          grid-template-columns: repeat(3, 1fr);
          gap:12px;
        }
        @media(max-width:900px){ .cam-grid { grid-template-columns:repeat(2,1fr); } }
        @media(max-width:560px){ .cam-grid { grid-template-columns:1fr; } }

        /* Card */
        .cam-card {
          background:var(--bg-surface); border:1px solid var(--border); border-radius:4px;
          overflow:hidden; cursor:pointer; transition:border-color 0.15s, box-shadow 0.15s;
          display:flex; flex-direction:column;
        }
        .cam-card:hover       { border-color:var(--accent-blue); }
        .cam-card--focused    { border-color:var(--accent-blue); box-shadow:0 0 0 1px var(--accent-blue); }
        .cam-card--recording  { border-color:rgba(239,68,68,0.4); }

        /* Card header */
        .cam-card-header {
          display:flex; justify-content:space-between; align-items:center;
          padding:8px 12px; background:var(--bg-elevated); border-bottom:1px solid var(--border);
        }
        .cam-card-title { display:flex; align-items:center; gap:8px; }
        .cam-card-id { font-size:9px; font-weight:700; color:var(--accent-red); letter-spacing:0.1em; }
        .cam-card-name { font-size:10px; color:var(--text-secondary); letter-spacing:0.06em; }
        .cam-card-loc  { font-size:9px; color:var(--text-muted); letter-spacing:0.06em; }
        .cam-card-actions { display:flex; gap:6px; align-items:center; }
        .cam-card-delete { background:none; border:1px solid var(--border); color:var(--text-muted); font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer; transition:all 0.15s; }
        .cam-card-delete:hover { color:var(--accent-red); border-color:var(--accent-red); }

        /* Écran vidéo */
        .cam-screen {
          position:relative; width:100%; aspect-ratio:16/9;
          background:var(--camera-screen-bg); overflow:hidden;
          display:flex; align-items:center; justify-content:center;
        }

        /* Overlay coins */
        .cam-corner { position:absolute; width:14px; height:14px; border-color:var(--camera-corner-color); border-style:solid; }
        .cam-corner--tl { top:8px; left:8px;   border-width:1.5px 0 0 1.5px; }
        .cam-corner--tr { top:8px; right:8px;  border-width:1.5px 1.5px 0 0; }
        .cam-corner--bl { bottom:8px; left:8px;  border-width:0 0 1.5px 1.5px; }
        .cam-corner--br { bottom:8px; right:8px; border-width:0 1.5px 1.5px 0; }

        /* Indicateur REC */
        .cam-rec-indicator {
          position:absolute; top:8px; right:8px; z-index:5;
          display:flex; align-items:center; gap:4px;
          background:rgba(0,0,0,0.7); border:1px solid rgba(239,68,68,0.5);
          padding:2px 6px; border-radius:2px;
          font-size:9px; font-weight:700; letter-spacing:0.15em; color:var(--accent-red);
        }
        .cam-rec-dot-anim {
          width:6px; height:6px; border-radius:50%;
          background:var(--accent-red); animation:pulse 1s ease-in-out infinite;
        }

        /* Heure overlay */
        .cam-time-overlay {
          position:absolute; bottom:8px; left:8px; z-index:5;
          font-size:9px; letter-spacing:0.1em; color:rgba(255,255,255,0.5);
          background:rgba(0,0,0,0.4); padding:2px 5px; border-radius:2px;
        }

        /* Offline */
        .cam-offline { text-align:center; z-index:1; }
        .cam-offline-icon { font-size:24px; color:var(--camera-offline-icon); margin-bottom:6px; }
        .cam-offline-text { color:var(--text-muted); font-size:9px; letter-spacing:0.2em; }

        /* Contrôles */
        .cam-controls {
          display:flex; gap:6px; padding:8px 12px;
          background:var(--bg-elevated); border-top:1px solid var(--border);
        }
        .cam-btn {
          background:transparent; border:1px solid var(--border);
          color:var(--text-muted); font-family:var(--font-mono);
          font-size:9px; font-weight:700; letter-spacing:0.1em;
          padding:4px 10px; border-radius:3px; cursor:pointer; transition:all 0.15s;
        }
        .cam-btn--start  { border-color:rgba(34,197,94,0.3);  color:var(--accent-green); }
        .cam-btn--start:hover  { background:rgba(34,197,94,0.08);  border-color:var(--accent-green); }
        .cam-btn--pause  { border-color:rgba(245,158,11,0.3); color:#f59e0b; }
        .cam-btn--pause:hover  { background:rgba(245,158,11,0.08); border-color:#f59e0b; }
        .cam-btn--stop   { border-color:rgba(239,68,68,0.3);  color:var(--accent-red); }
        .cam-btn--stop:hover   { background:rgba(239,68,68,0.08);  border-color:var(--accent-red); }

        /* Vue focus */
        .cam-focus-wrap { display:flex; flex-direction:column; gap:12px; }
        .cam-focus-card { cursor:default; }
        .cam-focus-card .cam-screen { aspect-ratio:16/9; }
        .cam-focus-back { display:flex; align-items:center; gap:6px; font-size:10px; color:var(--text-muted); cursor:pointer; letter-spacing:0.08em; }
        .cam-focus-back:hover { color:var(--accent-blue); }

        /* Vide */
        .cam-empty {
          grid-column:1/-1; text-align:center; padding:48px;
          color:var(--text-muted); font-size:11px; letter-spacing:0.08em;
        }
      `}</style>

      <div className="cam-page">

        {/* Header */}
        <div className="cam-header">
          <div className="cam-header-left">
            <span className="cam-header-title">CAMÉRAS</span>
            <div className="cam-header-meta">
              <span className="cam-header-stat">
                EN LIGNE <span>{onlineCount}/{cameras.length}</span>
              </span>
              <span className="cam-header-stat rec">
                ENREGISTREMENT <span>{recCount}</span>
              </span>
            </div>
          </div>
          <div className="cam-header-right">
            <span className="cam-clock">
              {time.toLocaleTimeString('fr-FR')}
            </span>
            <button className="sensor-add-btn" onClick={() => setShowAdd(v => !v)}>
              {showAdd ? "✕" : "+ Ajouter"}
            </button>
          </div>
        </div>

        {/* Formulaire ajout */}
        {showAdd && (
          <div className="cam-add-form">
            <input className="sensor-input" placeholder="Nom de la caméra" value={newName}
              onChange={e => setNewName(e.target.value)} autoFocus />
            <input className="sensor-input" placeholder="rtsp://..." value={newRtsp}
              onChange={e => setNewRtsp(e.target.value)} style={{ minWidth: 240 }} />
            <input className="sensor-input" placeholder="Emplacement (optionnel)" value={newLoc}
              onChange={e => setNewLoc(e.target.value)} />
            <button className="sensor-confirm-btn" onClick={addCamera}>Ajouter</button>
          </div>
        )}

        {/* Vue focus (clic sur une caméra) */}
        {focusedCam ? (
          <div className="cam-focus-wrap">
            <div className="cam-focus-back" onClick={() => setFocused(null)}>
              ← Retour à la grille
            </div>
            <div className={`cam-card cam-focus-card ${focusedCam.recording ? 'cam-card--recording' : ''}`}>
              <div className="cam-card-header">
                <div className="cam-card-title">
                  <span className="cam-card-id">CAM {String(focusedCam.id).padStart(2, '0')}</span>
                  <span className="cam-card-name">{focusedCam.name}</span>
                  {focusedCam.location && <span className="cam-card-loc">· {focusedCam.location}</span>}
                </div>
                <StatusBadge status={focusedCam.status} recording={focusedCam.recording} />
              </div>
              <div className="cam-screen">
                {focusedCam.status === 'running' && focusedCam.hlsUrl
                  ? <HlsPlayer hlsUrl={focusedCam.hlsUrl} cameraId={focusedCam.id} />
                  : (
                    <div className="cam-offline">
                      <div className="cam-offline-icon">⊘</div>
                      <p className="cam-offline-text">
                        {focusedCam.status === 'paused' ? 'EN PAUSE' :
                         focusedCam.status === 'reconnecting' ? 'RECONNEXION...' : 'FLUX INACTIF'}
                      </p>
                    </div>
                  )
                }
                {focusedCam.recording && (
                  <div className="cam-rec-indicator">
                    <div className="cam-rec-dot-anim" /> REC
                  </div>
                )}
                <div className="cam-time-overlay">{time.toLocaleTimeString('fr-FR')}</div>
                <div className="cam-corner cam-corner--tl" />
                <div className="cam-corner cam-corner--tr" />
                <div className="cam-corner cam-corner--bl" />
                <div className="cam-corner cam-corner--br" />
              </div>
              <CameraControls camera={focusedCam} onAction={handleAction} />
            </div>
          </div>
        ) : (
          /* Grille */
          <div className="cam-grid">
            {loading && (
              <div className="cam-empty">Chargement des caméras...</div>
            )}
            {!loading && cameras.length === 0 && (
              <div className="cam-empty">
                Aucune caméra configurée — cliquez "+ Ajouter" pour démarrer.
              </div>
            )}
            {cameras.map(cam => (
              <div
                key={cam.id}
                className={`cam-card ${cam.recording ? 'cam-card--recording' : ''}`}
                onClick={() => setFocused(cam.id)}
              >
                <div className="cam-card-header" onClick={e => e.stopPropagation()}>
                  <div className="cam-card-title">
                    <span className="cam-card-id">CAM {String(cam.id).padStart(2, '0')}</span>
                    <span className="cam-card-name">{cam.name}</span>
                  </div>
                  <div className="cam-card-actions">
                    <StatusBadge status={cam.status} recording={cam.recording} />
                    <button className="cam-card-delete"
                      onClick={e => { e.stopPropagation(); deleteCamera(cam.id); }}
                      title="Supprimer">✕</button>
                  </div>
                </div>

                <div className="cam-screen">
                  {cam.status === 'running' && cam.hlsUrl
                    ? <HlsPlayer hlsUrl={cam.hlsUrl} cameraId={cam.id} />
                    : (
                      <div className="cam-offline">
                        <div className="cam-offline-icon">⊘</div>
                        <p className="cam-offline-text">
                          {cam.status === 'paused' ? 'EN PAUSE' :
                           cam.status === 'reconnecting' ? 'RECONNEXION...' : 'ARRÊTÉE'}
                        </p>
                      </div>
                    )
                  }
                  {cam.recording && (
                    <div className="cam-rec-indicator">
                      <div className="cam-rec-dot-anim" /> REC
                    </div>
                  )}
                  <div className="cam-time-overlay">{time.toLocaleTimeString('fr-FR')}</div>
                  <div className="cam-corner cam-corner--tl" />
                  <div className="cam-corner cam-corner--tr" />
                  <div className="cam-corner cam-corner--bl" />
                  <div className="cam-corner cam-corner--br" />
                </div>

                <div onClick={e => e.stopPropagation()}>
                  <CameraControls camera={cam} onAction={handleAction} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}