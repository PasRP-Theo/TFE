import { existsSync, readFileSync } from 'fs';

// politique NIST SP 800-63B rév. 4 : longueur, liste de refus, pas de règles de composition
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MIN_LENGTH_WITH_MFA = 8;
export const PASSWORD_MAX_LENGTH = 128;

// liste de refus intégrée (mots de passe longs mais très courants) ; une liste plus
// complète peut être fournie hors ligne via BREACHED_PASSWORDS_FILE (un par ligne)
const BUILTIN_BLOCKLIST = [
  '123456789012345', '1234567890123456', '12345678901234567890', '000000000000000',
  '111111111111111', 'azertyuiopqsdfgh', 'azertyuiopqsdfghjklm', 'qwertyuiopasdfgh',
  'qwertyuiopasdfghjkl', 'passwordpassword', 'motdepassemotdepasse', 'motdepasse123456',
  'password12345678', 'password1234567', 'iloveyouiloveyou', 'jetaimejetaime12',
  'administrateur123', 'administrator123', 'adminadminadmin', 'rootrootrootroot',
  'welcome123456789', 'bienvenue1234567', 'changeme12345678', 'letmeinletmein12',
  'correcthorsebatterystaple', 'correct horse battery staple', 'trustno1trustno1',
  'abcdefghijklmnop', 'abcdefghijklmnopqrstuvwxyz', 'aaaaaaaaaaaaaaaa',
  'surveillance1234', 'camera1234567890', 'raspberrypi12345', 'raspberry1234567',
];

let blocklist = null;

function loadBlocklist() {
  if (blocklist) return blocklist;
  blocklist = new Set(BUILTIN_BLOCKLIST);
  const file = process.env.BREACHED_PASSWORDS_FILE;
  if (file && existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const entry = line.trim().toLowerCase();
      if (entry.length >= PASSWORD_MIN_LENGTH_WITH_MFA) blocklist.add(entry);
    }
    console.log(`[PASSWORDS] Liste de refus chargée : ${blocklist.size} entrées`);
  }
  return blocklist;
}

function isTrivial(password) {
  const chars = [...password];
  return new Set(chars).size < 4;
}

/**
 * @param {string} password
 * @param {{ mfaEnabled?: boolean, username?: string }} context
 * @returns {string|null} message d'erreur, ou null si accepté
 */
export function validatePassword(password, { mfaEnabled = false, username = '' } = {}) {
  if (typeof password !== 'string') return 'Mot de passe requis';
  const length = [...password].length;
  const min = mfaEnabled ? PASSWORD_MIN_LENGTH_WITH_MFA : PASSWORD_MIN_LENGTH;
  if (length < min) return `Mot de passe trop court (${min} caractères minimum)`;
  if (length > PASSWORD_MAX_LENGTH) return `Mot de passe trop long (${PASSWORD_MAX_LENGTH} caractères maximum)`;

  const lowered = password.normalize('NFKC').toLowerCase();
  if (loadBlocklist().has(lowered) || isTrivial(lowered)) {
    return 'Ce mot de passe est trop courant ou trop simple, choisissez-en un autre';
  }
  // mots propres au contexte (NIST §3.1.1.2) : nom du service, identifiant
  const contextWords = ['sentys', String(username || '').toLowerCase().trim()].filter(w => w.length >= 4);
  if (contextWords.some(word => lowered.includes(word))) {
    return 'Le mot de passe ne doit pas contenir votre identifiant ni le nom du service';
  }
  return null;
}
