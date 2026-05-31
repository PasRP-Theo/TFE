import { spawn }                  from 'child_process';
import { existsSync, mkdirSync, promises as fsPromises } from 'fs';
import os                         from 'os';
import path                       from 'path';
import { fileURLToPath }          from 'url';
import { EventEmitter }           from 'events';
import ffmpegPath                 from 'ffmpeg-static';
import { pool }                   from '../db/index.js';
import { sendPushNotification }   from '../routes/push.js';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT  = path.resolve(__dirname, '..', '..', '..');
export const RECORDINGS_DIR  = process.env.RECORDINGS_DIR || path.join(PROJECT_ROOT, 'recordings');
const HLS_DIR         = process.env.HLS_DIR        || path.join(PROJECT_ROOT, 'hls');
let FFMPEG_BIN        = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg';
const { readdir, stat, unlink, rm } = fsPromises;
const RTSP_TRANSPORT  = process.env.RTSP_TRANSPORT || 'tcp';
const HTTP_STREAM_CANDIDATES = [
  '/stream', '/mjpeg', '/mjpeg/1', '/mjpeg/2', '/video', '/video.mjpg',
  '/cam', '/axis-cgi/mjpg/video.cgi',
];
const HTTP_SCAN_PORTS = ['', ':81', ':8080', ':8000'];
const RTSP_SCAN_PORTS = [':554', ':8554'];
const RTSP_STREAM_CANDIDATES = ['/stream', '/live', '/h264', '/mpeg4', '/video', '/video.sdp'];
const RTSP_TEST_TIMEOUT = Number(process.env.CAMERA_RTSP_TIMEOUT || 1000);

const SCAN_CONCURRENCY = Number(process.env.CAMERA_SCAN_CONCURRENCY || 30);
const SCAN_STOP_AFTER  = Number(process.env.CAMERA_SCAN_STOP_AFTER  || 3);
const HTTP_TEST_TIMEOUT = Number(process.env.CAMERA_SCAN_TIMEOUT || 700);
const SCAN_RANGE_START = Number(process.env.CAMERA_SCAN_RANGE_START || 1);
const SCAN_RANGE_END = Number(process.env.CAMERA_SCAN_RANGE_END || 254);
const COMMON_CAMERA_OCTET_RANGES = [
  [100, 120],
  [121, 140],
  [80, 99],
];
const STREAM_INACTIVE_TIMEOUT_MS = Number(process.env.STREAM_INACTIVE_TIMEOUT_MS || 5 * 60 * 1000);

const SCAN_SUBNETS = String(process.env.CAMERA_SCAN_SUBNETS || '192.168.0')
  .split(',')
  .map(value => value.trim())
  .filter(value => /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value))
  .filter(Boolean);

