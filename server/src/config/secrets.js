import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import os from 'os';
import path from 'path';

// Secrets : variable d'environnement prioritaire, sinon généré une fois et conservé
// hors du dépôt (le déploiement fait un `git clean -fdx`).
export const DATA_DIR = process.env.SENTYS_DATA_DIR || path.join(os.homedir(), '.sentys');
export const SECRETS_FILE = process.env.SENTYS_SECRETS_FILE || path.join(DATA_DIR, 'secrets.json');

// valeurs d'exemple ou triviales déjà publiées : refusées au démarrage
const KNOWN_WEAK = new Set([
  'demo_tfe', 'admin', 'root', 'secret', 'changeme', 'change_me', 'password', 'motdepasse',
  'test', 'test-secret', 'sentys', 'jwt_secret', 'une_chaine_aleatoire_longue',
  '<secret_aleatoire_long>', 'votre_secret', 'mot_de_passe',
]);

export class WeakSecretError extends Error {}

export function assertStrongSecret(name, value, minBytes = 32) {
  const normalized = String(value || '').trim();
  if (KNOWN_WEAK.has(normalized.toLowerCase())) {
    throw new WeakSecretError(`[SECRETS] ${name} utilise une valeur connue/publiée. Retirez-la du .env (elle sera générée) ou fournissez une valeur aléatoire (openssl rand -base64 48).`);
  }
  if (Buffer.byteLength(normalized) < minBytes) {
    throw new WeakSecretError(`[SECRETS] ${name} trop court (${minBytes} octets minimum). Générez-le avec : openssl rand -base64 48`);
  }
  return normalized;
}

function readStore() {
  if (!existsSync(SECRETS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SECRETS_FILE, 'utf8'));
  } catch {
    throw new Error(`[SECRETS] ${SECRETS_FILE} illisible : corrigez ou restaurez la sauvegarde avant de démarrer.`);
  }
}

function writeStore(store) {
  mkdirSync(path.dirname(SECRETS_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(SECRETS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  try { chmodSync(SECRETS_FILE, 0o600); } catch { /* Windows */ }
}

/**
 * Renvoie le secret `name` (base64). Ordre : env → fichier de secrets → génération.
 * Un secret généré est persisté : le perdre rend illisibles les données qu'il protège
 * (poivre des mots de passe, clé de chiffrement) — à inclure dans les sauvegardes chiffrées.
 */
export function loadSecret(name, { minBytes = 32, generateBytes = 48 } = {}) {
  if (process.env[name]) return assertStrongSecret(name, process.env[name], minBytes);

  const store = readStore();
  if (store[name]) return assertStrongSecret(name, store[name], minBytes);

  const generated = randomBytes(generateBytes).toString('base64');
  writeStore({ ...store, [name]: generated });
  console.log(`[SECRETS] ${name} généré et enregistré dans ${SECRETS_FILE}`);
  return generated;
}

// secrets non générables (fournis par l'administrateur) : avertissement si faibles
export function warnIfWeak(name, value, minBytes = 12) {
  try {
    if (value) assertStrongSecret(name, value, minBytes);
  } catch (err) {
    console.warn(err.message.replace('[SECRETS]', '[SECRETS ⚠]'));
  }
}
