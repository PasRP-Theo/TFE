import { authenticateAccessToken } from '../auth/tokens.js';

// jeton d'accès ES256 en en-tête Authorization ; rôle relu en base (cache 10 s)
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const user = await authenticateAccessToken(header.slice(7));
    if (!user) return res.status(401).json({ error: 'Session expirée' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expirée' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  next();
}