// masque identifiants dans URL
function redactStreamUrl(value) {
  const input = String(value || '').trim();
  if (!input) return input;

  try {
    const parsed = /^[a-z]+:/i.test(input) ? new URL(input) : new URL(`http://${input}`);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return /^[a-z]+:/i.test(input)
      ? parsed.toString()
      : `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return input.replace(/\/\/([^:@/]+):([^@/]+)@/g, '//***:***@');
  }
}

// masque URLs dans args ffmpeg
function redactCommandArgs(args) {
  return args.map(arg => (/^(rtsp|https?):/i.test(String(arg)) ? redactStreamUrl(String(arg)) : arg));
}

function isPrivateIpv4(address) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address);
}

// IPs locales privées
function getLocalPrivateIpv4s() {
  const nets = os.networkInterfaces();
  const addrs = new Set();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const item of list) {
      if (item.family === 'IPv4' && !item.internal && isPrivateIpv4(item.address)) {
        addrs.add(item.address);
      }
    }
  }
  return [...addrs];
}

function getSubnetBase(address) {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function isIpv4(address) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
}

function getLastOctet(address) {
  const parts = String(address).split('.');
  return Number(parts[3]);
}

// ordre de scan : plages caméras courantes d'abord, puis autour de l'IP locale
function buildPriorityOctets(localIp, rangeStart, rangeEnd) {
  const localOctet = getLastOctet(localIp);
  const values = [];
  const seen = new Set();

  const add = (octet) => {
    if (!Number.isInteger(octet)) return;
    if (octet < rangeStart || octet > rangeEnd) return;
    if (octet === localOctet) return;
    if (seen.has(octet)) return;
    seen.add(octet);
    values.push(octet);
  };

  for (const [start, end] of COMMON_CAMERA_OCTET_RANGES) {
    for (let octet = start; octet <= end; octet += 1) add(octet);
  }

  for (let offset = 1; offset <= 20; offset += 1) {
    add(localOctet - offset);
    add(localOctet + offset);
  }

  const ranges = [
    [2, 60],
    [100, 180],
    [61, 99],
    [181, 254],
  ];

  for (const [start, end] of ranges) {
    for (let octet = start; octet <= end; octet += 1) add(octet);
  }

  for (let octet = rangeStart; octet <= rangeEnd; octet += 1) add(octet);
  return values;
}

// liste d'hôtes à scanner, dédupliquée et ordonnée
function buildScanHosts({ localIps, preferredHosts = [], subnets = [] }) {
  const start = Math.max(1, Math.min(254, SCAN_RANGE_START));
  const end = Math.max(start, Math.min(254, SCAN_RANGE_END));
  const hosts = [];
  const seen = new Set();

  const addHost = (host) => {
    if (!isIpv4(host)) return;
    if (localIps.includes(host)) return;
    if (seen.has(host)) return;
    seen.add(host);
    hosts.push(host);
  };

  for (const host of preferredHosts) addHost(host);

  const subnetBases = subnets.filter((value, index, array) => array.indexOf(value) === index);

  for (const localIp of localIps) {
    const subnet = getSubnetBase(localIp);
    if (!subnet) continue;
    if (!subnetBases.includes(subnet)) continue;
    const octets = buildPriorityOctets(localIp, start, end);
    for (const octet of octets) addHost(`${subnet}.${octet}`);
  }

  for (const subnet of subnetBases) {
    for (let octet = start; octet <= end; octet += 1) {
      addHost(`${subnet}.${octet}`);
    }
  }

  return hosts;
}

// scan réseau local — retourne les streams trouvés
export async function scanLocalNetworkForCameraStreams({ stopAfter = SCAN_STOP_AFTER, concurrency = SCAN_CONCURRENCY, signal, preferredHosts = [], subnets = SCAN_SUBNETS } = {}) {
  if (signal?.aborted) return [];
  const localIps = getLocalPrivateIpv4s();
  const subnetList = (Array.isArray(subnets) ? subnets : [])
    .map(value => String(value || '').trim())
    .filter(value => /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value))
    .filter((value, index, array) => array.indexOf(value) === index);
  if (!subnetList.length && !localIps.length) return [];
  const effectiveSubnets = subnetList.length
    ? subnetList
    : localIps.map(getSubnetBase).filter(Boolean).filter((value, index, array) => array.indexOf(value) === index);
  if (!effectiveSubnets.length) return [];
  const scopedLocalIps = localIps.filter(localIp => effectiveSubnets.includes(getSubnetBase(localIp)));

  const hosts = buildScanHosts({ localIps: scopedLocalIps, preferredHosts, subnets: effectiveSubnets });
  const startedAt = Date.now();
  console.log(`[CAM SCAN] démarrage scan local sur ${effectiveSubnets.join(', ')} (${hosts.length} adresses, ${preferredHosts.length} prioritaires, concurrence=${concurrency}, stopAfter=${stopAfter})`);

  const results = [];
  let index = 0;
  let active = 0;
  let finished = false;
  let completed = 0;

  const logCompletion = (reason) => {
    const elapsedMs = Date.now() - startedAt;
    console.log(`[CAM SCAN] fin (${reason}) en ${Math.round(elapsedMs / 1000)}s, ${completed}/${hosts.length} adresses testées, ${results.length} résultat(s)`);
  };

  return new Promise((resolve) => {
    const maybeResolve = () => {
      if (finished) return;
      if (results.length >= stopAfter) {
        finished = true;
        logCompletion('stopAfter atteint');
        resolve(results);
      } else if (index >= hosts.length && active === 0) {
        finished = true;
        logCompletion('scan terminé');
        resolve(results);
      }
    };

    const onAbort = () => {
      if (finished) return;
      finished = true;
      logCompletion('scan annulé');
      resolve(results);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const next = () => {
      if (finished || results.length >= stopAfter) return;
      if (index >= hosts.length) return maybeResolve();

      const host = hosts[index++];
      active += 1;

      (async () => {
        let streamUrl = null;
        const hostPorts = ['', ...HTTP_SCAN_PORTS.slice(1), ...RTSP_SCAN_PORTS];
        for (const port of hostPorts) {
          const target = `${host}${port}`;
          streamUrl = await detectCameraStreamUrl(target, signal, { probeRtsp: true });
          if (streamUrl) break;
        }
        return streamUrl;
      })().then(streamUrl => {
        if (streamUrl && results.length < stopAfter) {
          results.push({ host, streamUrl });
          console.log(`[CAM SCAN] trouvé ${streamUrl} sur ${host} (${results.length}/${stopAfter})`);
        }
      }).catch(() => {
      }).finally(() => {
        active -= 1;
        completed += 1;
        if (completed % 20 === 0 || completed === hosts.length) {
          const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
          console.log(`[CAM SCAN] progression ${completed}/${hosts.length} adresses testées en ${elapsedSeconds}s (${active} actives, ${results.length} trouvées)`);
        }
        maybeResolve();
        if (!finished) next();
      });
    };

    const startCount = Math.min(concurrency, hosts.length);
    for (let i = 0; i < startCount; i += 1) next();
  });
}

export const cameraEvents = new EventEmitter();

// états : camId → { proc, status, recording, startedAt, hlsUrl, aiProc, sourceUrl }
// statuts : 'stopped' | 'watching' | 'running' | 'reconnecting' | 'paused'
const states = new Map();
const activeRecordings = new Map();
const inactivityTimers = new Map();
const reconnectTimers = new Map();
const reconnectFailures = new Map(); // id → { count, lastAt }

function clearInactivityTimer(cameraId) {
  const timer = inactivityTimers.get(String(cameraId));
  if (timer) { clearTimeout(timer); inactivityTimers.delete(String(cameraId)); }
}

// arrêt HLS après inactivité
function scheduleInactivity(cameraId) {
  clearInactivityTimer(cameraId);
  inactivityTimers.set(String(cameraId), setTimeout(() => {
    console.log(`[CAM ${cameraId}] Inactivité — arrêt du stream HLS`);
    stopHlsStream(String(cameraId));
  }, STREAM_INACTIVE_TIMEOUT_MS));
}

export function heartbeatStream(cameraId) {
  const s = states.get(String(cameraId));
  if (!s || s.status !== 'running') return false;
  scheduleInactivity(cameraId);
  return true;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getCameraRecordingDir(cameraId) {
  return path.join(RECORDINGS_DIR, String(cameraId));
}

export function getRecordingsRetentionDays() {
  const days = Number(process.env.RECORDINGS_RETENTION_DAYS || 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function broadcast(cameraId) {
  cameraEvents.emit('state', { cameraId, ...getState(cameraId) });
}

export function getState(cameraId) {
  const s = states.get(String(cameraId));
  if (!s) return { status: 'stopped', recording: false, startedAt: null, hlsUrl: null };
  return { status: s.status, recording: s.recording, startedAt: s.startedAt, hlsUrl: s.hlsUrl };
}

// veille Pi : status=reconnecting, sans FFmpeg
export function setPiWaiting(cameraId) {
  const id = String(cameraId);
  let s = states.get(id);
  // init état minimal si absent
  if (!s) {
    states.set(id, { proc: null, aiProc: null, status: 'watching', recording: false, startedAt: null, hlsUrl: null, sourceUrl: null });
    s = states.get(id);
  }
  if (s.status === 'running') return;
  // annule reconnect existant
  clearInactivityTimer(id);
  const rt = reconnectTimers.get(id); if (rt) { clearTimeout(rt); reconnectTimers.delete(id); }
  // tue FFmpeg zombie
  if (s.proc) { s.proc.kill('SIGKILL'); s.proc = null; }
  s.status = 'reconnecting';
  s.hlsUrl = null;
  broadcast(id);
  // timeout 60s si Pi ne répond pas
  setTimeout(() => {
    const cur = states.get(id);
    if (cur && cur.status === 'reconnecting' && !cur.proc) {
      console.log(`[CAM ${id}] Pi n'a pas répondu dans les temps — retour en veille`);
      cur.status = 'watching';
      broadcast(id);
    }
  }, 60000);
}

