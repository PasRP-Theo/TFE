import { describe, it, expect } from 'vitest';
import { validatePassword } from './passwordPolicy.js';

describe('validatePassword (NIST 800-63B)', () => {
  it('exige 15 caractères sans MFA', () => {
    expect(validatePassword('a'.repeat(14))).toMatch(/15/);
    expect(validatePassword('a'.repeat(15))).toBeNull();
  });

  it('accepte 8 caractères avec MFA', () => {
    expect(validatePassword('a'.repeat(8), { mfaEnabled: true })).toBeNull();
  });

  it('accepte au moins 64 caractères, refuse au-delà de 128', () => {
    expect(validatePassword('é'.repeat(64))).toBeNull();
    expect(validatePassword('a'.repeat(129))).toMatch(/128/);
  });

  it('n\'impose aucune règle de composition', () => {
    expect(validatePassword('correct horse battery staple')).toBeNull();
  });
});
