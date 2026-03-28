import { spawn }                  from 'child_process';
import { existsSync, mkdirSync }  from 'fs';
import os                         from 'os';
import path                       from 'path';
import { fileURLToPath }          from 'url';
import { EventEmitter }           from 'events';
import ffmpegPath                 from 'ffmpeg-static';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT  = path.resolve(__dirname, '..', '..', '..');
const RECORDINGS_DIR  = process.env.RECORDINGS_DIR || path.join(PROJECT_ROOT, 'recordings');
const HLS_DIR         = process.env.HLS_DIR        || path.join(PROJECT_ROOT, 'hls');
const FFMPEG_BIN      = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg';
const RTSP_TRANSPORT  = process.env.RTSP_TRANSPORT || 'tcp';
const HTTP_STREAM_CANDIDATES = [
  '/stream', '/mjpeg', '/mjpeg/1', '/mjpeg/2', '/video', '/video.mjpg',
  '/capture', '/shot.jpg', '/jpg', '/jpeg', '/cam', '/axis-cgi/mjpg/video.cgi',
];
const HTTP_SCAN_PORTS = ['', ':81', ':8080', ':8000'];

const SCAN_CONCURRENCY = Number(process.env.CAMERA_SCAN_CONCURRENCY || 15);
const SCAN_STOP_AFTER  = Number(process.env.CAMERA_SCAN_STOP_AFTER  || 3);
const HTTP_TEST_TIMEOUT = Number(process.env.CAMERA_SCAN_TIMEOUT || 1000);

function isPrivateIpv4(address) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address);
}

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