export function getAllStates() {
  const out = {};
  states.forEach((_, k) => { out[k] = getState(k); });
  return out;
}

// test HTTP : vérifie type MIME du flux
async function testHttpStreamUrl(candidate, signal) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TEST_TIMEOUT);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const res = await fetch(candidate, { method: 'GET', redirect: 'follow', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('multipart/x-mixed-replace') || type.includes('mjpeg') || type.includes('video')) {
      return true;
    }
    if (type.includes('image/jpeg')) {
      console.log(`[CAM SCAN] image fixe ignorée pour ${candidate}`);
      return false;
    }
    if (type.includes('text/html')) {
      const text = await res.text();
      const found = text.match(/(?:src|href)=["']([^"']*(stream|mjpeg|video|video\.mjpg|axis-cgi\/mjpg\/video\.cgi|cam)[^"']*)["']/i);
      if (found && found[1]) {
        const parsed = new URL(found[1], candidate).href;
        return parsed;
      }
    }
    return false;
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    return false;
  }
}

// test RTSP via ffmpeg -t 1
function testRtspStreamUrl(candidate, signal) {
  return new Promise((resolve) => {
    const args = [
      '-rtsp_transport', 'tcp',
      '-stimeout', String(RTSP_TEST_TIMEOUT * 1000),
      '-i', candidate,
      '-t', '1',
      '-f', 'null',
      '-',
    ];
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      resolve(false);
    };

    const timeout = setTimeout(cleanup, RTSP_TEST_TIMEOUT);
    signal?.addEventListener('abort', cleanup, { once: true });

    proc.on('error', () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolve(code === 0);
    });
  });
}

