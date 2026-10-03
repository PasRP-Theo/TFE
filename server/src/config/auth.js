import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import path from 'path';
import { DATA_DIR } from './secrets.js';

// Jetons d'accès signés en ECDSA P-256 (ES256) : la clé publique seule permet de vérifier.
// Clé conservée hors du dépôt (~/.sentys/jwt-es256.pem) ou fournie via JWT_PRIVATE_KEY_FILE.
const isTest = process.env.NODE_ENV === 'test';
const KEY_FILE = process.env.JWT_PRIVATE_KEY_FILE || path.join(DATA_DIR, 'jwt-es256.pem');

function loadSigningKey() {
  if (isTest) return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  if (existsSync(KEY_FILE)) return createPrivateKey(readFileSync(KEY_FILE));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  try { chmodSync(KEY_FILE, 0o600); } catch { /* Windows */ }
  console.log(`[AUTH] Clé de signature ES256 générée : ${KEY_FILE}`);
  return privateKey;
}

export const JWT_PRIVATE_KEY = loadSigningKey();
export const JWT_PUBLIC_KEY = createPublicKey(JWT_PRIVATE_KEY);
export const JWT_ALGORITHM = 'ES256';
export const JWT_ISSUER = 'sentys';
export const JWT_AUDIENCE = 'sentys-api';

// jeton d'accès court (ASVS V3) ; le jeton de rafraîchissement, opaque, est en cookie HttpOnly
export const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
export const REFRESH_TOKEN_IDLE_DAYS = Number(process.env.REFRESH_TOKEN_IDLE_DAYS || 7);
export const REFRESH_TOKEN_ABSOLUTE_DAYS = Number(process.env.REFRESH_TOKEN_ABSOLUTE_DAYS || 30);
