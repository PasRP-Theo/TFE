import dgram from 'dgram';
import os from 'os';
import { createHash, randomBytes, randomUUID } from 'crypto';

// ONVIF : standard compris par la plupart des caméras IP (Reolink, Tapo, Hikvision, Dahua…).
//  1. découverte : sonde WS-Discovery en multicast, chaque caméra répond avec son adresse
//  2. connexion  : requêtes SOAP signées (WS-Security, mot de passe jamais envoyé en clair)
//     → marque, modèle, profils vidéo (codec, résolution) et adresse RTSP exacte
// Sans dépendance : quelques requêtes XML suffisent. Tout ce qui vient du réseau est non fiable :
// les identifiants ne partent que vers l'hôte choisi par l'utilisateur, sur le réseau local.

const WS_DISCOVERY = { address: '239.255.255.250', port: 3702 };
const DEVICE_NS = 'http://www.onvif.org/ver10/device/wsdl';
const MEDIA_NS = 'http://www.onvif.org/ver10/media/wsdl';
const SCHEMA_NS = 'http://www.onvif.org/ver10/schema';
// ports ONVIF usuels : 80 (générique), 8000 (Reolink), 2020 (Tapo), 8080, 8899 (entrée de gamme)
export const ONVIF_PORTS = [80, 8000, 2020, 8080, 8899];
const REQUEST_TIMEOUT_MS = 5000;

export class OnvifError extends Error {
  /** @param {'auth'|'unreachable'|'not_onvif'|'invalid_host'|'protocol'} code */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ── hôtes autorisés ──────────────────────────────────────────────────────────

export function isPrivateIpv4(address) {
  return /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/.test(String(address));
}

// réseau local uniquement (pas de requête vers Internet ni vers les services du serveur lui-même)
export function isCameraHostAllowed(host) {
  if (isPrivateIpv4(host)) return true;
  return process.env.ONVIF_ALLOW_LOOPBACK === '1' && host === '127.0.0.1'; // tests uniquement
}

// ── XML minimal (réponses SOAP : préfixes d'espace de noms ignorés) ──────────

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** blocs <prefix:name …>…</prefix:name> ; renvoie [{ attrs, inner }] */
export function xmlBlocks(xml, name) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>)`, 'g');
  return [...String(xml).matchAll(re)].map(m => ({ attrs: m[1] || '', inner: m[2] ?? '' }));
}

/** texte du premier élément <name> (ou null) */
export function xmlText(xml, name) {
  const block = xmlBlocks(xml, name)[0];
  return block ? decodeXml(block.inner.replace(/<[^>]+>/g, '')) : null;
}

function xmlAttr(attrs, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? decodeXml(match[1]) : null;
}

// ── 1. découverte WS-Discovery ───────────────────────────────────────────────

function buildProbe() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>
</e:Envelope>`;
}

function readScope(scopes, key) {
  const match = scopes.find(scope => scope.includes(`onvif.org/${key}/`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.split(`onvif.org/${key}/`)[1]).replace(/_/g, ' ').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Interprète une réponse ProbeMatch. L'adresse du service est rattachée à l'IP qui a répondu
 * (une réponse ne peut pas désigner une autre machine).
 * @returns {{ host, xaddr, name, hardware, endpoint } | null}
 */
export function parseProbeMatch(xml, sourceAddress) {
  if (!/ProbeMatch/.test(xml)) return null;
  const scopes = (xmlText(xml, 'Scopes') || '').split(/\s+/).filter(Boolean);
  const xaddrs = (xmlText(xml, 'XAddrs') || '').split(/\s+/).filter(Boolean);
  let xaddr = null;
  for (const candidate of xaddrs) {
    try {
      const url = new URL(candidate);
      if (!/^https?:$/.test(url.protocol)) continue;
      url.hostname = sourceAddress;
      xaddr = url.toString();
      if (candidate.includes(sourceAddress)) break;
    } catch { /* adresse illisible : ignorée */ }
  }
  if (!xaddr) return null;
  return {
    host: sourceAddress,
    xaddr,
    name: readScope(scopes, 'name'),
    hardware: readScope(scopes, 'hardware'),
    endpoint: xmlText(xml, 'Address'),
  };
}

function localIpv4Interfaces() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal)
    .map(item => item.address);
}