// détection automatique URL stream (HTTP/MJPEG/RTSP)
export async function detectCameraStreamUrl(sourceUrl, signal, { probeRtsp = false } = {}) {
  if (typeof fetch !== 'function') return null;
  let normalized = String(sourceUrl || '').trim();
  if (!normalized) return null;
  if (!/^[a-z]+:/i.test(normalized)) normalized = `http://${normalized}`;

  let url;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  if (url.protocol === 'rtsp:') {
    return url.href;
  }

  const directResult = await testHttpStreamUrl(url.href, signal);
  if (directResult === true) return url.href;
  if (typeof directResult === 'string') return directResult;

  const base = `${url.protocol}//${url.host}`;
  const candidates = HTTP_STREAM_CANDIDATES.map(path => new URL(path, base).href);
  for (const candidate of candidates) {
    const result = await testHttpStreamUrl(candidate, signal);
    if (result === true) return candidate;
    if (typeof result === 'string') return result;
  }

  if (probeRtsp) {
    const rtspBase = `rtsp://${url.host}`;
    const rtspCandidates = [rtspBase, ...RTSP_STREAM_CANDIDATES.map(path => new URL(path, rtspBase).href)];
    for (const candidate of rtspCandidates) {
      const ok = await testRtspStreamUrl(candidate, signal);
      if (ok) return candidate;
    }
  }

  return null;
}

async function resolveHttpStreamUrl(sourceUrl) {
  const resolved = await detectCameraStreamUrl(sourceUrl);
  return resolved || sourceUrl;
}

