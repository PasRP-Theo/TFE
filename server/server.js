import "dotenv/config";
import express         from "express";
import cors            from "cors";
import path            from "path";
import { fileURLToPath } from "url";
import bcrypt          from "bcryptjs";
import jwt             from "jsonwebtoken";
import rateLimit       from "express-rate-limit";
import { initDB, pool }      from "./src/db/index.js";
// import sensorRoutes          from "./src/routes/sensors.js";
import groceryRoutes         from "./src/routes/grocery.js";
import userRoutes            from "./src/routes/users.js";
import systemRoutes          from "./src/routes/system.js";
import cameraRoutes          from "./src/routes/cameras.js";
import cameraNodeRoutes      from "./src/routes/cameraNodes.js";
import appConfigRoutes       from "./src/routes/appConfig.js";
import alertsRoutes          from "./src/routes/alerts.js";
import notificationsRoutes   from "./src/routes/notifications.js";
import { configureVapid }    from "./src/push.js";
import { startCamera, stopAllCameras, cleanupOldRecordings, getAllStates } from "./src/camera/manager.js";
import { JWT_SECRET, JWT_EXPIRES_IN } from "./src/config/auth.js";
import { createAlert } from "./src/alerts/service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

export async function logAudit(username, action, details, ip) {
  try {
    await pool.query(
      "INSERT INTO audit_logs (username, action, details, ip_address) VALUES ($1, $2, $3, $4)",
      [username, action, details, ip]
    );
  } catch (err) {
    console.error('[AUDIT LOG ERROR]', err);
  }
}

// ── CORS ───────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("/{*path}", cors());
app.use(express.json());
app.set('trust proxy', 'loopback');

// ── Rate limiting ──────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // En développement, on peut être plus permissif pour éviter les blocages dus au hot-reload.
  // En production, la limite stricte est une bonne pratique de sécurité.
  max: process.env.NODE_ENV === 'development' ? 50 : 10,
  message: { error: "Trop de tentatives, reessayez dans 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200,
  message: { error: "Trop de requetes." },
  standardHeaders: true, legacyHeaders: false,
});
app.use("/api/", apiLimiter);

