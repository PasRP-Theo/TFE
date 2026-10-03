import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const users = new Map();

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn(async (_sql, [id]) => ({ rows: users.has(id) ? [users.get(id)] : [] })) },
}));

const { requireAuth, requireAdmin } = await import('./auth.js');
const { signAccessToken, invalidateUserState } = await import('../auth/tokens.js');

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

async function run(headers) {
  const req = { headers };
  const res = makeRes();
  const next = vi.fn();
  await requireAuth(req, res, next);
  return { req, res, next };
}

beforeEach(() => {
  users.clear();
  users.set(1, { id: 1, username: 'alice', role: 'admin', token_version: 0 });
  invalidateUserState(1);
});

describe('requireAuth', () => {
  it('retourne 401 sans en-tête Authorization', async () => {
    const { res, next } = await run({});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retourne 401 pour un jeton invalide', async () => {
    const { res } = await run({ authorization: 'Bearer tokenbidon' });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('refuse un jeton HS256 (confusion d\'algorithme)', async () => {
    const forged = jwt.sign({ username: 'alice', role: 'admin', tv: 0 }, 'secret', { subject: '1', issuer: 'sentys', audience: 'sentys-api' });
    const { res } = await run({ authorization: `Bearer ${forged}` });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepte un jeton ES256 valide et prend le rôle en base', async () => {
    const token = signAccessToken({ id: 1, username: 'alice', role: 'user', token_version: 0 });
    const { req, next } = await run({ authorization: `Bearer ${token}` });
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: 1, username: 'alice', role: 'admin' });
  });

  it('refuse un jeton après déconnexion globale (token_version incrémenté)', async () => {
    const token = signAccessToken({ id: 1, username: 'alice', role: 'admin', token_version: 0 });
    users.set(1, { ...users.get(1), token_version: 1 });
    invalidateUserState(1);
    const { res } = await run({ authorization: `Bearer ${token}` });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('refuse le jeton d\'un compte supprimé', async () => {
    const token = signAccessToken({ id: 1, username: 'alice', role: 'admin', token_version: 0 });
    users.delete(1);
    invalidateUserState(1);
    const { res } = await run({ authorization: `Bearer ${token}` });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('refuse un jeton intermédiaire MFA', async () => {
    const token = signAccessToken({ id: 1, username: 'alice', role: 'admin', token_version: 0 }, { mfa: 'pending' });
    const { res } = await run({ authorization: `Bearer ${token}` });
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireAdmin', () => {
  it('bloque un utilisateur non admin', () => {
    const res = makeRes();
    const next = vi.fn();
    requireAdmin({ user: { role: 'user' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('laisse passer un admin', () => {
    const next = vi.fn();
    requireAdmin({ user: { role: 'admin' } }, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
