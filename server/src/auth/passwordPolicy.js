// politique NIST SP 800-63B rév. 4 : longueur, pas de règles de composition
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MIN_LENGTH_WITH_MFA = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function validatePassword(password, { mfaEnabled = false } = {}) {
  if (typeof password !== 'string') return 'Mot de passe requis';
  const length = [...password].length;
  const min = mfaEnabled ? PASSWORD_MIN_LENGTH_WITH_MFA : PASSWORD_MIN_LENGTH;
  if (length < min) return `Mot de passe trop court (${min} caractères minimum)`;
  if (length > PASSWORD_MAX_LENGTH) return `Mot de passe trop long (${PASSWORD_MAX_LENGTH} caractères maximum)`;
  return null;
}
