import "dotenv/config";
import express   from "express";
import cors      from "cors";
import path      from "path";
import { fileURLToPath } from "url";
import bcrypt    from "bcryptjs";
import jwt       from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { initDB, pool } from "./src/db/index.js";
import sensorRoutes  from "./src/routes/sensors.js";
import groceryRoutes from "./src/routes/grocery.js";
import userRoutes    from "./src/routes/users.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("/{*path}", cors());
app.use(express.json());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: "Trop de tentatives, reessayez dans 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200,
  message: { error: "Trop de requetes." },
  standardHeaders: true, legacyHeaders: false,
});
app.use("/api/", apiLimiter);

app.post("/auth/register", async (req, res) => {
  const { email, password, role = "user" } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Identifiant et mot de passe requis" });
  if (password.length < 6) return res.status(400).json({ error: "Mot de passe trop court (6 caracteres min)" });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (email, password, role) VALUES ($1,$2,$3) RETURNING id, email, role",
      [email.toLowerCase().trim(), hash, role]
    );
    res.status(201).json({ message: "Utilisateur cree", user: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Identifiant deja utilise" });
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Champs manquants" });
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [username.toLowerCase().trim()]);
    const user  = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password) : false;
    if (!valid) return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "changeme_in_production",
      { expiresIn: "1h" }
    );
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur" }); }
});

app.get("/auth/me", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Non authentifie" });
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET || "changeme_in_production");
    const { rows } = await pool.query("SELECT id, email, role FROM users WHERE id = $1", [decoded.id]);
    if (!rows[0]) return res.status(404).json({ error: "Introuvable" });
    res.json({ user: rows[0] });
  } catch { res.status(401).json({ error: "Token invalide ou expire" }); }
});

app.use("/api/sensors", sensorRoutes);
app.use("/api/grocery", groceryRoutes);
app.use("/api/users",   userRoutes);
app.get("/health", (_, res) => res.json({ status: "ok" }));

const distPath = path.join(__dirname, "../client/dist");
app.use(express.static(distPath));
app.get("/{*path}", (_, res) => res.sendFile(path.join(distPath, "index.html")));

async function start() {
  await initDB();
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, "0.0.0.0", () => console.log("Serveur sur http://0.0.0.0:" + PORT));
}

start().catch(err => { console.error(err); process.exit(1); });
process.on("SIGINT",  () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));