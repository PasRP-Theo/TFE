import { randomBytes } from 'crypto';
import { pool } from '../db/index.js';
import { encryptString, decryptString } from '../security/dataCrypto.js';
import { pepperedDigest } from './passwords.js';
import { generateTotpSecret, verifyTotp, buildOtpauthUrl, base32Encode } from './totp.js';

const RECOVERY_CODE_COUNT = 10;
const aad = userId => `totp:${userId}`;

export async function getMfaState(userId) {
  const { rows } = await pool.query(
    `SELECT u.totp_enabled,
            (SELECT COUNT(*)::int FROM mfa_recovery_codes c WHERE c.user_id = u.id AND c.used_at IS NULL) AS recovery_codes_remaining
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  return {
    mfaEnabled: Boolean(rows[0]?.totp_enabled),
    recoveryCodesRemaining: rows[0]?.recovery_codes_remaining ?? 0,
  };
}

// étape 1 : secret en attente (chiffré), affiché une fois à l'utilisateur
export async function beginTotpEnrollment(user) {
  const secret = generateTotpSecret();
  await pool.query('UPDATE users SET totp_pending_enc = $2 WHERE id = $1', [user.id, encryptString(secret, aad(user.id))]);
  return { secret, otpauthUrl: buildOtpauthUrl(secret, user.username) };
}

function generateRecoveryCode() {
  const raw = base32Encode(randomBytes(7)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

async function replaceRecoveryCodes(client, userId) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await client.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
  for (const code of codes) {
    await client.query(
      'INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)',
      [userId, pepperedDigest(normalizeRecoveryCode(code))]
    );
  }
  return codes;
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

// étape 2 : un premier code valide confirme l'enrôlement ; renvoie les codes de récupération
export async function confirmTotpEnrollment(userId, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT totp_pending_enc FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0]?.totp_pending_enc) {
      await client.query('ROLLBACK');
      return null;
    }
    const secret = decryptString(rows[0].totp_pending_enc, aad(userId));
    const counter = verifyTotp(secret, code);
    if (counter === null) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL,
              totp_enabled = true, totp_last_counter = $2
       WHERE id = $1`,
      [userId, counter]
    );
    const codes = await replaceRecoveryCodes(client, userId);
    await client.query('COMMIT');
    return codes;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  finally {
    client.release();
  }
}

/**
 * Vérifie un second facteur : code TOTP (anti-rejeu) ou code de récupération (usage unique).
 * @returns {'totp'|'recovery'|null}
 */
export async function verifySecondFactor(userId, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT totp_enabled, totp_secret_enc, totp_last_counter FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    const user = rows[0];
    if (!user?.totp_enabled || !user.totp_secret_enc) {
      await client.query('ROLLBACK');
      return null;
    }
    const secret = decryptString(user.totp_secret_enc, aad(userId));
    const counter = verifyTotp(secret, code, { lastCounter: Number(user.totp_last_counter ?? -1) });
    if (counter !== null) {
      await client.query('UPDATE users SET totp_last_counter = $2 WHERE id = $1', [userId, counter]);
      await client.query('COMMIT');
      return 'totp';
    }
    const normalized = normalizeRecoveryCode(code);
    if (normalized.length === 10) {
      const { rowCount } = await client.query(
        `UPDATE mfa_recovery_codes SET used_at = NOW()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
        [userId, pepperedDigest(normalized)]
      );
      if (rowCount > 0) {
        await client.query('COMMIT');
        return 'recovery';
      }
    }
    await client.query('ROLLBACK');
    return null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function regenerateRecoveryCodes(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const codes = await replaceRecoveryCodes(client, userId);
    await client.query('COMMIT');
    return codes;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function disableMfa(userId) {
  await pool.query(
    `UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_pending_enc = NULL, totp_last_counter = NULL
     WHERE id = $1`,
    [userId]
  );
  await pool.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
}