function getRequestUser(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

// ── Auth ───────────────────────────────────────────────────
app.post("/auth/register", async (req, res) => {
  const { username, password, role = "user" } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Identifiant et mot de passe requis" });
  if (password.length < 6) return res.status(400).json({ error: "Mot de passe trop court (6 caracteres min)" });
  try {
    const existingUserResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const hasUsers = (existingUserResult.rows[0]?.count ?? 0) > 0;
    const requestUser = getRequestUser(req);

    if (hasUsers && requestUser?.role !== 'admin') {
      return res.status(403).json({ error: 'Acces reserve aux administrateurs' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (username, password, role) VALUES ($1,$2,$3) RETURNING id, username, role",
      [username.toLowerCase().trim(), hash, hasUsers ? role : 'admin']
    );
    await logAudit(requestUser ? requestUser.username : 'system', 'USER_REGISTER', `Création de l'utilisateur ${username} avec le rôle ${hasUsers ? role : 'admin'}`, req.ip);
    res.status(201).json({ message: "Utilisateur cree", user: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Identifiant deja utilise" });
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  // Control Panel passwordless login:
  const isKioskAdmin = username.toLowerCase().trim() === 'kiosk_admin' && !password;
  const isKioskGuest = username.toLowerCase().trim() === 'kiosk_guest' && !password;
  const ipStr = req.ip ? req.ip.replace(/^.*:/, '') : '';
  const isLocalNetwork = ipStr === '127.0.0.1' || ipStr === '1' || ipStr.startsWith('192.168.') || ipStr.startsWith('10.') || ipStr.startsWith('172.');

  if ((isKioskAdmin || isKioskGuest) && isLocalNetwork) {
    try {
      const roleTarget = isKioskAdmin ? 'admin' : 'user';
      const { rows } = await pool.query("SELECT * FROM users WHERE role = $1 ORDER BY created_at ASC LIMIT 1", [roleTarget]);
      let user = rows[0];

      if (!user && isKioskGuest) {
        // Fallback: Si aucun utilisateur 'user' n'existe, on crée un invité virtuel
        user = { id: 9999, username: 'invité', role: 'user' };
      } else if (!user) {
        return res.status(401).json({ error: `Aucun compte ${roleTarget} disponible pour le panneau de contrôle.` });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      await logAudit(user.username, 'LOGIN_SUCCESS', `Connexion Control Panel (${roleTarget})`, req.ip);
      return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
      console.error('[CONTROL PANEL LOGIN]', err);
      return res.status(500).json({ error: "Erreur serveur lors de la connexion Control Panel" });
    }
  }

  if (!username || !password) return res.status(400).json({ error: "Champs manquants" });
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username.toLowerCase().trim()]);
    const user  = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password) : false;
    if (!valid) {
      await logAudit(username, 'LOGIN_FAILED', 'Échec de connexion (identifiants incorrects)', req.ip);
      return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    await logAudit(user.username, 'LOGIN_SUCCESS', 'Connexion réussie', req.ip);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

app.get("/auth/me", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Non authentifie" });
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    const { rows } = await pool.query("SELECT id, username, role FROM users WHERE id = $1", [decoded.id]);
    if (!rows[0]) return res.status(404).json({ error: "Introuvable" });
    res.json({ user: rows[0] });
  } catch { res.status(401).json({ error: "Token invalide ou expire" }); }
});

// ── HLS static (flux vidéo live) ──────────────────────────
const hlsDir = process.env.HLS_DIR || path.join(__dirname, '..', 'hls');
app.use('/hls', express.static(hlsDir));
const recordingsDir = process.env.RECORDINGS_DIR || path.join(__dirname, '..', 'recordings');
app.use('/recordings', express.static(recordingsDir));

// ── Routes API ─────────────────────────────────────────────
// Intégration capteurs désactivée à la demande.
// app.use("/api/sensors", sensorRoutes);
app.use("/api/grocery", groceryRoutes);
app.use("/api/users",   userRoutes);
app.use("/api/system",  systemRoutes);
app.use("/api/camera-nodes", cameraNodeRoutes);
app.use("/api/cameras", cameraRoutes);
app.use("/api/app-config", appConfigRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/notifications", (req, res, next) => {
  const user = getRequestUser(req);
  if (user) req.user = user;
  next();
}, notificationsRoutes);

app.get("/api/audit-logs", async (req, res) => {
  const user = getRequestUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: "Accès refusé" });
  try {
    const { rows } = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 150");
    res.json(rows);
  } catch (err) {
    console.error('[AUDIT]', err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

// ── Frontend React (build) ────────────────────────────────
const distPath = path.join(__dirname, "../client/dist");
app.use(express.static(distPath));
app.get("/*", (_, res) => res.sendFile(path.join(distPath, "index.html")));

// ── Démarrage ──────────────────────────────────────────────
async function start() {
  await initDB();
  configureVapid();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255),
      action VARCHAR(255) NOT NULL,
      details TEXT,
      ip_address VARCHAR(45),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Force l'ajout des colonnes si la table existait déjà dans une ancienne version
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR(255)");
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action VARCHAR(255)");
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT");
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)");

  // Force le type TEXT pour la colonne details au cas où elle aurait été créée en JSON précédemment
  await pool.query("ALTER TABLE audit_logs ALTER COLUMN details TYPE TEXT USING details::text").catch(() => {});

  // Création de la table des abonnements push
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subscription_object JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS push_subs_idx ON push_subscriptions (user_id, (subscription_object->>'endpoint'))`).catch(() => {});

  const runOfflineAlertsCheck = async () => {
    try {
      const [cameraResult, nodeResult] = await Promise.all([
        pool.query('SELECT id, name, location FROM cameras WHERE active = true'),
        pool.query(`SELECT device_id, name, host, location, last_seen_at FROM camera_nodes`),
      ]);
      const states = getAllStates();

      await Promise.all(cameraResult.rows.map(async (camera) => {
        const state = states[String(camera.id)] || { status: 'stopped' };
        if (state.status === 'running') return;
        await createAlert({
          sourceType: 'camera',
          sourceId: String(camera.id),
          cameraId: camera.id,
          alertType: 'camera_offline',
          level: 'critical',
          title: `Camera hors ligne - ${camera.name}`,
          message: `La camera ${camera.name} n'est actuellement pas en cours d'execution (${state.status}).`,
          metadata: {
            cameraId: camera.id,
            location: camera.location,
            status: state.status,
          },
          dedupeKey: `camera-offline:${camera.id}`,
          cooldownSeconds: 1800,
        });
      }));

      await Promise.all(nodeResult.rows.map(async (node) => {
        const lastSeen = node.last_seen_at ? new Date(node.last_seen_at).getTime() : 0;
        if (!lastSeen || Date.now() - lastSeen <= 90_000) return;
        await createAlert({
          sourceType: 'camera-node',
          sourceId: node.device_id,
          alertType: 'node_offline',
          level: 'critical',
          title: `Noeud hors ligne - ${node.name}`,
          message: `Le noeud camera ${node.name} n'a pas donne de nouvelles depuis plus de 90 secondes.`,
          metadata: {
            deviceId: node.device_id,
            host: node.host,
            location: node.location,
            lastSeenAt: node.last_seen_at,
          },
          dedupeKey: `node-offline:${node.device_id}`,
          cooldownSeconds: 1800,
        });
      }));
    } catch (error) {
      console.error('[ALERT OFFLINE MONITOR]', error);
    }
  };

  // Auto-démarrer les caméras actives en base
  try {
    const settingsResult = await pool.query('SELECT camera_autostart_enabled FROM app_settings WHERE id = 1');
    const cameraAutostartEnabled = settingsResult.rows[0]?.camera_autostart_enabled ?? true;
    const { rows } = await pool.query("SELECT * FROM cameras WHERE active = true");
    if (cameraAutostartEnabled && rows.length > 0) {
      console.log(`[CAM] Auto-démarrage de ${rows.length} caméra(s)…`);
      rows.forEach(cam => startCamera(cam));
    } else if (!cameraAutostartEnabled) {
      console.log('[CAM] Auto-démarrage désactivé dans les paramètres.');
    }
  } catch (e) {
    console.warn('[CAM] Pas de caméras à démarrer:', e.message);
  }

  cleanupOldRecordings().catch(err => console.error('[REC CLEANUP]', err));
  setInterval(() => cleanupOldRecordings().catch(err => console.error('[REC CLEANUP]', err)), 24 * 60 * 60 * 1000);
  runOfflineAlertsCheck().catch(err => console.error('[ALERT OFFLINE MONITOR]', err));
  setInterval(() => runOfflineAlertsCheck().catch(err => console.error('[ALERT OFFLINE MONITOR]', err)), 30 * 1000);

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, "0.0.0.0", () => console.log("Serveur sur http://0.0.0.0:" + PORT));
}

start().catch(err => { console.error(err); process.exit(1); });
process.on("SIGINT",  () => { stopAllCameras(); process.exit(0); });
process.on("SIGTERM", () => { stopAllCameras(); process.exit(0); });