// veille : URL résolue, prête à streamer (pas de FFmpeg)
export async function startCamera(camera) {
  const id  = String(camera.id);
  const cur = states.get(id);
  if (cur?.status === 'running' || cur?.status === 'watching') return;
  if (cur?.aiProc) { cur.aiProc.kill('SIGKILL'); }

  let sourceUrl = String(camera.rtsp_url || '').trim();
  const isRtsp  = /^rtsp:/i.test(sourceUrl);
  if (!isRtsp && sourceUrl) sourceUrl = await resolveHttpStreamUrl(sourceUrl);

  states.set(id, { proc: null, aiProc: null, status: 'watching', recording: false, startedAt: null, hlsUrl: null, sourceUrl });
  broadcast(id);
  console.log(`[CAM ${id}] En veille → ${redactStreamUrl(sourceUrl)}`);
}

// démarrage FFmpeg HLS + IA
export async function startHlsStream(camera) {
  const id  = String(camera.id);
  const cur = states.get(id);
  if (cur?.status === 'running') { scheduleInactivity(id); return; }

  // token pour détecter interruption extérieure pendant les await
  const startToken = Date.now();
  if (cur) cur._startToken = startToken;

  // tue IA existante (sera relancée)
  if (cur?.aiProc) {
    cur.aiProc.kill('SIGKILL');
    await new Promise(resolve => {
      const t = setTimeout(resolve, 2000);
      cur.aiProc.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }

  // annulé si stopHlsStream/stopCamera a pris la main
  {
    const s = states.get(id);
    if (!s || s.status === 'stopped' || s.status === 'paused' ||
        (s._startToken !== startToken)) {
      console.log(`[CAM ${id}] startHlsStream annulé — état changé pendant l'init (${s?.status ?? 'supprimé'})`);
      return;
    }
  }

  ensureDir(HLS_DIR);
  ensureDir(RECORDINGS_DIR);

  const hlsDir = path.join(HLS_DIR, id);
  const recDir = path.join(RECORDINGS_DIR, id);
  ensureDir(hlsDir);
  ensureDir(recDir);

  try {
    const oldFiles = await fsPromises.readdir(hlsDir);
    for (const f of oldFiles) {
      if (f.endsWith('.ts') || f.endsWith('.m3u8') || f.endsWith('.m4s') || f.endsWith('.mp4')) {
        await fsPromises.unlink(path.join(hlsDir, f));
      }
    }
  } catch { /* ignore */ }

  const runId    = Date.now();
  const hlsIndex = path.join(hlsDir, 'index.m3u8');

  // réutilise sourceUrl du mode veille si dispo
  let sourceUrl = cur?.sourceUrl || String(camera.rtsp_url || '').trim();
  const isRtsp  = /^rtsp:/i.test(sourceUrl);
  if (!isRtsp && sourceUrl && !cur?.sourceUrl) sourceUrl = await resolveHttpStreamUrl(sourceUrl);

  // annulé si état changé après résolution URL
  {
    const s = states.get(id);
    if (!s || s.status === 'stopped' || s.status === 'paused' ||
        (s._startToken !== startToken)) {
      console.log(`[CAM ${id}] startHlsStream annulé — état changé après résolution URL (${s?.status ?? 'supprimé'})`);
      return;
    }
  }

  const args = ['-fflags', '+genpts+nobuffer', '-flags', 'low_delay'];
  if (isRtsp) {
    args.push('-rtsp_transport', RTSP_TRANSPORT);
  }
  args.push('-y', '-i', sourceUrl);

  const videoCodecArgs = isRtsp
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '23', '-pix_fmt', 'yuv420p'];

  const outArgs = [
    '-map', '0:v:0',
    ...videoCodecArgs,
    '-an',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_start_number_source', 'datetime',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', `init_${runId}.mp4`,
    '-hls_segment_filename', path.join(hlsDir, `seg_${runId}_%05d.m4s`),
    hlsIndex,
  ];

  const argsFinal = [...args, ...outArgs];
  const proc = spawn(FFMPEG_BIN, argsFinal, { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`[CAM ${id}] ▶ FFmpeg ${FFMPEG_BIN} ${redactCommandArgs(argsFinal).join(' ')}`);

  proc.on('error', err => {
    console.error(`[CAM ${id}] impossible de démarrer ffmpeg : ${err.message}`);
    clearInactivityTimer(id);
    states.set(id, { proc: null, aiProc: null, status: 'watching', recording: false, startedAt: null, hlsUrl: null, sourceUrl });
    broadcast(id);
  });

  // démarrage IA
  const aiScript = path.join(PROJECT_ROOT, 'server', 'motion_detector.py');
  let aiProc = null;
  if (existsSync(aiScript)) {
    const venvPython = path.join(PROJECT_ROOT, 'venv', 'bin', 'python');
    const pythonBin  = os.platform() === 'win32' ? 'python' : (existsSync(venvPython) ? venvPython : 'python3');
    aiProc = spawn(pythonBin, [aiScript], { env: { ...process.env, CAMERA_ID: id, RTSP_URL: sourceUrl } });
    aiProc.stdout.on('data', d => console.log(`[CAM ${id} IA] ${d.toString().trim()}`));
    aiProc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (!msg.includes('GStreamer warning') && !msg.includes('error while decoding'))
        console.error(`[CAM ${id} IA] ${msg}`);
    });
    aiProc.on('error', err => console.error(`[CAM ${id} IA] ${err.message}`));
    console.log(`[CAM ${id}] IA démarrée`);
  }

  // annulé si état changé après spawn (race condition async)
  {
    const s = states.get(id);
    if (!s || s.status === 'stopped' || s.status === 'paused' ||
        (s._startToken !== startToken)) {
      console.log(`[CAM ${id}] startHlsStream annulé — état changé après spawn FFmpeg (${s?.status ?? 'supprimé'})`);
      proc.kill('SIGKILL');
      if (aiProc) aiProc.kill('SIGKILL');
      return;
    }
  }

  const startedAt = new Date().toISOString();
  states.set(id, { proc, aiProc, status: 'running', recording: false, startedAt, hlsUrl: null, sourceUrl });
  broadcast(id);
  scheduleInactivity(id);

  // attend le premier manifeste avant d'exposer l'URL (évite écran noir)
  const waitForManifest = async () => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const s = states.get(id);
      if (!s || s.status === 'watching' || s.status === 'stopped') return;
      try {
        await fsPromises.access(hlsIndex);
        s.hlsUrl = `/hls/${id}/index.m3u8`;
        broadcast(id);
        console.log(`[CAM ${id}] Manifeste HLS prêt`);
        return;
      } catch { /* pas encore créé */ }
      await new Promise(r => setTimeout(r, 300));
    }
    // timeout : expose quand même
    const s = states.get(id);
    if (s && s.status === 'running') { s.hlsUrl = `/hls/${id}/index.m3u8`; broadcast(id); }
  };
  waitForManifest().catch(() => {});

  proc.stderr.on('data', data => {
    const txt = data.toString();
    if (txt.includes('Error') || txt.includes('error')) console.error(`[CAM ${id}] ffmpeg: ${txt.slice(0, 200)}`);
  });

  proc.on('close', code => {
    const s = states.get(id);
    if (s && s.status !== 'stopped' && s.status !== 'paused' && s.status !== 'watching') {
      const now = Date.now();
      const runTime = now - new Date(startedAt).getTime();

      // stream > 15s : vraie déconnexion, reconnexion dans 5s
      if (runTime > 15000) {
        reconnectFailures.delete(id);
        console.log(`[CAM ${id}] ffmpeg fermé (code ${code}), redémarrage dans 5s…`);
        clearInactivityTimer(id);
        s.status = 'reconnecting';
        broadcast(id);
        const t = setTimeout(() => { reconnectTimers.delete(id); startHlsStream(camera); }, 5000);
        reconnectTimers.set(id, t);
        return;
      }

      // échec rapide : compteur, mise en veille après 4 tentatives
      const fail = reconnectFailures.get(id) || { count: 0, lastAt: 0 };
      const count = (now - fail.lastAt < 60000) ? fail.count + 1 : 1;
      reconnectFailures.set(id, { count, lastAt: now });

      if (count >= 4) {
        console.log(`[CAM ${id}] ffmpeg fermé (code ${code}), ${count} échecs rapides — mise en veille`);
        reconnectFailures.delete(id);
        s.status = 'watching';
        broadcast(id);
        return;
      }

      console.log(`[CAM ${id}] ffmpeg fermé (code ${code}), tentative ${count}/4 dans 5s…`);
      clearInactivityTimer(id);
      s.status = 'reconnecting';
      broadcast(id);
      const t = setTimeout(() => { reconnectTimers.delete(id); startHlsStream(camera); }, 5000);
      reconnectTimers.set(id, t);
    }
  });

  console.log(`[CAM ${id}] ▶ Stream HLS démarré → ${redactStreamUrl(sourceUrl)}`);
}

