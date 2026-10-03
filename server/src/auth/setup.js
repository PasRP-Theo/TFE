import { randomBytes, timingSafeEqual } from 'crypto';
import { verifyPassword } from './passwords.js';
import { pool } from '../db/index.js';

// installation initiale sans mot de passe par défaut (ETSI EN 303 645 §5.1-1)
const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;
const LEGACY_DEFAULT_USERNAME = 'root';
const LEGACY_DEFAULT_PASSWORD = 'root';

let setupToken = null;
let setupTokenExpiresAt = 0;

export async function countUsers(client = pool) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM users');
  return rows[0]?.count ?? 0;
}

// désactive le compte root/root hérité des anciennes versions
export async function neutralizeLegacyDefaultAdmin(client = pool) {
  const { rows } = await client.query(
    'SELECT id, password FROM users WHERE username = $1',
    [LEGACY_DEFAULT_USERNAME]
  );
  const legacy = rows[0];
  if (!legacy) return false;
  const { valid: usesDefault } = await verifyPassword(LEGACY_DEFAULT_PASSWORD, legacy.password).catch(() => ({ valid: false }));
  if (!usesDefault) return false;

  await client.query('DELETE FROM users WHERE id = $1', [legacy.id]);
  await client.query(
    `UPDATE app_settings
     SET default_admin_active = false, bootstrap_admin_user_id = NULL, updated_at = NOW()
     WHERE id = 1`
  );
  console.warn('[SETUP] Compte "root" avec mot de passe par défaut détecté et supprimé.');
  return true;
}

export async function needsSetup(client = pool) {
  return (await countUsers(client)) === 0;
}

export function issueSetupToken() {
  setupToken = randomBytes(24).toString('base64url');
  setupTokenExpiresAt = Date.now() + SETUP_TOKEN_TTL_MS;
  console.log('──────────────────────────────────────────────────────────────');
  console.log('[SETUP] Aucun compte utilisateur. Créez le premier administrateur');
  console.log('[SETUP] depuis la page de connexion avec ce jeton (valide 30 min) :');
  console.log(`[SETUP]   ${setupToken}`);
  console.log('──────────────────────────────────────────────────────────────');
  return setupToken;
}

export function consumeSetupToken(candidate) {
  if (!setupToken || Date.now() > setupTokenExpiresAt) return false;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(setupToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  setupToken = null;
  setupTokenExpiresAt = 0;
  return true;
}

export function hasActiveSetupToken() {
  return Boolean(setupToken) && Date.now() <= setupTokenExpiresAt;
}

// au démarrage : nettoie l'ancien root et émet un jeton si nécessaire
export async function ensureSetupState() {
  await neutralizeLegacyDefaultAdmin();
  if (await needsSetup()) issueSetupToken();
}
