import { Router }       from 'express';
import rateLimit        from 'express-rate-limit';
import { pool }         from '../db/index.js';
import { requireAuth }  from '../middleware/auth.js';
import { logAudit }     from '../audit/log.js';
import { needsSetup, consumeSetupToken, hasActiveSetupToken, issueSetupToken } from '../auth/setup.js';
import { validatePassword } from '../auth/passwordPolicy.js';
import { hashPassword, verifyPassword, burnPasswordCheck } from '../auth/passwords.js';
import {
  signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshFamily, revokeAllSessions,
  getUserState, readCookie, setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE,
} from '../auth/tokens.js';
import { isTrustedOrigin } from '../security/origins.js';
import { verifySecondFactor } from '../auth/mfa.js';
import { verifyAccessToken } from '../auth/tokens.js';

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

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
});

// routes à cookie : refus des origines non autorisées (CSRF)
function requireTrustedOrigin(req, res, next) {
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: 'Origine non autorisée' });
  next();
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role };
}

// ouvre une session : jeton d'accès en réponse, jeton de rafraîchissement en cookie HttpOnly
export async function startSession(req, res, user) {
  const refreshToken = await issueRefreshToken(user.id, { req });
  setRefreshCookie(res, refreshToken);
  return { token: signAccessToken(user), user: publicUser(user) };
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
router.post('/setup', loginLimiter, requireTrustedOrigin, async (req, res) => {
  const { setupToken, username, password } = req.body || {};
  const cleanUsername = typeof username === 'string' ? username.toLowerCase().trim() : '';
  if (!cleanUsername) return res.status(400).json({ error: 'Identifiant requis' });
  const passwordError = validatePassword(password, { username: cleanUsername });
  if (passwordError) return res.status(400).json({ error: passwordError });

  const client = await pool.connect();
  let user;
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
       RETURNING id, username, role, token_version`,
      [cleanUsername, hash]
    );
    await client.query('COMMIT');
    user = rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[SETUP]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
  await logAudit(cleanUsername, 'SETUP_ADMIN_CREATED', 'Création du premier administrateur', req.ip);
  res.status(201).json(await startSession(req, res, user));
});

// vérifie identifiant + mot de passe ; renvoie l'utilisateur ou null (échec déjà journalisé)
export async function checkCredentials(req, username, password) {
  const cleanUsername = username.toLowerCase().trim().slice(0, 255);
  const { rows } = await pool.query(
    `SELECT id, username, role, password, failed_login_count, token_version, totp_enabled,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
     FROM users WHERE username = $1`,
    [cleanUsername]
  );
  const user = rows[0];

  if (!user) {
    await burnPasswordCheck(password);
    await logAudit(cleanUsername, 'LOGIN_FAILED', 'Identifiant inconnu', req.ip);
    return null;
  }
  if (user.locked) {
    await burnPasswordCheck(password);
    await logAudit(user.username, 'LOGIN_LOCKED', 'Tentative sur un compte temporairement verrouillé', req.ip);
    return null;
  }
  const { valid, needsRehash } = await verifyPassword(password, user.password);
  if (!valid) {
    await registerFailedLogin(user.id);
    await logAudit(user.username, 'LOGIN_FAILED', 'Mot de passe incorrect', req.ip);
    return null;
  }
  if (needsRehash) {
    await pool.query(
      'UPDATE users SET password = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [user.id, await hashPassword(password)]
    );
  } else if (user.failed_login_count > 0) {
    await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
  }
  return { ...user, migratedHash: needsRehash };
}

// connexion
router.post('/login', loginLimiter, requireTrustedOrigin, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  try {
    const user = await checkCredentials(req, username, password);
    if (!user) return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    // second facteur : jeton intermédiaire de 5 min, inutilisable comme jeton d'accès
    if (user.totp_enabled) {
      const mfaToken = signAccessToken(user, { mfa: 'pending' }, { expiresIn: '5m' });
      return res.json({ mfaRequired: true, mfaToken });
    }
    await logAudit(user.username, 'LOGIN_SUCCESS', user.migratedHash ? 'Connexion réussie (hachage migré)' : 'Connexion réussie', req.ip);
    res.json(await startSession(req, res, user));
  } catch (err) {
    console.error('[LOGIN]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// second facteur (TOTP ou code de récupération)
router.post('/mfa', loginLimiter, requireTrustedOrigin, async (req, res) => {
  const { mfaToken, code } = req.body || {};
  let claims;
  try {
    claims = verifyAccessToken(String(mfaToken || ''));
  } catch {
    return res.status(401).json({ error: 'Étape de vérification expirée, reconnectez-vous' });
  }
  if (claims.mfa !== 'pending') return res.status(401).json({ error: 'Étape de vérification expirée, reconnectez-vous' });
  try {
    const user = await getUserState(claims.id);
    if (!user || Number(user.token_version) !== Number(claims.tv)) {
      return res.status(401).json({ error: 'Étape de vérification expirée, reconnectez-vous' });
    }
    const method = await verifySecondFactor(user.id, code);
    if (!method) {
      await registerFailedLogin(user.id);
      await logAudit(user.username, 'MFA_FAILED', 'Code de vérification incorrect', req.ip);
      return res.status(401).json({ error: 'Code incorrect' });
    }
    await logAudit(user.username, 'LOGIN_SUCCESS', method === 'recovery' ? 'Connexion MFA (code de récupération)' : 'Connexion MFA (TOTP)', req.ip);
    res.json(await startSession(req, res, user));
  } catch (err) {
    console.error('[MFA]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// renouvellement du jeton d'accès (rotation du jeton de rafraîchissement)
router.post('/refresh', refreshLimiter, requireTrustedOrigin, async (req, res) => {
  const presented = readCookie(req, REFRESH_COOKIE);
  if (!presented) return res.status(401).json({ error: 'Session expirée' });
  try {
    const result = await rotateRefreshToken(presented, req);
    if (result.status === 'reused') {
      clearRefreshCookie(res);
      const state = await getUserState(result.userId);
      await logAudit(state?.username || `#${result.userId}`, 'TOKEN_REUSE_DETECTED',
        'Jeton de rafraîchissement réutilisé : famille de sessions révoquée', req.ip);
      return res.status(401).json({ error: 'Session expirée' });
    }
    if (result.status !== 'ok') {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session expirée' });
    }
    const user = await getUserState(result.userId);
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session expirée' });
    }
    setRefreshCookie(res, result.token);
    res.json({ token: signAccessToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('[REFRESH]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// déconnexion de cet appareil : révoque la famille de jetons du cookie
router.post('/logout', requireTrustedOrigin, async (req, res) => {
  const presented = readCookie(req, REFRESH_COOKIE);
  try {
    if (presented) await revokeRefreshFamily(presented);
  } catch (err) {
    console.error('[LOGOUT]', err.message);
  }
  clearRefreshCookie(res);
  res.json({ message: 'Déconnecté' });
});

// déconnexion de tous les appareils
router.post('/logout-all', requireTrustedOrigin, requireAuth, async (req, res) => {
  try {
    await revokeAllSessions(req.user.id);
    await logAudit(req.user.username, 'LOGOUT_ALL', 'Déconnexion de toutes les sessions', req.ip);
    clearRefreshCookie(res);
    res.json({ message: 'Toutes les sessions ont été fermées' });
  } catch (err) {
    console.error('[LOGOUT ALL]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// profil
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