// arrêt HLS uniquement, repasse en veille
export function stopHlsStream(cameraId) {
  const id = String(cameraId);
  const s  = states.get(id);
  if (!s) return false;
  clearInactivityTimer(id);
  const rt = reconnectTimers.get(id); if (rt) { clearTimeout(rt); reconnectTimers.delete(id); }
  // status 'watching' AVANT kill — évite reconnexion auto dans proc.on('close')
  // invalide le token pour annuler tout startHlsStream concurrent
  s._startToken = Date.now();
  s.status    = 'watching';
  s.recording = false;
  s.hlsUrl    = null;
  s.startedAt = null;
  s.proc?.kill('SIGKILL');
  s.proc = null;
  if (s.aiProc) { s.aiProc.kill('SIGKILL'); s.aiProc = null; console.log(`[CAM ${id}] IA arrêtée`); }
  if (activeRecordings.has(id)) { activeRecordings.get(id)?.kill('SIGKILL'); activeRecordings.delete(id); }
  broadcast(id);
  console.log(`[CAM ${id}] Stream HLS arrêté — mode veille`);
  return true;
}

export function pauseCamera(cameraId) {
  const id = String(cameraId);
  const s  = states.get(id);
  if (!s || s.status !== 'running') return false;
  clearInactivityTimer(id);
  s.status    = 'paused';
  s.recording = false;
  s.proc?.kill('SIGKILL');
  if (s.aiProc) { s.aiProc?.kill('SIGKILL'); s.aiProc = null; }
  broadcast(id);
  return true;
}

