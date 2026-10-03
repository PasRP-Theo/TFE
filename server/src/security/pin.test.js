import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, isValidPinFormat } from './pin.js';

describe('PIN d\'armement', () => {
  it('valide le format 4 à 8 chiffres', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('12345678')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat(1234)).toBe(false);
  });

  it('ne stocke jamais le PIN en clair', () => {
    const hash = hashPin('4821');
    expect(hash).not.toContain('4821');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('vérifie le bon PIN uniquement', () => {
    const hash = hashPin('4821');
    expect(verifyPin('4821', hash)).toBe(true);
    expect(verifyPin('4822', hash)).toBe(false);
    expect(verifyPin('4821', null)).toBe(false);
  });
});
