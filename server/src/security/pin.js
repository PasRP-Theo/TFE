import { timingSafeEqual } from 'crypto';
import { pepperedDigest } from '../auth/passwords.js';

// PIN d'armement : 4 à 8 chiffres, stocké en HMAC poivré (jamais en clair, jamais renvoyé).
// L'espace de 10^4 valeurs ne résiste qu'avec le poivre hors base et la limitation de tentatives.
export const LEGACY_DEFAULT_PIN = '1234';

export function isValidPinFormat(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

export function hashPin(pin) {
  return pepperedDigest(`pin:${pin}`);
}

export function verifyPin(pin, storedHash) {
  if (!isValidPinFormat(pin) || !storedHash) return false;
  const a = Buffer.from(hashPin(pin), 'hex');
  const b = Buffer.from(String(storedHash), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
