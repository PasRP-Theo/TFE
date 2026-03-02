import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  // 1. Essai JWT
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      return next();
    } catch { /* invalide, on essaie la session */ }
  }

  // 2. Essai session cookie
  if (req.session?.userId) {
    req.user = { id: req.session.userId, email: req.session.email, role: req.session.role };
    return next();
  }

  return res.status(401).json({ error: 'Non authentifié' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  next();
}