import { Router }       from 'express';
import jwt              from 'jsonwebtoken';
import rateLimit        from 'express-rate-limit';
import { pool }         from '../db/index.js';
import { requireAuth }  from '../middleware/auth.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/auth.js';
import { logAudit }     from '../audit/log.js';
import { needsSetup, consumeSetupToken, hasActiveSetupToken, issueSetupToken } from '../auth/setup.js';
import { validatePassword } from '../auth/passwordPolicy.js';
import { hashPassword, verifyPassword, burnPasswordCheck } from '../auth/passwords.js';

const router = Router();

// message unique pour tout échec : ne révèle ni l'existence du compte ni son verrouillage
const GENERIC_LOGIN_ERROR = 'Identifiant ou mot de passe incorrect. Après plusieurs échecs, l\'accès est temporairement suspendu.';
// verrouillage progressif par compte : 5 échecs → 1 min, puis 2, 4, 8… (max 60 min)
const LOCK_AFTER_FAILURES = 5;
const MAX_LOCK_MINUTES = 60;

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

async function registerFailedLogin(userId) {
  await pool.query(
    `UPDATE users
     SET failed_login_count = failed_login_count + 1,
         locked_until = CASE
           WHEN failed_login_count + 1 >= $2
           THEN NOW() + LEAST(POWER(2, failed_login_count + 1 - $2), $3) * INTERVAL '1 minute'
           ELSE locked_until
         END
     WHERE id = $1`,
    [userId, LOCK_AFTER_FAILURES, MAX_LOCK_MINUTES]
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
  const passwordError = validatePassword(password, { username: cleanUsername });
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
    const hash = await hashPassword(password);
    const { rows } = await client.query(
      `INSERT INTO users (username, password, role, password_changed_at) VALUES ($1, $2, 'admin', NOW())
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
  const cleanUsername = username.toLowerCase().trim().slice(0, 255);
  try {
    const { rows } = await pool.query(
      `SELECT id, username, role, password, failed_login_count,
              (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
       FROM users WHERE username = $1`,
      [cleanUsername]
    );
    const user = rows[0];

    if (!user) {
      await burnPasswordCheck(password);
      await logAudit(cleanUsername, 'LOGIN_FAILED', 'Identifiant inconnu', req.ip);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (user.locked) {
      await burnPasswordCheck(password);
      await logAudit(user.username, 'LOGIN_LOCKED', 'Tentative sur un compte temporairement verrouillé', req.ip);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const { valid, needsRehash } = await verifyPassword(password, user.password);
    if (!valid) {
      await registerFailedLogin(user.id);
      await logAudit(user.username, 'LOGIN_FAILED', 'Mot de passe incorrect', req.ip);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (needsRehash) {
      await pool.query(
        'UPDATE users SET password = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1',
        [user.id, await hashPassword(password)]
      );
    } else if (user.failed_login_count > 0) {
      await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
    }

    await logAudit(user.username, 'LOGIN_SUCCESS', needsRehash ? 'Connexion réussie (hachage migré)' : 'Connexion réussie', req.ip);
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
