import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

const { pseudonymFor } = await import('./userData.js');

describe('pseudonymisation du journal', () => {
  it('est stable pour un même compte et ne contient pas l\'identifiant', () => {
    expect(pseudonymFor(12)).toBe(pseudonymFor(12));
    expect(pseudonymFor(12)).not.toBe(pseudonymFor(13));
    expect(pseudonymFor(12)).toMatch(/^utilisateur-supprimé-[0-9a-f]{8}$/);
  });
});
