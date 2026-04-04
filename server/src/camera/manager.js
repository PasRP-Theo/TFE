import { spawn }                  from 'child_process';
import { existsSync, mkdirSync, promises as fsPromises } from 'fs';
import os                         from 'os';
import path                       from 'path';
import { fileURLToPath }          from 'url';
import { EventEmitter }           from 'events';
import ffmpegPath                 from 'ffmpeg-static';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT  = path.resolve(__dirname, '..', '..', '..');
export const RECORDINGS_DIR  = process.env.RECORDINGS_DIR || path.join(PROJECT_ROOT, 'recordings');
const HLS_DIR         = process.env.HLS_DIR        || path.join(PROJECT_ROOT, 'hls');
const FFMPEG_BIN      = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg';
const { readdir, stat, unlink, rm } = fsPromises;
const RTSP_TRANSPORT  = process.env.RTSP_TRANSPORT || 'tcp';
const HTTP_STREAM_CANDIDATES = [
  '/stream', '/mjpeg', '/mjpeg/1', '/mjpeg/2', '/video', '/video.mjpg',
  '/capture', '/shot.jpg', '/jpg', '/jpeg', '/cam', '/axis-cgi/mjpg/video.cgi',
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
const SCAN_SUBNETS = String(process.env.CAMERA_SCAN_SUBNETS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

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

function isIpv4(address) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
}

function getLastOctet(address) {
  const parts = String(address).split('.');
  return Number(parts[3]);
}

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

  const subnetBases = [
    ...subnets,
    ...localIps.map(getSubnetBase).filter(Boolean),
  ].filter((value, index, array) => array.indexOf(value) === index);

  for (const localIp of localIps) {
    const subnet = getSubnetBase(localIp);
    if (!subnet) continue;
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

export async function scanLocalNetworkForCameraStreams({ stopAfter = SCAN_STOP_AFTER, concurrency = SCAN_CONCURRENCY, signal, preferredHosts = [], subnets = SCAN_SUBNETS } = {}) {
  if (signal?.aborted) return [];
  const localIps = getLocalPrivateIpv4s();
  if (!localIps.length) return [];
  const subnetList = [
    ...subnets,
    ...localIps.map(getSubnetBase).filter(Boolean),
  ].filter((value, index, array) => array.indexOf(value) === index);
  if (!subnetList.length) return [];

  const hosts = buildScanHosts({ localIps, preferredHosts, subnets: subnetList });
  console.log(`[CAM SCAN] démarrage scan local sur ${subnetList.join(', ')} (${hosts.length} adresses, ${preferredHosts.length} prioritaires)`);

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
    const remaining = await readdir(camPath);
    if (remaining.length === 0) {
      await rm(camPath, { recursive: true, force: true });
    }
  }
}

export function stopAllCameras() {
  states.forEach((s, id) => {
    s.proc?.kill('SIGKILL');
    console.log(`[CAM ${id}] Arrêtée (shutdown)`);
  });
  states.clear();
}