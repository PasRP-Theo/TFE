import { Router }       from 'express';
import bcrypt           from 'bcryptjs';
import jwt              from 'jsonwebtoken';
import rateLimit        from 'express-rate-limit';
import { pool }         from '../db/index.js';
import { requireAuth }  from '../middleware/auth.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/auth.js';
import { logAudit }     from '../audit/log.js';
import { needsSetup, consumeSetupToken, hasActiveSetupToken, issueSetupToken } from '../auth/setup.js';
import { validatePassword } from '../auth/passwordPolicy.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 50 : 8,
  message: { error: 'Trop de tentatives, reessayez dans 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// état installation
router.get('/setup-status', async (_req, res) => {
  try {
    const pending = await needsSetup();
    // jeton expiré : on en réémet un dans la console serveur
    if (pending && !hasActiveSetupToken()) issueSetupToken();
    res.json({ needsSetup: pending });
  } catch (err) {
    console.error('[SETUP STATUS]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// création du premier administrateur
router.post('/setup', loginLimiter, async (req, res) => {
  const { setupToken, username, password } = req.body || {};
  const cleanUsername = typeof username === 'string' ? username.toLowerCase().trim() : '';
  if (!cleanUsername) return res.status(400).json({ error: 'Identifiant requis' });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // verrou : une seule installation concurrente
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    if (!(await needsSetup(client))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Installation déjà effectuée' });
    }
    if (!consumeSetupToken(setupToken)) {
      await client.query('ROLLBACK');
      await logAudit(cleanUsername, 'SETUP_FAILED', 'Jeton d\'installation invalide ou expiré', req.ip);
      return res.status(403).json({ error: 'Jeton d\'installation invalide ou expiré' });
    }
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await client.query(
      `INSERT INTO users (username, password, role) VALUES ($1, $2, 'admin')
       RETURNING id, username, role`,
      [cleanUsername, hash]
    );
    await client.query('COMMIT');
    await logAudit(cleanUsername, 'SETUP_ADMIN_CREATED', 'Création du premier administrateur', req.ip);
    const user = rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[SETUP]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// connexion
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase().trim()]);
    const user  = rows[0];
    const valid = user ? await bcrypt.compare(password, user.password) : false;
    if (!valid) {
      await logAudit(username, 'LOGIN_FAILED', 'Échec de connexion (identifiants incorrects)', req.ip);
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }
    await logAudit(user.username, 'LOGIN_SUCCESS', 'Connexion réussie', req.ip);
    res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('[LOGIN]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// profil
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json({ user: rows[0] });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
