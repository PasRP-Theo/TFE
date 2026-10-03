import { createHash, randomBytes, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';
import {
  JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE,
  ACCESS_TOKEN_TTL, REFRESH_TOKEN_IDLE_DAYS, REFRESH_TOKEN_ABSOLUTE_DAYS,
} from '../config/auth.js';

export const REFRESH_COOKIE = 'sentys_rt';
const REFRESH_COOKIE_PATH = '/auth';

// ── jeton d'accès (ES256, 15 min) ───────────────────────────────────────────

export function signAccessToken(user, extraClaims = {}, { expiresIn = ACCESS_TOKEN_TTL } = {}) {
  return jwt.sign(
    { username: user.username, role: user.role, tv: user.token_version ?? 0, ...extraClaims },
    JWT_PRIVATE_KEY,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: String(user.id),
    }
  );
}

/** @returns {{ id: number, username: string, role: string, tv: number, exp: number, mfa?: string }} */
export function verifyAccessToken(token) {
  const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  return { ...claims, id: Number(claims.sub) };
}

// ── état utilisateur faisant autorité (rôle, révocation globale) ─────────────

const USER_STATE_TTL_MS = 10_000;
const userStateCache = new Map();

export async function getUserState(userId) {
  const cached = userStateCache.get(userId);
  if (cached && Date.now() - cached.at < USER_STATE_TTL_MS) return cached.state;
  const { rows } = await pool.query(
    'SELECT id, username, role, token_version FROM users WHERE id = $1',
    [userId]
  );
  const state = rows[0] || null;
  userStateCache.set(userId, { state, at: Date.now() });
  return state;
}

export function invalidateUserState(userId) {
  userStateCache.delete(Number(userId));
}

// vérifie le jeton puis l'état en base : compte supprimé, déconnexion globale
export async function authenticateAccessToken(token) {
  const claims = verifyAccessToken(token);
  if (claims.mfa) return null; // jeton intermédiaire MFA : pas un jeton d'accès
  const state = await getUserState(claims.id);
  if (!state || Number(state.token_version) !== Number(claims.tv)) return null;
  return { id: state.id, username: state.username, role: state.role, exp: claims.exp };
}

// ── jeton de rafraîchissement (opaque, rotation, détection de réutilisation) ──

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(userId, { familyId = randomUUID(), familyStartedAt = null, req } = {}) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, family_started_at, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, COALESCE($4, NOW()),
             LEAST(NOW() + $5 * INTERVAL '1 day', COALESCE($4, NOW()) + $6 * INTERVAL '1 day'),
             $7, $8)`,
    [userId, familyId, hashToken(token), familyStartedAt, REFRESH_TOKEN_IDLE_DAYS, REFRESH_TOKEN_ABSOLUTE_DAYS,
      String(req?.headers['user-agent'] || '').slice(0, 255), req?.ip || null]
  );
  return token;
}

/**
 * Rotation : l'ancien jeton est révoqué, un nouveau est émis dans la même famille.
 * Un jeton déjà révoqué présenté à nouveau = vol probable → toute la famille est révoquée.
 * @returns {{ status: 'ok', userId, token } | { status: 'invalid' | 'reused', userId? }}
 */
export async function rotateRefreshToken(presented, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, user_id, family_id, family_started_at, revoked_at, expires_at < NOW() AS expired
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(presented)]
    );
    const current = rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { status: 'invalid' };
    }
    if (current.revoked_at) {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE family_id = $1',
        [current.family_id]
      );
      await client.query('COMMIT');
      return { status: 'reused', userId: current.user_id };
    }
    if (current.expired) {
      await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [current.id]);
      await client.query('COMMIT');
      return { status: 'invalid' };
    }
    await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [current.id]);
    await client.query('COMMIT');
    const token = await issueRefreshToken(current.user_id, {
      familyId: current.family_id,
      familyStartedAt: current.family_started_at,
      req,
    });
    return { status: 'ok', userId: current.user_id, token };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeRefreshFamily(presented) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [hashToken(presented)]
  );
}

// déconnexion de tous les appareils : jetons d'accès (token_version) et de rafraîchissement
export async function revokeAllSessions(userId) {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
  await pool.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1', [userId]);
  // compromission possible : plus aucune alerte vers les appareils de ce compte
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
  invalidateUserState(userId);
}

// ── cookie ──────────────────────────────────────────────────────────────────

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

// HttpOnly (inaccessible au JS), Secure, SameSite=None + Partitioned (CHIPS) :
// le frontend Vercel et l'API (tunnel) sont deux sites distincts
export function setRefreshCookie(res, token) {
  const maxAge = REFRESH_TOKEN_IDLE_DAYS * 24 * 60 * 60;
  res.append('Set-Cookie',
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Path=${REFRESH_COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`);
}

export function clearRefreshCookie(res) {
  res.append('Set-Cookie',
    `${REFRESH_COOKIE}=; Path=${REFRESH_COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`);
}
