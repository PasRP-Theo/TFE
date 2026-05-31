if (!process.env.JWT_SECRET) {
  throw new Error('[AUTH] JWT_SECRET doit être défini dans .env. Démarrage refusé.');
}

export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';