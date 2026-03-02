import 'dotenv/config';
import express from 'express';
import cors    from 'cors';
import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';
import { initDB, pool } from './src/db/index.js';
import sensorRoutes  from './src/routes/sensors.js';
import groceryRoutes from './src/routes/grocery.js';
import userRoutes    from './src/routes/users.js';

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

// ── Routes API ─────────────────────────────────────────────
app.use('/api/sensors', sensorRoutes);
app.use('/api/grocery', groceryRoutes);
app.use('/api/users',   userRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Démarrage ──────────────────────────────────────────────
async function start() {
  await initDB();
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
}

start().catch(err => { console.error('❌', err); process.exit(1); });