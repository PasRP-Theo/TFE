import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../audit/log.js';
import { validatePassword } from '../auth/passwordPolicy.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { revokeAllSessions } from '../auth/tokens.js';
import {
  getMfaState, beginTotpEnrollment, confirmTotpEnrollment, verifySecondFactor,
  regenerateRecoveryCodes, disableMfa,
} from '../auth/mfa.js';
import { exportUserData, deleteUserAccount, countAdmins } from '../privacy/userData.js';
import { clearRefreshCookie } from '../auth/tokens.js';

// actions de l'utilisateur sur son propre compte
const router = Router();
router.use(requireAuth);

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
  standardHeaders: true, legacyHeaders: false,
});

async function checkCurrentPassword(userId, password) {
  const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
  if (!rows[0] || typeof password !== 'string') return false;
  return (await verifyPassword(password, rows[0].password)).valid;
}

router.get('/security', async (req, res) => {
  try {
    res.json(await getMfaState(req.user.id));
  } catch (err) {
    console.error('[ME SECURITY]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// changement de mot de passe : mot de passe actuel exigé, autres sessions fermées
router.post('/password', sensitiveLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  try {
    if (!(await checkCurrentPassword(req.user.id, currentPassword))) {
      await logAudit(req.user.username, 'PASSWORD_CHANGE_FAILED', 'Mot de passe actuel incorrect', req.ip);
      return res.status(403).json({ error: 'Mot de passe actuel incorrect' });
    }
    const { mfaEnabled } = await getMfaState(req.user.id);
    const policyError = validatePassword(newPassword, { mfaEnabled, username: req.user.username });
    if (policyError) return res.status(400).json({ error: policyError });
    await pool.query(
      'UPDATE users SET password = $2, password_changed_at = NOW() WHERE id = $1',
      [req.user.id, await hashPassword(newPassword)]
    );
    await revokeAllSessions(req.user.id);
    await logAudit(req.user.username, 'PASSWORD_CHANGED', 'Mot de passe modifié (sessions fermées)', req.ip);
    res.json({ message: 'Mot de passe modifié. Reconnectez-vous.' });
  } catch (err) {
    console.error('[ME PASSWORD]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// MFA — étape 1 : secret affiché une seule fois
router.post('/mfa/setup', sensitiveLimiter, async (req, res) => {
  try {
    if ((await getMfaState(req.user.id)).mfaEnabled) {
      return res.status(409).json({ error: 'La double authentification est déjà active' });
    }
    res.json(await beginTotpEnrollment(req.user));
  } catch (err) {
    console.error('[MFA SETUP]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// MFA — étape 2 : confirmation par un premier code ; codes de récupération affichés une fois
router.post('/mfa/enable', sensitiveLimiter, async (req, res) => {
  try {
    const recoveryCodes = await confirmTotpEnrollment(req.user.id, req.body?.code);
    if (!recoveryCodes) return res.status(400).json({ error: 'Code incorrect ou configuration expirée' });
    await logAudit(req.user.username, 'MFA_ENABLED', 'Double authentification TOTP activée', req.ip);
    res.json({ recoveryCodes });
  } catch (err) {
    console.error('[MFA ENABLE]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// désactivation : mot de passe + second facteur ; le mot de passe doit alors respecter 15 caractères
router.post('/mfa/disable', sensitiveLimiter, async (req, res) => {
  const { password, code } = req.body || {};
  try {
    if (!(await checkCurrentPassword(req.user.id, password))) {
      return res.status(403).json({ error: 'Mot de passe incorrect' });
    }
    if (validatePassword(password, { mfaEnabled: false, username: req.user.username })) {
      return res.status(400).json({ error: 'Sans double authentification, le mot de passe doit faire 15 caractères : changez-le d\'abord.' });
    }
    if (!(await verifySecondFactor(req.user.id, code))) {
      return res.status(403).json({ error: 'Code incorrect' });
    }
    await disableMfa(req.user.id);
    await logAudit(req.user.username, 'MFA_DISABLED', 'Double authentification désactivée', req.ip);
    res.json({ message: 'Double authentification désactivée' });
  } catch (err) {
    console.error('[MFA DISABLE]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/mfa/recovery-codes', sensitiveLimiter, async (req, res) => {
  try {
    if (!(await verifySecondFactor(req.user.id, req.body?.code))) {
      return res.status(403).json({ error: 'Code incorrect' });
    }
    const recoveryCodes = await regenerateRecoveryCodes(req.user.id);
    await logAudit(req.user.username, 'MFA_RECOVERY_REGENERATED', 'Nouveaux codes de récupération générés', req.ip);
    res.json({ recoveryCodes });
  } catch (err) {
    console.error('[MFA RECOVERY]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// RGPD art. 15 / 20 : export des données du compte
router.get('/export', sensitiveLimiter, async (req, res) => {
  try {
    const data = await exportUserData(req.user.id);
    if (!data) return res.status(404).json({ error: 'Compte introuvable' });
    await logAudit(req.user.username, 'DATA_EXPORT', 'Export des données personnelles', req.ip);
    res.setHeader('Content-Disposition', `attachment; filename="sentys-mes-donnees-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  } catch (err) {
    console.error('[ME EXPORT]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// RGPD art. 17 : suppression de son propre compte (mot de passe exigé)
router.delete('/', sensitiveLimiter, async (req, res) => {
  try {
    if (!(await checkCurrentPassword(req.user.id, req.body?.password))) {
      return res.status(403).json({ error: 'Mot de passe incorrect' });
    }
    if (req.user.role === 'admin' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'Vous êtes le dernier administrateur : nommez-en un autre avant de supprimer votre compte.' });
    }
    const result = await deleteUserAccount(req.user.id);
    await logAudit(result?.pseudonym || 'inconnu', 'ACCOUNT_SELF_DELETED', 'Compte supprimé à la demande de la personne (art. 17)', req.ip);
    clearRefreshCookie(res);
    res.json({ message: 'Compte supprimé' });
  } catch (err) {
    console.error('[ME DELETE]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
