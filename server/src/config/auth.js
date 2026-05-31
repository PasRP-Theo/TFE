const isTest = process.env.NODE_ENV === 'test';

if (!process.env.JWT_SECRET && !isTest) {
  throw new Error('[AUTH] JWT_SECRET doit être défini dans .env. Démarrage refusé.');
}

export const JWT_SECRET = process.env.JWT_SECRET || (isTest ? 'test-secret' : undefined);
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';