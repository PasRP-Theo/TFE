import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  // JWT
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      return next();
    } catch { /* invalide */ }
  }

  // session
  if (req.session?.userId) {
    req.user = { id: req.session.userId, username: req.session.username, role: req.session.role };
    return next();
  }

  return res.status(401).json({ error: 'Non authentifié' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  next();
}