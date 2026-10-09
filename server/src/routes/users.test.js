import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

const query = vi.fn();
vi.mock('../db/index.js', () => ({ pool: { query: (...args) => query(...args) } }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 1, username: 'admin', role: 'admin' }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
vi.mock('../audit/log.js', () => ({ logAudit: vi.fn() }));
vi.mock('../auth/passwords.js', () => ({ hashPassword: vi.fn(async () => 'HASHED') }));
vi.mock('../auth/tokens.js', () => ({ revokeAllSessions: vi.fn(), invalidateUserState: vi.fn() }));
vi.mock('../auth/mfa.js', () => ({ disableMfa: vi.fn() }));
vi.mock('../privacy/userData.js', () => ({ deleteUserAccount: vi.fn() }));

const { default: usersRouter } = await import('./users.js');
const { revokeAllSessions } = await import('../auth/tokens.js');

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());

beforeEach(() => {
  query.mockReset();
  query.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT id, username, role FROM users')) {
      return { rows: [{ id: 5, username: 'bob', role: 'user' }] };
    }
    return { rows: [{ id: 5, username: 'bob', role: 'user', created_at: new Date().toISOString() }] };
  });
});

describe('PATCH /api/users/:id (réinitialisation du mot de passe par un admin)', () => {
  it('enregistre le hachage via un paramètre SQL et ferme les sessions', async () => {
    const res = await fetch(`${base}/api/users/5`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'une-phrase-de-passe-solide-42' }),
    });
    expect(res.status).toBe(200);

    const [sql, values] = query.mock.calls.find(([q]) => q.startsWith('UPDATE users SET'));
    expect(sql).toMatch(/password = \$1/);
    expect(values[0]).toBe('HASHED');
    // chaque paramètre fourni est référencé dans la requête
    values.forEach((_, i) => expect(sql).toContain(`$${i + 1}`));
    expect(revokeAllSessions).toHaveBeenCalledWith(5);
  });
});
