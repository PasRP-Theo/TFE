import "dotenv/config";
import express         from "express";
import { createServer } from "http";
import { createServer as createTcpServer } from "net";
import { Server }      from "socket.io";
import cors            from "cors";
import path            from "path";
import { fileURLToPath } from "url";
import jwt             from "jsonwebtoken";
import rateLimit       from "express-rate-limit";
import { existsSync, mkdirSync } from "fs";
import { initDB, pool, scheduleDiscoveryCleanup, scheduleAlertsCleanup } from "./src/db/index.js";
import userRoutes            from "./src/routes/users.js";
import systemRoutes          from "./src/routes/system.js";
import cameraRoutes          from "./src/routes/cameras.js";
import cameraNodeRoutes      from "./src/routes/cameraNodes.js";
import appConfigRoutes       from "./src/routes/appConfig.js";
import alertsRoutes          from "./src/routes/alerts.js";
import pushRoutes            from "./src/routes/push.js";
import webrtcRoutes          from "./src/routes/webrtc.js";
import homeRoutes            from "./src/routes/home.js";
import authRoutes            from "./src/routes/auth.js";
import { createHlsRouter, createRecordingsRouter } from "./src/routes/media.js";
import { requireAuth, requireAdmin } from "./src/middleware/auth.js";
import { ensureSetupState } from "./src/auth/setup.js";
import { lanOnly, PUBLIC_PORT } from "./src/security/networkZone.js";
import { startGo2rtc, syncCamerasFromDB, stopGo2rtc, registerStream, unregisterStream } from "./src/go2rtc/manager.js";
import { startCamera, stopAllCameras, cleanupOldRecordings, getAllStates, setSocketIO } from "./src/camera/manager.js";
import { JWT_SECRET } from "./src/config/auth.js";
import { createAlert } from "./src/alerts/service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  }
});

// auth Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  console.log(`[SOCKET] Utilisateur connecte : ${socket.user.username} (${socket.id})`);
  socket.on("disconnect", () => {
    console.log(`[SOCKET] Utilisateur deconnecte : ${socket.user.username}`);
  });
});

// io accessible
app.set('io', io);
setSocketIO(io);

// CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:4000'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS bloqué : origine non autorisée (${origin})`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("/{*path}", cors());
app.use(express.json());
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

// rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200,
  message: { error: "Trop de requetes." },
  standardHeaders: true, legacyHeaders: false,
});
app.use("/api/", apiLimiter);

// médias : accès uniquement par URL signée (voir src/routes/media.js)
const hlsDir = process.env.HLS_DIR || path.join(__dirname, '..', 'hls');
if (!existsSync(hlsDir)) mkdirSync(hlsDir, { recursive: true });
app.use('/hls', createHlsRouter(hlsDir));
const recordingsDir = process.env.RECORDINGS_DIR || path.join(__dirname, '..', 'recordings');
if (!existsSync(recordingsDir)) mkdirSync(recordingsDir, { recursive: true });
app.use('/recordings', createRecordingsRouter(recordingsDir));

