import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// clé éphémère par défaut : les URLs signées ne survivent pas à un redémarrage (durée courte)
const SIGNING_KEY = process.env.URL_SIGNING_KEY
  ? Buffer.from(process.env.URL_SIGNING_KEY, 'base64')
  : randomBytes(32);

export const RECORDING_URL_TTL_SECONDS = Number(process.env.RECORDING_URL_TTL_SECONDS || 600);
export const LIVE_URL_TTL_SECONDS = Number(process.env.LIVE_URL_TTL_SECONDS || 1800);

function hmac(payload) {
  return createHmac('sha256', SIGNING_KEY).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// enregistrements : /recordings/<cam>/<fichier>?exp=…&uid=…&sig=…
export function signRecordingUrl(urlPath, userId, ttlSeconds = RECORDING_URL_TTL_SECONDS) {
  const exp = nowSeconds() + ttlSeconds;
  const uid = String(userId);
  const decodedPath = decodeURIComponent(urlPath);
  const sig = hmac(`rec|${decodedPath}|${exp}|${uid}`);
  return `${urlPath}?exp=${exp}&uid=${encodeURIComponent(uid)}&sig=${sig}`;
}

export function verifyRecordingRequest(decodedPath, query) {
  const exp = Number(query?.exp);
  const uid = String(query?.uid || '');
  const sig = String(query?.sig || '');
  if (!Number.isInteger(exp) || !uid || !sig) return null;
  if (exp < nowSeconds()) return null;
  if (!safeEqual(sig, hmac(`rec|${decodedPath}|${exp}|${uid}`))) return null;
  return { userId: uid, exp };
}

// live : /hls/s/<exp>.<uid>.<sig>/<cam>/index.m3u8 — les segments relatifs héritent du préfixe
export function signLivePrefix(cameraId, userId, ttlSeconds = LIVE_URL_TTL_SECONDS) {
  const exp = nowSeconds() + ttlSeconds;
  const uid = String(userId);
  const cam = String(cameraId);
  const sig = hmac(`live|${cam}|${exp}|${uid}`);
  return `/hls/s/${exp}.${encodeURIComponent(uid)}.${sig}/${encodeURIComponent(cam)}`;
}

export function verifyLiveCapability(capability, cameraId) {
  const [expRaw, uidRaw, sig] = String(capability || '').split('.');
  const exp = Number(expRaw);
  const uid = decodeURIComponent(uidRaw || '');
  if (!Number.isInteger(exp) || !uid || !sig) return null;
  if (exp < nowSeconds()) return null;
  if (!safeEqual(sig, hmac(`live|${String(cameraId)}|${exp}|${uid}`))) return null;
  return { userId: uid, exp };
}
