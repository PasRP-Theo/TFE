import { encryptString, decryptString } from '../security/dataCrypto.js';

// Identifiants RTSP : jamais dans l'URL stockée ; chiffrés AES-256-GCM (AAD = caméra),
// déchiffrés uniquement au lancement de ffmpeg / go2rtc / détecteur IA.
const aad = cameraId => `camera:${cameraId}`;

/** @returns {{ cleanUrl: string, username: string, password: string }} */
export function splitStreamCredentials(streamUrl) {
  const value = String(streamUrl || '').trim();
  try {
    const parsed = new URL(value);
    const username = decodeURIComponent(parsed.username || '');
    const password = decodeURIComponent(parsed.password || '');
    if (!username && !password) return { cleanUrl: value, username: '', password: '' };
    parsed.username = '';
    parsed.password = '';
    return { cleanUrl: parsed.toString(), username, password };
  } catch {
    return { cleanUrl: value, username: '', password: '' };
  }
}

export function encryptCameraCredentials(cameraId, { username = '', password = '' }) {
  if (!username && !password) return null;
  return encryptString(JSON.stringify({ username, password }), aad(cameraId));
}

export function decryptCameraCredentials(camera) {
  if (!camera?.credentials_enc) return null;
  return JSON.parse(decryptString(camera.credentials_enc, aad(camera.id)));
}

// URL complète pour les processus locaux (jamais renvoyée au client ni journalisée)
export function resolveCameraSourceUrl(camera) {
  const base = String(camera?.rtsp_url || '').trim();
  const credentials = decryptCameraCredentials(camera);
  if (!credentials || !base) return base;
  try {
    const parsed = new URL(base);
    parsed.username = encodeURIComponent(credentials.username || '');
    parsed.password = encodeURIComponent(credentials.password || '');
    return parsed.toString();
  } catch {
    return base;
  }
}

// représentation publique d'une caméra : ni identifiants, ni chiffré
export function publicCameraFields(camera) {
  if (!camera) return camera;
  const { credentials_enc: encrypted, ...rest } = camera;
  return { ...rest, hasCredentials: Boolean(encrypted) };
}
