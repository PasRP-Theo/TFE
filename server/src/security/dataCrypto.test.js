import { describe, it, expect, afterEach } from 'vitest';
import { encryptString, decryptString, isEncryptedWithCurrentKey, resetKeyring } from './dataCrypto.js';

afterEach(() => {
  delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
  resetKeyring();
});

describe('AES-256-GCM', () => {
  it('chiffre et déchiffre', () => {
    const payload = encryptString('mot de passe caméra', 'camera:1');
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload).not.toContain('caméra');
    expect(decryptString(payload, 'camera:1')).toBe('mot de passe caméra');
  });

  it('utilise un IV aléatoire', () => {
    expect(encryptString('x')).not.toBe(encryptString('x'));
  });

  it('détecte une altération', () => {
    const parts = encryptString('secret').split('.');
    parts[4] = Buffer.from('autre').toString('base64url');
    expect(() => decryptString(parts.join('.'))).toThrow();
  });

  it('lie le chiffré à son contexte (AAD)', () => {
    const payload = encryptString('secret', 'camera:1');
    expect(() => decryptString(payload, 'camera:2')).toThrow();
  });

  it('identifie la clé utilisée (rotation)', () => {
    expect(isEncryptedWithCurrentKey(encryptString('x'))).toBe(true);
    expect(isEncryptedWithCurrentKey('v1.deadbeef.a.b.c')).toBe(false);
  });
});
