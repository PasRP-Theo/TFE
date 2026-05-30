import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { requireAuth, requireAdmin } from './auth.js';
import { JWT_SECRET } from '../config/auth.js';

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('requireAuth', () => {
  let res, next;

  beforeEach(() => {
    res = makeRes();
    next = vi.fn();
  });

  it('retourne 401 si aucun header Authorization ni session', () => {
    const req = { headers: {}, session: {} };
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retourne 401 si le token JWT est invalide', () => {
    const req = { headers: { authorization: 'Bearer tokenbidon' }, session: {} };
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepte un JWT valide et appelle next()', () => {
    const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` }, session: {} };
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('admin');
  });

  it('accepte une session valide si pas de token', () => {
    const req = { headers: {}, session: { userId: 2, username: 'user', role: 'user' } };
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('user');
  });

  it('préfère le JWT à la session si les deux sont présents', () => {
    const token = jwt.sign({ id: 1, username: 'jwt-user', role: 'admin' }, JWT_SECRET);
    const req = {
      headers: { authorization: `Bearer ${token}` },
      session: { userId: 99, username: 'session-user', role: 'user' },
    };
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.username).toBe('jwt-user');
  });
});

describe('requireAdmin', () => {
  let res, next;

  beforeEach(() => {
    res = makeRes();
    next = vi.fn();
  });

  it('retourne 403 si l\'utilisateur a le rôle "user"', () => {
    const req = { user: { role: 'user' } };
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('retourne 403 si req.user est absent', () => {
    const req = {};
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('appelle next() si l\'utilisateur est admin', () => {
    const req = { user: { role: 'admin' } };
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
