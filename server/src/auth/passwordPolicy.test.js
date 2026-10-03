import { describe, it, expect } from 'vitest';
import { validatePassword } from './passwordPolicy.js';

describe('validatePassword (NIST 800-63B)', () => {
  it('exige 15 caractères sans MFA', () => {
    expect(validatePassword('vélo rouge 2026')).toBeNull();
    expect(validatePassword('vélo rouge 202')).toMatch(/15/);
  });

  it('accepte 8 caractères avec MFA', () => {
    expect(validatePassword('pomme#42', { mfaEnabled: true })).toBeNull();
  });

  it('accepte au moins 64 caractères, refuse au-delà de 128', () => {
    const sixtyFour = 'Le hérisson traverse la route après minuit sous une pluie fine.!';
    expect([...sixtyFour].length).toBe(64);
    expect(validatePassword(sixtyFour)).toBeNull();
    expect(validatePassword('ab'.repeat(65))).toMatch(/128/);
  });

  it('n\'impose aucune règle de composition', () => {
    expect(validatePassword('une phrase de passe toute simple')).toBeNull();
  });

  it('refuse les mots de passe courants et triviaux', () => {
    expect(validatePassword('123456789012345')).toMatch(/courant/);
    expect(validatePassword('PasswordPassword')).toMatch(/courant/);
    expect(validatePassword('abababababababab')).toMatch(/courant/);
  });

  it('refuse l\'identifiant et le nom du service', () => {
    expect(validatePassword('theo-mertens-maison', { username: 'theo-mertens' })).toMatch(/identifiant/);
    expect(validatePassword('ma maison sentys 2026')).toMatch(/service/);
  });
});
