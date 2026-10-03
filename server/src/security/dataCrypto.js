import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';
import { loadSecret } from '../config/secrets.js';

// Chiffrement applicatif AES-256-GCM (identifiants caméras, secrets MFA).
// Clé dérivée (HKDF-SHA256) de DATA_ENCRYPTION_KEY, conservée hors base.
// Format : v1.<kid>.<iv>.<tag>.<chiffré> (base64url) — kid permet la rotation.
const FORMAT_VERSION = 'v1';

function deriveKey(secret) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from('sentys'), Buffer.from('data-encryption-v1'), 32));
}

function keyId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function buildKeyring() {
  const isTest = process.env.NODE_ENV === 'test';
  const current = deriveKey(isTest ? 'test-data-key-'.padEnd(48, 'x') : loadSecret('DATA_ENCRYPTION_KEY'));
  const keys = new Map([[keyId(current), current]]);
  // ancienne clé conservée pour déchiffrer pendant une rotation
  if (process.env.DATA_ENCRYPTION_KEY_PREVIOUS) {
    const previous = deriveKey(process.env.DATA_ENCRYPTION_KEY_PREVIOUS);
    keys.set(keyId(previous), previous);
  }
  return { current, currentId: keyId(current), keys };
}

let keyring = null;
function getKeyring() {
  keyring ??= buildKeyring();
  return keyring;
}

export function encryptString(plaintext, associatedData = '') {
  const { current, currentId } = getKeyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [FORMAT_VERSION, currentId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptString(payload, associatedData = '') {
  const [version, kid, iv, tag, data] = String(payload || '').split('.');
  if (version !== FORMAT_VERSION || !kid || !iv || !tag || data === undefined) {
    throw new Error('Format chiffré invalide');
  }
  const key = getKeyring().keys.get(kid);
  if (!key) throw new Error(`Clé de chiffrement inconnue (${kid})`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function isEncryptedWithCurrentKey(payload) {
  return String(payload || '').split('.')[1] === getKeyring().currentId;
}

// tests / rotation : recharge les clés depuis l'environnement
export function resetKeyring() {
  keyring = null;
}