export function resumeCamera(camera) {
  const id = String(camera.id);
  const s  = states.get(id);
  if (s?.status === 'paused') {
    states.delete(id);
    startHlsStream(camera);
    return true;
  }
  if (!s) { startHlsStream(camera); return true; }
  return false;
}

export function stopCamera(cameraId) {
  const id = String(cameraId);
  const s  = states.get(id);
  if (!s) return false;
  clearInactivityTimer(id);
  const rt = reconnectTimers.get(id); if (rt) { clearTimeout(rt); reconnectTimers.delete(id); }
  s.status    = 'stopped';   // avant kill pour éviter la reconnexion auto
  s.recording = false;
  s.proc?.kill('SIGKILL');
  if (s.aiProc) { s.aiProc?.kill('SIGKILL'); console.log(`[CAM ${id}] Arrêt de l'IA.`); }
  if (activeRecordings.has(id)) { activeRecordings.get(id)?.kill('SIGKILL'); activeRecordings.delete(id); }
  states.delete(id);
  broadcast(id);
  console.log(`[CAM ${id}] Arrêtée`);
  return true;
}

// suppression clips expirés
export async function cleanupOldRecordings({ retentionDays = Number(process.env.RECORDINGS_RETENTION_DAYS || 30) } = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  if (!existsSync(RECORDINGS_DIR)) return;

  const cameraDirs = await readdir(RECORDINGS_DIR, { withFileTypes: true });
  for (const cameraDir of cameraDirs) {
    if (!cameraDir.isDirectory()) continue;
    const camPath = path.join(RECORDINGS_DIR, cameraDir.name);
    const files = await readdir(camPath, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      const filePath = path.join(camPath, file.name);
      try {
        const fileStats = await stat(filePath);
        if (fileStats.mtimeMs < cutoff) await unlink(filePath);
      } catch (err) {
        console.error(`[REC CLEANUP] impossible de supprimer ${filePath}: ${err.message}`);
      }
    }
  }
}

