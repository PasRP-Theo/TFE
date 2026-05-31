import { spawn }           from 'child_process';
import path                from 'path';
import { fileURLToPath }   from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH  = path.join(__dirname, '..', '..', 'go2rtc.yaml');
const GO2RTC_URL   = process.env.GO2RTC_URL  || 'http://127.0.0.1:1984';
const GO2RTC_BIN   = process.env.GO2RTC_BIN  || 'go2rtc';

let proc  = null;
let ready = false;

// nommage
export function streamName(cameraId) {
  return `cam${cameraId}`;
}

// démarrage
export function startGo2rtc() {
  return new Promise((resolve) => {
    proc = spawn(GO2RTC_BIN, ['-config', CONFIG_PATH], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let errored = false;

    proc.on('error', (err) => {
      errored = true;
      if (err.code === 'ENOENT') {
        console.warn('[go2rtc] Binaire introuvable — WebRTC désactivé, HLS actif en fallback.');
        console.warn('[go2rtc] Installez go2rtc : https://github.com/AlexxIT/go2rtc/releases');
      } else {
        console.error('[go2rtc] Erreur démarrage :', err.message);
      }
      ready = false;
      resolve(false);
    });

    const onReady = () => {
      if (ready) return;
      ready = true;
      console.log('[go2rtc] Prêt sur :1984');
      resolve(true);
    };

    // détection prêt stdout/stderr
    const detectReady = (data) => {
      const txt = data.toString();
      if (txt.includes('1984') || txt.includes('listen') || txt.includes('server')) {
        onReady();
      }
    };

    proc.stdout.on('data', detectReady);
    proc.stderr.on('data', detectReady);

    proc.on('close', (code) => {
      ready = false;
      if (code !== 0 && code !== null) {
        console.error(`[go2rtc] Processus terminé (code ${code})`);
      }
    });

    // timeout 4s, suppose actif si pas d'erreur démarrage
    setTimeout(() => {
      if (!ready && !errored) {
        console.warn('[go2rtc] Timeout détection — on suppose go2rtc actif.');
        onReady();
      }
    }, 4000);
  });
}

export function isReady() { return ready; }

export function stopGo2rtc() {
  if (proc) {
    proc.kill('SIGTERM');
    proc  = null;
    ready = false;
  }
}

// streams REST
export async function registerStream(cameraId, rtspUrl) {
  if (!ready) return false;
  const name = streamName(cameraId);
  try {
    const res = await fetch(
      `${GO2RTC_URL}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(rtspUrl)}`,
      { method: 'PUT' }
    );
    if (res.ok) console.log(`[go2rtc] Stream enregistré : ${name} → ${rtspUrl}`);
    return res.ok;
  } catch (err) {
    console.error('[go2rtc] registerStream :', err.message);
    return false;
  }
}

export async function unregisterStream(cameraId) {
  if (!ready) return;
  const name = streamName(cameraId);
  try {
    await fetch(`${GO2RTC_URL}/api/streams?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    console.log(`[go2rtc] Stream supprimé : ${name}`);
  } catch (err) {
    console.error('[go2rtc] unregisterStream :', err.message);
  }
}

// négociation WebRTC
export async function negotiate(cameraId, sdpOffer) {
  const name = streamName(cameraId);
  const res = await fetch(
    `${GO2RTC_URL}/api/webrtc?src=${encodeURIComponent(name)}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body:    sdpOffer,
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`go2rtc ${res.status}: ${body}`);
  }
  return res.text();
}

// sync depuis DB
export async function syncCamerasFromDB(pool, { retries = 5, delayMs = 2000 } = {}) {
  if (!ready) return;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { rows } = await pool.query(
        "SELECT id, rtsp_url FROM cameras WHERE active = true"
      );
      await Promise.all(rows.map((cam) => registerStream(cam.id, cam.rtsp_url)));
      console.log(`[go2rtc] ${rows.length} caméra(s) synchronisée(s) depuis la base`);
      return;
    } catch (err) {
      console.error(`[go2rtc] syncCamerasFromDB tentative ${attempt}/${retries} :`, err.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
