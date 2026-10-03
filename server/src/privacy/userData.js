import { createHash } from 'crypto';
import { pool } from '../db/index.js';
import { invalidateUserState } from '../auth/tokens.js';

// RGPD art. 15 (accès) et 20 (portabilité) : données rattachées au compte, format JSON lisible
export async function exportUserData(userId) {
  const [account, audit, sessions, push, acknowledged] = await Promise.all([
    pool.query(
      `SELECT id, username, role, created_at, password_changed_at, totp_enabled AS mfa_enabled
       FROM users WHERE id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT created_at, action, details, ip_address
       FROM audit_logs WHERE username = (SELECT username FROM users WHERE id = $1)
       ORDER BY created_at DESC`,
      [userId]
    ),
    pool.query(
      `SELECT created_at, expires_at, revoked_at, user_agent, ip_address
       FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    ),
    pool.query(
      // l'URL complète d'abonnement est un identifiant technique : seul le service est indiqué
      `SELECT created_at, split_part(endpoint, '/', 3) AS push_service
       FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT id, created_at, title, acknowledged_at
       FROM alerts WHERE acknowledged_by = $1 ORDER BY created_at DESC`,
      [userId]
    ),
  ]);

  if (!account.rows[0]) return null;
  return {
    exportedAt: new Date().toISOString(),
    controller: 'Sentys — installation locale (voir la politique de confidentialité)',
    account: account.rows[0],
    auditLog: audit.rows,
    sessions: sessions.rows,
    pushSubscriptions: push.rows,
    acknowledgedAlerts: acknowledged.rows,
    notes: [
      'Les mots de passe, secrets MFA et codes de récupération ne sont jamais exportés (stockés hachés ou chiffrés).',
      'Les listes de courses et notes de la page Maison sont partagées par le foyer et ne sont pas rattachées à un compte.',
      'Les images des caméras ne sont pas des données de votre compte : une demande d\'accès aux images se fait auprès du responsable du système.',
    ],
  };
}

export function pseudonymFor(userId) {
  const digest = createHash('sha256').update(`sentys-user-${userId}`).digest('hex').slice(0, 8);
  return `utilisateur-supprimé-${digest}`;
}

/**
 * RGPD art. 17 : effacement effectif. Sessions, MFA, codes de récupération et abonnements push
 * sont supprimés en cascade ; le journal d'audit (conservé pour la sécurité, durée limitée)
 * est pseudonymisé.
 */
export async function deleteUserAccount(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT username FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const { username } = rows[0];
    const pseudonym = pseudonymFor(userId);
    await client.query('UPDATE audit_logs SET username = $2 WHERE username = $1', [username, pseudonym]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    invalidateUserState(userId);
    return { username, pseudonym };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function countAdmins() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
  return rows[0]?.count ?? 0;
}