export async function scanLocalNetworkForCameraStreams({ stopAfter = SCAN_STOP_AFTER, concurrency = SCAN_CONCURRENCY, signal } = {}) {
  if (signal?.aborted) return [];
  const localIps = getLocalPrivateIpv4s();
  if (!localIps.length) return [];
  const subnets = localIps
    .map(getSubnetBase)
    .filter(Boolean)
    .filter((value, index, self) => self.indexOf(value) === index);
  if (!subnets.length) return [];

  const hosts = [];
  for (const subnet of subnets) {
    for (let i = 1; i < 255; i += 1) {
      const host = `${subnet}.${i}`;
      if (!localIps.includes(host)) hosts.push(host);
    }
  }
  console.log(`[CAM SCAN] démarrage scan local sur ${subnets.join(', ')} (${hosts.length} adresses)`);

  const results = [];
  let index = 0;
  let active = 0;
  let finished = false;

  return new Promise((resolve) => {
    const maybeResolve = () => {
      if (finished) return;
      if (results.length >= stopAfter) {
        finished = true;
        resolve(results);
      } else if (index >= hosts.length && active === 0) {
        finished = true;
        resolve(results);
      }
    };

    const onAbort = () => {
      if (finished) return;
      finished = true;
      resolve(results);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const next = () => {
      if (finished || results.length >= stopAfter) return;
      if (index >= hosts.length) return maybeResolve();

      const host = hosts[index++];
      active += 1;

      (async () => {
        let streamUrl = await detectCameraStreamUrl(host, signal);
        if (!streamUrl) {
          for (const port of HTTP_SCAN_PORTS.slice(1)) {
            streamUrl = await detectCameraStreamUrl(`${host}${port}`, signal);
            if (streamUrl) break;
          }
        }
        return streamUrl;
      })().then(streamUrl => {
        if (streamUrl && results.length < stopAfter) {
          results.push({ host, streamUrl });
        }
      }).catch(() => {
      }).finally(() => {
        active -= 1;
        maybeResolve();
        if (!finished) next();
      });
    };

    const startCount = Math.min(concurrency, hosts.length);
    for (let i = 0; i < startCount; i += 1) next();
  });
}

export const cameraEvents = new EventEmitter();

// État en mémoire : camId (string) → { proc, status, recording, startedAt, hlsUrl }
const states = new Map();

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function broadcast(cameraId) {
  cameraEvents.emit('state', { cameraId, ...getState(cameraId) });
}

export function getState(cameraId) {
  const s = states.get(String(cameraId));
  if (!s) return { status: 'stopped', recording: false, startedAt: null, hlsUrl: null };
  return { status: s.status, recording: s.recording, startedAt: s.startedAt, hlsUrl: s.hlsUrl };
}

export function getAllStates() {
  const out = {};
  states.forEach((_, k) => { out[k] = getState(k); });
  return out;
}

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
    if (type.includes('multipart/x-mixed-replace') || type.includes('mjpeg') || type.includes('image/jpeg') || type.includes('video')) {
      return true;
    }
    if (type.includes('text/html')) {
      const text = await res.text();
      const found = text.match(/(?:src|href)=["']([^"']*(stream|mjpeg|video|capture|shot\.jpg|jpg|jpeg)[^"']*)["']/i);
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

export async function detectCameraStreamUrl(sourceUrl, signal) {
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

  return null;
}

async function resolveHttpStreamUrl(sourceUrl) {
  const resolved = await detectCameraStreamUrl(sourceUrl);
  return resolved || sourceUrl;
}

export async function startCamera(camera) {
  const id  = String(camera.id);
  const cur = states.get(id);
  if (cur?.status === 'running') return;

  const hlsDir = path.join(HLS_DIR, id);
  const recDir = path.join(RECORDINGS_DIR, id);
  ensureDir(hlsDir);
  ensureDir(recDir);

  const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const hlsIndex = path.join(hlsDir, 'index.m3u8');
  const mp4File  = path.join(recDir, `${ts}.mp4`);
  let sourceUrl = camera.rtsp_url;
  const normalizedUrl = sourceUrl.trim();
  const isRtsp    = /^rtsp:/i.test(normalizedUrl);
  if (!isRtsp && normalizedUrl) {
    sourceUrl = await resolveHttpStreamUrl(normalizedUrl);
  }

  const args = [];
  if (isRtsp) args.push('-rtsp_transport', RTSP_TRANSPORT);
  args.push('-y', '-i', sourceUrl);

  const useCopy = isRtsp;
  const videoCodec = useCopy ? 'copy' : 'libx264';
  const videoCodecArgs = useCopy
    ? ['-c:v', 'copy']
    : ['-c:v', videoCodec, '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '23', '-pix_fmt', 'yuv420p'];

  const audioCodecArgs = isRtsp
    ? ['-c:a', 'aac']
    : ['-an'];

  const outArgs = [
    '-map', '0',
    ...videoCodecArgs,
    ...audioCodecArgs,
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(hlsDir, 'seg%05d.ts'),
    hlsIndex,
    '-map', '0',
    ...videoCodecArgs,
    ...audioCodecArgs,
    '-movflags', 'frag_keyframe+empty_moov',
    mp4File,
  ];

  const argsFinal = [...args, ...outArgs];

  const proc = spawn(FFMPEG_BIN, argsFinal, { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`[CAM ${id}] lancement ffmpeg ${FFMPEG_BIN} ${argsFinal.join(' ')}`);

  proc.on('error', err => {
    console.error(`[CAM ${id}] impossible de démarrer ffmpeg (${FFMPEG_BIN}): ${err.message}`);
    states.set(id, {
      proc: null,
      status: 'stopped',
      recording: false,
      startedAt: null,
      hlsUrl: null,
    });
    broadcast(id);
  });

  states.set(id, {
    proc,
    status:    'running',
    recording: true,
    startedAt: new Date().toISOString(),
    hlsUrl:    `/hls/${id}/index.m3u8`,
  });
  broadcast(id);

  proc.stderr.on('data', data => {
    const txt = data.toString();
    if (txt.includes('Error') || txt.includes('error'))
      console.error(`[CAM ${id}] ffmpeg: ${txt.slice(0, 200)}`);
  });

  proc.on('close', code => {
    const s = states.get(id);
    if (s && s.status !== 'stopped') {
      console.log(`[CAM ${id}] ffmpeg fermé (code ${code}), redémarrage dans 5s…`);
      s.status = 'reconnecting';
      broadcast(id);
      setTimeout(() => startCamera(camera), 5000);
    }
  });

  console.log(`[CAM ${id}] Démarré → ${sourceUrl} transport=${isRtsp ? RTSP_TRANSPORT : 'http'}`);
}

export function pauseCamera(cameraId) {
  const id = String(cameraId);
  const s  = states.get(id);
  if (!s || s.status !== 'running') return false;
  // Sur Windows SIGSTOP n'existe pas → on tue et marque paused
  s.proc.kill('SIGKILL');
  s.status    = 'paused';
  s.recording = false;
  broadcast(id);
  return true;
}

export function resumeCamera(camera) {
  const id = String(camera.id);
  const s  = states.get(id);
  if (s?.status === 'paused') {
    states.delete(id);
    startCamera(camera);
    return true;
  }
  if (!s) { startCamera(camera); return true; }
  return false;
}

export function stopCamera(cameraId) {
  const id = String(cameraId);
  const s  = states.get(id);
  if (!s) return false;
  s.status    = 'stopped';
  s.recording = false;
  s.proc.kill('SIGKILL');
  states.delete(id);
  broadcast(id);
  console.log(`[CAM ${id}] Arrêtée`);
  return true;
}

export function stopAllCameras() {
  states.forEach((s, id) => {
    s.proc?.kill('SIGKILL');
    console.log(`[CAM ${id}] Arrêtée (shutdown)`);
  });
  states.clear();
}