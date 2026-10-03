import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// TOTP RFC 6238 (HMAC-SHA1, 6 chiffres, 30 s) — compatible avec les applications d'authentification
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function hotp(secretBase32, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentCounter(now = Date.now()) {
  return Math.floor(now / 1000 / PERIOD_SECONDS);
}

/**
 * Vérifie un code avec une tolérance de ±1 période. Refuse tout compteur ≤ lastCounter (rejeu).
 * @returns {number|null} compteur accepté
 */
export function verifyTotp(secretBase32, code, { lastCounter = -1, now = Date.now() } = {}) {
  const candidate = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const base = currentCounter(now);
  for (const counter of [base - 1, base, base + 1]) {
    if (counter <= lastCounter) continue;
    const expected = Buffer.from(hotp(secretBase32, counter));
    if (timingSafeEqual(expected, Buffer.from(candidate))) return counter;
  }
  return null;
}

export function buildOtpauthUrl(secretBase32, username, issuer = 'Sentys') {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
