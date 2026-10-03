import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { pool } from '../db/index.js';

// jeton interne pour le détecteur IA lancé par le serveur (jamais stocké)
const INTERNAL_TOKEN = `sit_${randomBytes(32).toString('base64url')}`;
const DEVICE_TOKEN_PREFIX = 'sdt_';

// DEVICE_AUTH=legacy : accepte temporairement les appareils sans jeton (migration)
const LEGACY_MODE = process.env.DEVICE_AUTH === 'legacy';
const legacyWarned = new Set();

export function getInternalToken() {
  return INTERNAL_TOKEN;
}

export function hashDeviceToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function readBearer(req) {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function isInternalToken(token) {
  const a = Buffer.from(token);
  const b = Buffer.from(INTERNAL_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function issueDeviceToken(deviceId, label = '') {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  await pool.query(
    `INSERT INTO device_tokens (device_id, token_hash, label)
     VALUES ($1, $2, $3)
     ON CONFLICT (device_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, label = EXCLUDED.label,
           created_at = NOW(), last_used_at = NULL, revoked_at = NULL`,
    [deviceId, hashDeviceToken(token), label]
  );
  return token;
}

export async function revokeDeviceToken(deviceId) {
  const { rowCount } = await pool.query(
    'UPDATE device_tokens SET revoked_at = NOW() WHERE device_id = $1 AND revoked_at IS NULL',
    [deviceId]
  );
  return rowCount > 0;
}

export async function hasActiveDeviceToken(deviceId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM device_tokens WHERE device_id = $1 AND revoked_at IS NULL',
    [deviceId]
  );
  return rows.length > 0;
}

async function findDeviceByToken(token) {
  if (!token.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  const { rows } = await pool.query(
    `UPDATE device_tokens SET last_used_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING device_id`,
    [hashDeviceToken(token)]
  );
  return rows[0]?.device_id || null;
}

function legacyAllowed(req, res, next, deviceId) {
  if (!LEGACY_MODE) return res.status(401).json({ error: 'Jeton d\'appareil requis' });
  const key = deviceId || req.ip;
  if (!legacyWarned.has(key)) {
    legacyWarned.add(key);
    console.warn(`[DEVICE AUTH] Appareil sans jeton accepté (DEVICE_AUTH=legacy) : ${key}`);
  }
  req.device = { deviceId: deviceId || null, legacy: true };
  return next();
}

/**
 * Authentifie un appareil (Pi, ESP32) ou le détecteur IA interne.
 * getDeviceId(req) : identifiant attendu (paramètre d'URL ou corps) — le jeton doit lui correspondre.
 */
export function requireDevice({ getDeviceId = () => null, allowInternal = false } = {}) {
  return async (req, res, next) => {
    const token = readBearer(req);
    const expectedId = getDeviceId(req);
    try {
      if (token && allowInternal && isInternalToken(token)) {
        req.device = { deviceId: null, internal: true };
        return next();
      }
      if (!token) return legacyAllowed(req, res, next, expectedId);
      const deviceId = await findDeviceByToken(token);
      if (!deviceId) return res.status(401).json({ error: 'Jeton d\'appareil invalide' });
      if (expectedId && expectedId !== deviceId) return res.status(403).json({ error: 'Jeton non valable pour cet appareil' });
      req.device = { deviceId };
      return next();
    } catch (err) {
      console.error('[DEVICE AUTH]', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

/**
 * Annonce : acceptée sans jeton pour la découverte, sauf si l'appareil a déjà un jeton actif
 * (empêche d'usurper l'adresse ou le flux d'un appareil appairé).
 */
export function requireDeviceIfPaired(getDeviceId) {
  const strict = requireDevice({ getDeviceId });
  return async (req, res, next) => {
    const deviceId = getDeviceId(req);
    try {
      if (readBearer(req) || (deviceId && await hasActiveDeviceToken(deviceId))) {
        return strict(req, res, next);
      }
      req.device = { deviceId, unpaired: true };
      return next();
    } catch (err) {
      console.error('[DEVICE AUTH]', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}
