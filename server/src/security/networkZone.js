// deux listeners : LAN (appareils + interface locale) et public (cible du tunnel, 127.0.0.1 uniquement)
export const PUBLIC_PORT = process.env.PUBLIC_PORT ? Number(process.env.PUBLIC_PORT) : null;

export function isPublicRequest(req) {
  return PUBLIC_PORT !== null && req.socket?.localPort === PUBLIC_PORT;
}

// routes réservées aux appareils du réseau local : invisibles depuis le tunnel
export function lanOnly(req, res, next) {
  if (isPublicRequest(req)) return res.status(404).json({ error: 'Introuvable' });
  next();
}
