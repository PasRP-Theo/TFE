import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));

const { readCookie, setRefreshCookie, clearRefreshCookie, signAccessToken, verifyAccessToken } = await import('./tokens.js');

describe('cookie de rafraîchissement', () => {
  it('pose un cookie HttpOnly, Secure, SameSite=None, Partitioned limité à /auth', () => {
    const headers = [];
    setRefreshCookie({ append: (_k, v) => headers.push(v) }, 'abc');
    expect(headers[0]).toMatch(/^sentys_rt=abc;/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/auth']) {
      expect(headers[0]).toContain(attr);
    }
  });

  it('efface le cookie', () => {
    const headers = [];
    clearRefreshCookie({ append: (_k, v) => headers.push(v) });
    expect(headers[0]).toContain('Max-Age=0');
  });

  it('lit un cookie parmi plusieurs', () => {
    expect(readCookie({ headers: { cookie: 'a=1; sentys_rt=x%2By; b=2' } }, 'sentys_rt')).toBe('x+y');
    expect(readCookie({ headers: {} }, 'sentys_rt')).toBeNull();
  });
});

describe('jeton d\'accès', () => {
  it('expire après 15 minutes et porte l\'identifiant en sub', () => {
    const claims = verifyAccessToken(signAccessToken({ id: 4, username: 'bob', role: 'user', token_version: 2 }));
    expect(claims).toMatchObject({ id: 4, username: 'bob', tv: 2, iss: 'sentys', aud: 'sentys-api' });
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });
});