/**
 * Cherche les caméras ONVIF du réseau local.
 * @param {{ timeoutMs?: number, targets?: {address:string,port:number}[], isAllowed?: (ip:string)=>boolean }} options
 *   targets : destinataires de la sonde (par défaut le groupe multicast WS-Discovery) — utile aux tests
 */
export function discoverOnvifDevices({ timeoutMs = 3000, targets = [WS_DISCOVERY], isAllowed = isPrivateIpv4 } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();
    const probe = Buffer.from(buildProbe());
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch { /* déjà fermée */ }
      resolve([...found.values()].sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true })));
    };

    socket.on('message', (message, rinfo) => {
      if (!isAllowed(rinfo.address)) return;
      const device = parseProbeMatch(message.toString('utf8'), rinfo.address);
      if (device && !found.has(device.host)) found.set(device.host, device);
    });
    socket.on('error', (err) => {
      console.warn('[ONVIF] découverte :', err.message);
      finish();
    });

    socket.bind(0, () => {
      const multicast = targets.some(t => t.address === WS_DISCOVERY.address);
      const interfaces = multicast ? localIpv4Interfaces() : [null];
      // sonde envoyée deux fois sur chaque interface (UDP : une perte est possible)
      for (let attempt = 0; attempt < 2; attempt += 1) {
        for (const iface of interfaces.length ? interfaces : [null]) {
          for (const target of targets) {
            try {
              if (iface && multicast) socket.setMulticastInterface(iface);
              socket.send(probe, target.port, target.address);
            } catch (err) {
              console.warn('[ONVIF] envoi de la sonde :', err.message);
            }
          }
        }
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

// ── 2. requêtes SOAP signées ─────────────────────────────────────────────────

/** WS-Security UsernameToken : Digest = Base64(SHA1(nonce + created + mot de passe)) */
export function buildSecurityHeader(username, password, created = new Date().toISOString(), nonce = randomBytes(16)) {
  const digest = createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(String(password))]))
    .digest('base64');
  return `<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>${escapeXml(username)}</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created></UsernameToken></Security>`;
}

async function soap(url, body, { credentials = null, clockOffsetMs = 0 } = {}) {
  const header = credentials
    ? buildSecurityHeader(credentials.username, credentials.password, new Date(Date.now() + clockOffsetMs).toISOString())
    : '';
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>${header}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: envelope,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OnvifError('unreachable', `Caméra injoignable (${err.cause?.code || err.name})`);
  }
  const text = await response.text();
  if (/NotAuthorized|not authorized|Sender not Authorized|AccessDenied/i.test(text) || response.status === 401) {
    throw new OnvifError('auth', 'Identifiant ou mot de passe refusé par la caméra');
  }
  if (!response.ok || /<(?:[\w-]+:)?Fault\b/.test(text)) {
    const reason = xmlText(text, 'Text') || `HTTP ${response.status}`;
    throw new OnvifError('protocol', `Réponse ONVIF invalide : ${reason}`);
  }
  return text;
}

/** l'adresse annoncée par la caméra est ramenée à l'hôte choisi (jamais une autre machine) */
function pinToHost(address, host) {
  const url = new URL(address);
  url.hostname = host;
  return url;
}

function parseOnvifDate(xml) {
  const utc = xmlBlocks(xml, 'UTCDateTime')[0]?.inner;
  if (!utc) return null;
  const n = name => Number(xmlText(utc, name));
  const ms = Date.UTC(n('Year'), n('Month') - 1, n('Day'), n('Hour'), n('Minute'), n('Second'));
  return Number.isFinite(ms) ? ms : null;
}

/** trouve le service ONVIF d'un hôte : adresse issue de la découverte, sinon ports usuels */
async function locateDeviceService(host, xaddr) {
  const candidates = [];
  if (xaddr) candidates.push(pinToHost(xaddr, host).toString());
  for (const port of ONVIF_PORTS) {
    const url = `http://${host}${port === 80 ? '' : `:${port}`}/onvif/device_service`;
    if (!candidates.includes(url)) candidates.push(url);
  }
  const attempts = candidates.map(async (url) => {
    // GetSystemDateAndTime ne demande pas d'authentification : il sert aussi à mesurer
    // l'écart d'horloge (une caméra à l'heure fausse rejetterait la signature)
    const xml = await soap(url, `<GetSystemDateAndTime xmlns="${DEVICE_NS}"/>`);
    const cameraTime = parseOnvifDate(xml);
    return { url, clockOffsetMs: cameraTime ? cameraTime - Date.now() : 0 };
  });
  try {
    return await Promise.any(attempts);
  } catch {
    throw new OnvifError('not_onvif', 'Aucun service ONVIF trouvé sur cette caméra (ONVIF désactivé ou non pris en charge)');
  }
}

