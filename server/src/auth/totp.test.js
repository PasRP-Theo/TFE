import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, hotp, verifyTotp, currentCounter, buildOtpauthUrl, generateTotpSecret } from './totp.js';

// vecteurs de test RFC 6238 annexe B (SHA-1, clé ASCII « 12345678901234567890 »)
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP RFC 6238', () => {
  it('base32 aller-retour', () => {
    const buffer = Buffer.from('sentys-totp-test');
    expect(base32Decode(base32Encode(buffer)).equals(buffer)).toBe(true);
  });

  it('respecte les vecteurs de la RFC (6 derniers chiffres)', () => {
    const vectors = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']];
    for (const [seconds, expected] of vectors) {
      expect(hotp(RFC_SECRET, Math.floor(seconds / 30))).toBe(expected);
    }
  });

  it('accepte le code courant et ±1 période', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const counter = currentCounter(now);
    expect(verifyTotp(secret, hotp(secret, counter), { now })).toBe(counter);
    expect(verifyTotp(secret, hotp(secret, counter - 1), { now })).toBe(counter - 1);
    expect(verifyTotp(secret, hotp(secret, counter - 3), { now })).toBeNull();
  });

  it('refuse le rejeu d\'un code déjà utilisé', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = hotp(secret, currentCounter(now));
    const used = verifyTotp(secret, code, { now });
    expect(verifyTotp(secret, code, { now, lastCounter: used })).toBeNull();
  });

  it('refuse un format invalide', () => {
    expect(verifyTotp(generateTotpSecret(), 'abcdef')).toBeNull();
    expect(verifyTotp(generateTotpSecret(), '12345')).toBeNull();
  });

  it('construit une URI otpauth', () => {
    expect(buildOtpauthUrl('ABC', 'alice')).toBe('otpauth://totp/Sentys%3Aalice?secret=ABC&issuer=Sentys&algorithm=SHA1&digits=6&period=30');
  });
});
