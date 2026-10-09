import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';

vi.mock('../db/index.js', async () => ({ pool: (await import('../../test/db.js')).testDb.pool }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 1, username: 'admin', role: 'admin' }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));

const { testDb } = await import('../../test/db.js');
const { default: usersRouter } = await import('./users.js');
const { hashPassword, verifyPassword } = await import('../auth/passwords.js');
const { pool } = testDb;

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await testDb.reset();
  await pool.query(
    `INSERT INTO users (username, password, role) VALUES ('admin', $1, 'admin'), ('bob', $1, 'user')`,
    [await hashPassword('ancien-mot-de-passe-solide')]
  );
  await pool.query(`UPDATE users SET failed_login_count = 7, locked_until = NOW() + INTERVAL '1 hour' WHERE username = 'bob'`);
});

afterAll(async () => {
  server?.close();
  await testDb.close();
});

const patch = (id, body) => fetch(`${base}/api/users/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('PATCH /api/users/:id (base réelle)', () => {
  it('réinitialise le mot de passe : le nouveau fonctionne, le compte est déverrouillé, les sessions fermées', async () => {
    const res = await patch(2, { password: 'nouvelle-phrase-de-passe-42' });
    expect(res.status).toBe(200);

    const { rows } = await pool.query('SELECT password, failed_login_count, locked_until, token_version FROM users WHERE id = 2');
    expect((await verifyPassword('nouvelle-phrase-de-passe-42', rows[0].password)).valid).toBe(true);
    expect((await verifyPassword('ancien-mot-de-passe-solide', rows[0].password)).valid).toBe(false);
    expect(rows[0].failed_login_count).toBe(0);
    expect(rows[0].locked_until).toBeNull();
    expect(rows[0].token_version).toBe(1);
  });

  it('change le nom et le rôle en même temps', async () => {
    const res = await patch(2, { username: 'Robert', role: 'admin' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: 'robert', role: 'admin' });
  });

  it('refuse de rétrograder le dernier administrateur', async () => {
    const res = await patch(1, { role: 'user' });
    expect(res.status).toBe(400);
  });

  it('refuse un identifiant déjà utilisé', async () => {
    const res = await patch(2, { username: 'admin' });
    expect(res.status).toBe(409);
  });
});
