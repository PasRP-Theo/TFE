import { loadSecret } from './secrets.js';

const isTest = process.env.NODE_ENV === 'test';

// JWT_SECRET : env, sinon généré et conservé hors du dépôt ; valeurs faibles refusées
export const JWT_SECRET = isTest ? 'test-secret-'.padEnd(48, 'x') : loadSecret('JWT_SECRET');
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