// routes
app.use("/auth", authRoutes);
app.use("/api/users",   userRoutes);
app.use("/api/system",  systemRoutes);
app.use("/api/camera-nodes", cameraNodeRoutes);
app.use("/api/cameras", cameraRoutes);
app.use("/api/app-config", appConfigRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/notifications", pushRoutes);
app.use("/api/webrtc", webrtcRoutes);
app.use("/api/home",   homeRoutes);

app.get("/api/audit-logs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 150");
    res.json(rows);
  } catch (err) {
    console.error('[AUDIT]', err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok" }));

// agent Pi
app.get("/api/agent/sentys_agent.py", lanOnly, (_, res) => {
  const agentPath = path.join(__dirname, "../pi/sentys_agent.py");
  if (existsSync(agentPath)) {
    res.setHeader("Content-Type", "text/x-python");
    res.sendFile(agentPath);
  } else {
    res.status(404).send("Agent introuvable");
  }
});

// frontend
const distPath = path.join(__dirname, "../client/dist");
app.use(express.static(distPath));
app.get("/*", (_, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(503).send("Le build de l'interface React est en cours ou absent. Veuillez patienter.");
  }
});

// démarrage
async function start() {
  await initDB();
  await ensureSetupState();

  // go2rtc
  startGo2rtc().then(ok => {
    if (ok) setTimeout(() => syncCamerasFromDB(pool), 3000);
  });

  // helpers go2rtc
  app.set('go2rtc:register',   registerStream);
  app.set('go2rtc:unregister', unregisterStream);

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

  // migrations colonnes
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR(255)");
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action VARCHAR(255)");
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT");
  await pool.query("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)");

  // migration TEXT
  await pool.query("ALTER TABLE audit_logs ALTER COLUMN details TYPE TEXT USING details::text").catch(() => {});

  // index audit
  await pool.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_username_created ON audit_logs(username, created_at DESC)").catch(() => {});
  await pool.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at DESC)").catch(() => {});

  // device_id → timestamp première suspicion déconnexion
  const suspectedOfflineNodes = new Map();
  // camera id → timestamp première suspicion
  const suspectedOfflineCameras = new Map();
  // délai confirmation
  const OFFLINE_CONFIRM_DELAY_MS = 60_000;

  const runOfflineAlertsCheck = async () => {
    try {
      const [cameraResult, nodeResult] = await Promise.all([
        pool.query('SELECT id, name, location FROM cameras WHERE active = true'),
        pool.query(`SELECT device_id, name, host, location, last_seen_at FROM camera_nodes`),
      ]);
      const states = getAllStates();

      // caméras
      const activeCameraIds = new Set(cameraResult.rows.map(c => String(c.id)));
      for (const id of suspectedOfflineCameras.keys()) {
        if (!activeCameraIds.has(id)) suspectedOfflineCameras.delete(id);
      }

      await Promise.all(cameraResult.rows.map(async (camera) => {
        const id    = String(camera.id);
        const state = states[id] || { status: 'stopped' };
        if (state.status !== 'reconnecting') {
          suspectedOfflineCameras.delete(id);
          return;
        }
        const suspectedAt = suspectedOfflineCameras.get(id);
        if (!suspectedAt) {
          suspectedOfflineCameras.set(id, Date.now());
          console.log(`[OFFLINE] Caméra ${id} (${camera.name}) suspecte hors ligne — vérification dans ${OFFLINE_CONFIRM_DELAY_MS / 1000}s`);
          return;
        }
        if (Date.now() - suspectedAt < OFFLINE_CONFIRM_DELAY_MS) return;

        await createAlert({
          sourceType: 'camera',
          sourceId: id,
          cameraId: camera.id,
          alertType: 'camera_offline',
          level: 'critical',
          title: `CAM ${id} — ${camera.name} hors ligne`,
          message: `La caméra ${camera.name} (CAM ${id}) est hors ligne depuis plus de ${Math.round((Date.now() - suspectedAt) / 1000)}s.`,
          metadata: { cameraId: camera.id, location: camera.location, status: state.status },
          dedupeKey: `camera-offline:${id}`,
          cooldownSeconds: 1800,
        });
        io.emit("new_alert", { level: "critical", title: `CAM ${id} — ${camera.name} hors ligne` });
      }));

      // noeuds Pi
      const activeNodeIds = new Set(nodeResult.rows.map(n => n.device_id));
      for (const id of suspectedOfflineNodes.keys()) {
        if (!activeNodeIds.has(id)) suspectedOfflineNodes.delete(id);
      }

      await Promise.all(nodeResult.rows.map(async (node) => {
        const lastSeen = node.last_seen_at ? new Date(node.last_seen_at).getTime() : 0;
        const silentMs = lastSeen ? Date.now() - lastSeen : Infinity;

        if (silentMs <= 90_000) {
          if (suspectedOfflineNodes.has(node.device_id)) {
            console.log(`[OFFLINE] Noeud ${node.device_id} (${node.name}) de retour — suspicion annulée`);
            suspectedOfflineNodes.delete(node.device_id);
          }
          return;
        }

        const suspectedAt = suspectedOfflineNodes.get(node.device_id);
        if (!suspectedAt) {
          suspectedOfflineNodes.set(node.device_id, Date.now());
          console.log(`[OFFLINE] Noeud ${node.device_id} (${node.name}) suspect hors ligne — vérification dans ${OFFLINE_CONFIRM_DELAY_MS / 1000}s`);
          return;
        }
        if (Date.now() - suspectedAt < OFFLINE_CONFIRM_DELAY_MS) return;

        await createAlert({
          sourceType: 'camera-node',
          sourceId: node.device_id,
          alertType: 'node_offline',
          level: 'critical',
          title: `Noeud hors ligne - ${node.name}`,
          message: `Le noeud ${node.name} n'a pas donné de nouvelles depuis ${Math.round(silentMs / 1000)}s (dernière vue : ${new Date(lastSeen).toLocaleString('fr-FR')}).`,
          metadata: { deviceId: node.device_id, host: node.host, location: node.location, lastSeenAt: node.last_seen_at },
          dedupeKey: `node-offline:${node.device_id}`,
          cooldownSeconds: 1800,
        });
        io.emit("new_alert", { level: "critical", title: `Nœud hors ligne - ${node.name}` });
      }));
    } catch (error) {
      console.error('[ALERT OFFLINE MONITOR]', error);
    }
  };

  // autostart
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
  scheduleDiscoveryCleanup(10, 5 * 60 * 1000);
  scheduleAlertsCleanup(90);

  // listener LAN : interface locale + appareils (Pi, ESP32) — à filtrer au pare-feu
  const PORT = Number(process.env.PORT || 4000);
  const HOST = process.env.HOST || "0.0.0.0";
  httpServer.listen(PORT, HOST, () => console.log(`[NET] Listener LAN sur http://${HOST}:${PORT}`));

  // listener public : cible du tunnel (Tailscale Funnel), boucle locale uniquement,
  // les routes des appareils y sont invisibles (lanOnly)
  if (PUBLIC_PORT) {
    // même serveur HTTP (et Socket.IO) : seules les connexions sont relayées
    const publicServer = createTcpServer(socket => httpServer.emit("connection", socket));
    publicServer.listen(PUBLIC_PORT, "127.0.0.1", () => console.log(`[NET] Listener public (tunnel) sur http://127.0.0.1:${PUBLIC_PORT}`));
  }
}

start().catch(err => { console.error(err); process.exit(1); });
process.on("SIGINT",  () => { stopAllCameras(); stopGo2rtc(); process.exit(0); });
process.on("SIGTERM", () => { stopAllCameras(); stopGo2rtc(); process.exit(0); });
