import { describe, it, expect, vi } from 'vitest';
import { isNumericId, numericIdParam } from './validators.js';

describe('isNumericId', () => {
  it('accepte les identifiants numériques', () => {
    expect(isNumericId('1')).toBe(true);
    expect(isNumericId(42)).toBe(true);
  });

  it('refuse les chemins et valeurs non numériques', () => {
    for (const value of ['..', '../1', '1a', '', ' 1', '1/2', '-1', undefined, null]) {
      expect(isNumericId(value)).toBe(false);
    }
  });
});

describe('numericIdParam', () => {
  it('laisse passer un id valide et bloque le reste', () => {
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn() };
    numericIdParam({}, res, next, '12');
    expect(next).toHaveBeenCalledOnce();
    numericIdParam({}, res, next, '..');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).toHaveBeenCalledOnce();
  });
});
