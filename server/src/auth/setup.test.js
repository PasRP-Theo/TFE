import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));

const { issueSetupToken, consumeSetupToken, hasActiveSetupToken } = await import('./setup.js');

describe('jeton d\'installation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('refuse un jeton invalide ou absent', () => {
    expect(consumeSetupToken('nimporte-quoi')).toBe(false);
    issueSetupToken();
    expect(consumeSetupToken('mauvais')).toBe(false);
    expect(consumeSetupToken(undefined)).toBe(false);
  });

  it('accepte le jeton une seule fois', () => {
    const token = issueSetupToken();
    expect(hasActiveSetupToken()).toBe(true);
    expect(consumeSetupToken(token)).toBe(true);
    expect(consumeSetupToken(token)).toBe(false);
    expect(hasActiveSetupToken()).toBe(false);
  });

  it('expire après 30 minutes', () => {
    vi.useFakeTimers();
    const token = issueSetupToken();
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(consumeSetupToken(token)).toBe(false);
    vi.useRealTimers();
  });
});
