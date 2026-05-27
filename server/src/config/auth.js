if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[AUTH] JWT_SECRET doit être défini en production. Démarrage refusé.');
  } else {
    console.warn('[AUTH] ⚠ JWT_SECRET non défini — valeur par défaut utilisée (dev uniquement)');
  }
}

export const JWT_SECRET = process.env.JWT_SECRET || 'changeme_in_production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';