function parseProfiles(xml) {
  return xmlBlocks(xml, 'Profiles').map(({ attrs, inner }) => {
    const encoder = xmlBlocks(inner, 'VideoEncoderConfiguration')[0]?.inner || '';
    const resolution = xmlBlocks(encoder, 'Resolution')[0]?.inner || '';
    return {
      token: xmlAttr(attrs, 'token'),
      name: xmlText(inner, 'Name'),
      encoding: (xmlText(encoder, 'Encoding') || '').toUpperCase() || null,
      width: Number(xmlText(resolution, 'Width')) || null,
      height: Number(xmlText(resolution, 'Height')) || null,
    };
  }).filter(profile => profile.token);
}

/**
 * Profil retenu : le plus grand en H.264 (lisible tel quel par les navigateurs) ;
 * à défaut, le plus grand, à convertir.
 */
export function chooseProfile(profiles) {
  const area = p => (p.width || 0) * (p.height || 0);
  const sorted = [...profiles].sort((a, b) => area(b) - area(a));
  const h264 = sorted.find(p => p.encoding === 'H264');
  if (h264) return { profile: h264, transcode: false };
  return sorted[0] ? { profile: sorted[0], transcode: true } : null;
}

/**
 * Se connecte à une caméra ONVIF et renvoie ce qu'il faut pour l'ajouter.
 * @param {{ host: string, xaddr?: string, username: string, password: string }} params
 * @returns {Promise<{ manufacturer, model, firmware, profiles, chosen, transcode, streamUrl }>}
 *   streamUrl : adresse RTSP SANS identifiants (ils sont stockés chiffrés à part)
 */
export async function connectOnvifCamera({ host, xaddr = null, username, password }) {
  if (!isCameraHostAllowed(host)) {
    throw new OnvifError('invalid_host', 'Adresse refusée : la caméra doit être sur le réseau local (ex. 192.168.x.x)');
  }
  const credentials = { username: String(username || ''), password: String(password || '') };
  const { url: deviceUrl, clockOffsetMs } = await locateDeviceService(host, xaddr);
  const call = (url, body) => soap(url, body, { credentials, clockOffsetMs });

  const info = await call(deviceUrl, `<GetDeviceInformation xmlns="${DEVICE_NS}"/>`);
  const capabilities = await call(deviceUrl, `<GetCapabilities xmlns="${DEVICE_NS}"><Category>Media</Category></GetCapabilities>`);
  const mediaAddress = xmlText(xmlBlocks(capabilities, 'Media')[0]?.inner || '', 'XAddr');
  if (!mediaAddress) throw new OnvifError('protocol', 'La caméra ne publie pas de service vidéo ONVIF');
  const mediaUrl = pinToHost(mediaAddress, host).toString();

  const profiles = parseProfiles(await call(mediaUrl, `<GetProfiles xmlns="${MEDIA_NS}"/>`));
  const choice = chooseProfile(profiles);
  if (!choice) throw new OnvifError('protocol', 'Aucun profil vidéo sur cette caméra');

  const uriXml = await call(mediaUrl, `<GetStreamUri xmlns="${MEDIA_NS}"><StreamSetup><Stream xmlns="${SCHEMA_NS}">RTP-Unicast</Stream><Transport xmlns="${SCHEMA_NS}"><Protocol>RTSP</Protocol></Transport></StreamSetup><ProfileToken>${escapeXml(choice.profile.token)}</ProfileToken></GetStreamUri>`);
  const uri = xmlText(uriXml, 'Uri');
  if (!uri || !/^rtsp:\/\//i.test(uri)) throw new OnvifError('protocol', 'Adresse de flux RTSP absente de la réponse');
  const stream = pinToHost(uri, host);
  stream.username = '';
  stream.password = '';

  return {
    manufacturer: xmlText(info, 'Manufacturer'),
    model: xmlText(info, 'Model'),
    firmware: xmlText(info, 'FirmwareVersion'),
    profiles,
    chosen: choice.profile,
    transcode: choice.transcode,
    streamUrl: stream.toString(),
  };
}
