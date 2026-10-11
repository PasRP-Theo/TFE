import { connectOnvifCamera, isCameraHostAllowed, OnvifError } from './onvif.js';
import { probeStream, PROBE_ERRORS } from './streamProbe.js';

// Caméras sans ONVIF : chemins RTSP connus par marque (essayés avec les identifiants saisis)
export const CAMERA_BRANDS = [
  { id: 'reolink', label: 'Reolink', paths: ['/h264Preview_01_main', '/h264Preview_01_sub', '/Preview_01_main'] },
  { id: 'tapo', label: 'TP-Link Tapo', paths: ['/stream1', '/stream2'] },
  { id: 'hikvision', label: 'Hikvision / Ezviz', paths: ['/Streaming/Channels/101', '/Streaming/Channels/102', '/h264/ch1/main/av_stream'] },
  { id: 'dahua', label: 'Dahua / Imou / Amcrest', paths: ['/cam/realmonitor?channel=1&subtype=0', '/cam/realmonitor?channel=1&subtype=1'] },
  { id: 'eufy', label: 'Eufy', paths: ['/live0', '/live1'] },
  { id: 'generic', label: 'Autre marque', paths: ['/live', '/stream', '/h264', '/11', '/onvif1', '/live/ch00_0', '/videoMain'] },
];

export class CameraConnectError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function withCredentials(streamUrl, { username, password }) {
  const url = new URL(streamUrl);
  if (username) url.username = encodeURIComponent(username);
  if (password) url.password = encodeURIComponent(password);
  return url.toString();
}

function codecLabel(codec) {
  return { h264: 'H.264', hevc: 'H.265', h265: 'H.265', mjpeg: 'MJPEG' }[codec] || codec?.toUpperCase() || null;
}

async function tryBrandPaths(host, brandId, credentials, probe) {
  const brand = CAMERA_BRANDS.find(b => b.id === brandId);
  if (!brand) throw new CameraConnectError('invalid_brand', 'Marque inconnue');
  let lastError = 'not_found';
  for (const port of [554, 8554]) {
    for (const path of brand.paths) {
      const streamUrl = `rtsp://${host}:${port}${path}`;
      const result = await probe(withCredentials(streamUrl, credentials));
      if (result.ok) return { brand, streamUrl, probe: result };
      // identifiants refusés : inutile d'essayer les autres chemins
      if (result.error === 'auth') throw new CameraConnectError('auth', PROBE_ERRORS.auth);
      if (result.error !== 'unreachable') lastError = result.error;
    }
  }
  throw new CameraConnectError(lastError, `${PROBE_ERRORS[lastError] || PROBE_ERRORS.unknown} (chemins ${brand.label} essayés)`);
}

/**
 * Connecte une caméra : ONVIF si possible, sinon chemins connus de la marque indiquée.
 * Le flux est ensuite ouvert pour vérifier les identifiants et lire le codec réel.
 * @returns {Promise<{ method, manufacturer, model, suggestedName, streamUrl, codec, codecLabel, width, height, transcode, verified, warning }>}
 *   streamUrl sans identifiants
 * @throws {CameraConnectError} code 'needs_brand' quand la caméra ne parle pas ONVIF et qu'aucune marque n'est donnée
 */
export async function connectCamera({ host, xaddr = null, username = '', password = '', brand = null },
  { onvif = connectOnvifCamera, probe = probeStream } = {}) {
  const cleanHost = String(host || '').trim();
  if (!isCameraHostAllowed(cleanHost)) {
    throw new CameraConnectError('invalid_host', 'Adresse refusée : la caméra doit être sur le réseau local (ex. 192.168.x.x)');
  }
  const credentials = { username: String(username || ''), password: String(password || '') };

  if (brand) {
    const found = await tryBrandPaths(cleanHost, brand, credentials, probe);
    const transcode = found.probe.codec !== 'h264';
    return {
      method: 'brand',
      manufacturer: found.brand.id === 'generic' ? null : found.brand.label,
      model: null,
      suggestedName: `${found.brand.id === 'generic' ? 'Caméra' : found.brand.label} ${cleanHost}`,
      streamUrl: found.streamUrl,
      codec: found.probe.codec,
      codecLabel: codecLabel(found.probe.codec),
      width: found.probe.width,
      height: found.probe.height,
      transcode,
      verified: true,
      warning: transcode ? 'Flux non H.264 : il sera converti par le serveur (charge processeur plus élevée).' : null,
    };
  }

  let device;
  try {
    device = await onvif({ host: cleanHost, xaddr, ...credentials });
  } catch (err) {
    if (err instanceof OnvifError && err.code === 'not_onvif') {
      throw new CameraConnectError('needs_brand', 'Cette caméra ne répond pas en ONVIF : choisissez sa marque pour essayer ses adresses de flux connues.', {
        brands: CAMERA_BRANDS.map(({ id, label }) => ({ id, label })),
      });
    }
    if (err instanceof OnvifError) throw new CameraConnectError(err.code, err.message);
    throw err;
  }

  // vérification réelle : identifiants acceptés par le serveur RTSP et codec effectif
  const checked = await probe(withCredentials(device.streamUrl, credentials));
  if (!checked.ok && checked.error === 'auth') throw new CameraConnectError('auth', PROBE_ERRORS.auth);
  const codec = checked.ok ? checked.codec : (device.chosen.encoding === 'H264' ? 'h264' : device.chosen.encoding?.toLowerCase() || null);
  const transcode = checked.ok ? checked.codec !== 'h264' : device.transcode;
  const warnings = [];
  if (!checked.ok) warnings.push(`Flux non vérifié : ${PROBE_ERRORS[checked.error] || PROBE_ERRORS.unknown}.`);
  if (transcode) warnings.push('Flux non H.264 : il sera converti par le serveur (charge processeur plus élevée).');

  return {
    method: 'onvif',
    manufacturer: device.manufacturer,
    model: device.model,
    suggestedName: [device.manufacturer, device.model].filter(Boolean).join(' ') || `Caméra ${cleanHost}`,
    streamUrl: device.streamUrl,
    codec,
    codecLabel: codecLabel(codec),
    width: (checked.ok && checked.width) || device.chosen.width,
    height: (checked.ok && checked.height) || device.chosen.height,
    transcode,
    verified: checked.ok,
    warning: warnings.join(' ') || null,
  };
}