export function stopAllCameras() {
  inactivityTimers.forEach(t => clearTimeout(t));
  inactivityTimers.clear();
  states.forEach((s, id) => {
    s.proc?.kill('SIGKILL');
    s.aiProc?.kill('SIGKILL');
    console.log(`[CAM ${id}] Arrêtée (shutdown)`);
  });
  states.clear();
}

export async function deleteRecording(cameraId, filename) {
  const safeName = path.basename(String(filename || '')).trim();
  if (!safeName || safeName !== String(filename || '').trim()) {
    return { deleted: false, reason: 'invalid-filename' };
  }

  const camDir = getCameraRecordingDir(cameraId);
  const filePath = path.join(camDir, safeName);

  if (!existsSync(filePath)) {
    return { deleted: false, reason: 'not-found' };
  }

  await unlink(filePath);

  return { deleted: true, filename: safeName };
}

export async function deleteAllRecordings(cameraId) {
  const camDir = getCameraRecordingDir(cameraId);
  if (!existsSync(camDir)) {
    return { deletedCount: 0 };
  }

  const files = await readdir(camDir, { withFileTypes: true });
  let deletedCount = 0;

  for (const file of files) {
    if (!file.isFile()) continue;
    await unlink(path.join(camDir, file.name));
    deletedCount += 1;
  }

  await rm(camDir, { recursive: true, force: true });
  return { deletedCount };
}

// enregistrement mouvement + notification push
export function triggerMotionRecording(cameraId, durationSeconds = 30, detectionLabel = null, cameraName = null) {
  const id = String(cameraId);
  const s = states.get(id);
  if (!s || !s.sourceUrl) return;
  if (activeRecordings.has(id)) return;

  const recDir = path.join(RECORDINGS_DIR, id);
  ensureDir(recDir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mp4File = path.join(recDir, `${ts}.mp4`);

  // touch : fichier visible dans l'historique même si ffmpeg échoue
  fsPromises.open(mp4File, 'a').then(fh => fh.close()).catch(() => {});

  const args = ['-y', '-fflags', '+genpts'];
  if (/^rtsp:/i.test(s.sourceUrl)) {
    args.push('-rtsp_transport', RTSP_TRANSPORT);
  }

  // ultrafast : MP4 valide même en cas de perte Wi-Fi
  args.push(
    '-i', s.sourceUrl, '-t', String(durationSeconds),
    '-map', '0:v:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-an',
    '-movflags', 'frag_keyframe+empty_moov', mp4File
  );

  const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeRecordings.set(id, proc);

  proc.stderr.on('data', data => {
    const txt = data.toString();
    if (txt.includes('Error') || txt.includes('error') || txt.includes('Invalid')) {
      console.error(`[CAM ${id} REC] ffmpeg: ${txt.trim()}`);
    }
  });

  s.recording = true; // pastille REC
  broadcast(id);
  console.log(`[CAM ${id}] Mouvement détecté ! Enregistrement (${durationSeconds}s).`);

  const pushTitle = detectionLabel || 'Mouvement détecté';
  const camLabel = cameraName || `CAM ${id}`;
  const pushPayload = JSON.stringify({
    title: `${pushTitle} — ${camLabel}`,
    body: detectionLabel ? `${detectionLabel} capté par la caméra.` : 'Un mouvement a été détecté par la caméra.',
    icon: '/pwa-192.png',
    data: { url: '/videos' },
  });
  pool.query('SELECT * FROM push_subscriptions').then(({ rows: subs }) => {
    subs.forEach(sub =>
      sendPushNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        pushPayload
      ).catch(async err => {
        console.error(`[PUSH CAM ${id}]`, err.message);
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
        }
      })
    );
  }).catch(err => console.error(`[PUSH CAM ${id}] DB error:`, err.message));

  proc.on('close', () => {
    activeRecordings.delete(id);
    if (states.has(id)) {
      states.get(id).recording = false; // éteint pastille REC
      broadcast(id);
    }

    console.log(`[CAM ${id}] Fin de l'enregistrement de mouvement.`);
  });
}
