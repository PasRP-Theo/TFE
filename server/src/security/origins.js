// liste blanche des origines (frontend Vercel + interface LAN)
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:4000'];

// protection CSRF des routes à cookie (refresh, logout) : Origin absent (même origine
// GET) ou présent dans la liste blanche, ou identique à l'hôte servi
export function isTrustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
