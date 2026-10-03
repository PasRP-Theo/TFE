import { createHmac, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { loadSecret } from '../config/secrets.js';

// bcrypt (coût 12, OWASP) précédé d'un HMAC-SHA256 avec poivre hors base :
// - une fuite de la base seule ne permet pas d'attaque hors ligne
// - supprime la troncature silencieuse de bcrypt à 72 octets (mots de passe longs autorisés)
const BCRYPT_COST = 12;
const PEPPERED_PREFIX = 'pep1:';
const PEPPER = process.env.NODE_ENV === 'test'
  ? 'test-pepper-'.padEnd(48, 'x')
  : loadSecret('PASSWORD_PEPPER');

function prehash(password) {
  // NFKC : NIST 800-63B §3.1.1.2 (normalisation Unicode)
  return createHmac('sha256', PEPPER).update(String(password).normalize('NFKC')).digest('base64');
}

export async function hashPassword(password) {
  return PEPPERED_PREFIX + await bcrypt.hash(prehash(password), BCRYPT_COST);
}

/** @returns {{ valid: boolean, needsRehash: boolean }} */
export async function verifyPassword(password, storedHash) {
  const stored = String(storedHash || '');
  if (stored.startsWith(PEPPERED_PREFIX)) {
    const valid = await bcrypt.compare(prehash(password), stored.slice(PEPPERED_PREFIX.length));
    return { valid, needsRehash: false };
  }
  // ancien format (bcrypt seul) : migré à la prochaine connexion réussie
  const valid = stored ? await bcrypt.compare(String(password), stored) : false;
  return { valid, needsRehash: valid };
}

// comparaison factice pour un identifiant inconnu : même durée de réponse (anti-énumération)
let dummyHashPromise = null;
export async function burnPasswordCheck(password) {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('base64'));
  await verifyPassword(password, await dummyHashPromise);
}
