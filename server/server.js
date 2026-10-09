import "dotenv/config";
import express         from "express";
import { createServer } from "http";
import { createServer as createTcpServer } from "net";
import { Server }      from "socket.io";
import cors            from "cors";
import path            from "path";
import { fileURLToPath } from "url";
import rateLimit       from "express-rate-limit";
import { existsSync, mkdirSync } from "fs";
import { initDB, pool, scheduleDiscoveryCleanup } from "./src/db/index.js";
import { scheduleRetention } from "./src/retention/scheduler.js";
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
import meRoutes              from "./src/routes/me.js";
import { createHlsRouter, createRecordingsRouter } from "./src/routes/media.js";
import { requireAuth, requireAdmin } from "./src/middleware/auth.js";
import { ensureSetupState } from "./src/auth/setup.js";
import { lanOnly, PUBLIC_PORT } from "./src/security/networkZone.js";
import { securityHeaders, spaCsp, buildCorsOptions } from "./src/security/httpHeaders.js";
import { startGo2rtc, syncCamerasFromDB, stopGo2rtc, registerStream, unregisterStream } from "./src/go2rtc/manager.js";
import { startCamera, stopAllCameras, getAllStates, setSocketIO } from "./src/camera/manager.js";
import { authenticateAccessToken } from "./src/auth/tokens.js";
import { ALLOWED_ORIGINS } from "./src/security/origins.js";
import { setAlertRealtimeChannel } from "./src/alerts/engine.js";
import { createOfflineMonitor } from "./src/alerts/offlineMonitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");

// CORS : liste blanche unique (Express, préflights, Socket.IO)
const corsOptions = buildCorsOptions(ALLOWED_ORIGINS);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions
});

// auth Socket.IO : même vérification que l'API (jeton ES256 + état en base)
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const user = await authenticateAccessToken(token);
    if (!user) return next(new Error("Authentication error"));
    socket.user = user;
    next();
  } catch {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  console.log(`[SOCKET] Utilisateur connecte : ${socket.user.username} (${socket.id})`);
  // jeton expiré → déconnexion ; le client se reconnecte avec un jeton renouvelé
  const msLeft = socket.user.exp * 1000 - Date.now();
  const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(msLeft, 0));
  socket.on("disconnect", () => {
    clearTimeout(expiryTimer);
    console.log(`[SOCKET] Utilisateur deconnecte : ${socket.user.username}`);
  });
});

// io accessible
app.set('io', io);
setSocketIO(io);
setAlertRealtimeChannel(io);

// en-têtes de sécurité puis CORS (le middleware cors répond aussi aux préflights)
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));
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
app.use("/api/me",      meRoutes);
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

// signature Ed25519 de l'agent (vérifiée par pi/auto_update.sh avant installation)
app.get("/api/agent/sentys_agent.py.sig", lanOnly, (_, res) => {
  const sigPath = path.join(__dirname, "../pi/sentys_agent.py.sig");
  if (existsSync(sigPath)) {
    res.setHeader("Content-Type", "application/octet-stream");
    res.sendFile(sigPath);
  } else {
    res.status(404).send("Signature introuvable");
  }
});

// frontend
const distPath = path.join(__dirname, "../client/dist");
app.use(spaCsp, express.static(distPath));
app.get("/*", spaCsp, (_, res) => {
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

  // coupures caméras / Pi : une alerte par coupure confirmée (src/alerts/offlineMonitor.js)
  const offlineMonitor = createOfflineMonitor({ getCameraStates: getAllStates });

  // autostart
  try {
    const settingsResult = await pool.query('SELECT camera_autostart_enabled, surveillance_mode FROM app_settings WHERE id = 1');
    const cameraAutostartEnabled = settingsResult.rows[0]?.camera_autostart_enabled ?? true;
    // désarmé avant le redémarrage : on reste désarmé (même règle que le désarmement par PIN)
    const surveillanceArmed = settingsResult.rows[0]?.surveillance_mode !== false;
    const { rows } = await pool.query("SELECT * FROM cameras WHERE active = true");
    if (cameraAutostartEnabled && surveillanceArmed && rows.length > 0) {
      console.log(`[CAM] Auto-démarrage de ${rows.length} caméra(s)…`);
      rows.forEach(cam => startCamera(cam));
    } else if (!cameraAutostartEnabled) {
      console.log('[CAM] Auto-démarrage désactivé dans les paramètres.');
    } else if (!surveillanceArmed) {
      console.log('[CAM] Surveillance désarmée : caméras non démarrées.');
    }
  } catch (e) {
    console.warn('[CAM] Pas de caméras à démarrer:', e.message);
  }

  const runOfflineCheck = () => offlineMonitor.check().catch(err => console.error('[ALERT OFFLINE MONITOR]', err));
  runOfflineCheck();
  setInterval(runOfflineCheck, 30 * 1000);
  scheduleDiscoveryCleanup(10, 5 * 60 * 1000);
  // conservation : images, alertes, mouvements, audit, sessions (src/retention/policy.js)
  scheduleRetention();

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
