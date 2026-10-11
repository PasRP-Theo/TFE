import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegPath || 'ffmpeg';

/**
 * Lit l'en-tête de la sortie ffmpeg : codec et résolution du premier flux vidéo, ou cause d'échec.
 * @returns {{ ok: true, codec: string, width: number|null, height: number|null } | { ok: false, error: string }}
 */
export function parseFfmpegProbe(stderr) {
  const video = /Stream #\d+:\d+[^\n]*?: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr)
    || /Stream #\d+:\d+[^\n]*?: Video: (\w+)/.exec(stderr);
  if (video) {
    return { ok: true, codec: video[1].toLowerCase(), width: Number(video[2]) || null, height: Number(video[3]) || null };
  }
  if (/401 Unauthorized|403 Forbidden/i.test(stderr)) return { ok: false, error: 'auth' };
  if (/404 Not Found|454 Session Not Found|Invalid data found/i.test(stderr)) return { ok: false, error: 'not_found' };
  if (/Connection refused|No route to host|Network is unreachable|timed out|Connection timed out/i.test(stderr)) {
    return { ok: false, error: 'unreachable' };
  }
  return { ok: false, error: 'unknown' };
}

export const PROBE_ERRORS = {
  auth: 'Identifiant ou mot de passe refusé par la caméra',
  not_found: 'La caméra répond, mais ce chemin de flux n\'existe pas',
  unreachable: 'Caméra injoignable sur le réseau',
  timeout: 'La caméra ne répond pas (délai dépassé)',
  unknown: 'Flux illisible',
};

/**
 * Ouvre le flux comme le fera le serveur, sans rien enregistrer.
 * L'URL contient les identifiants : elle n'est jamais journalisée.
 */
export function probeStream(url, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-nostdin'];
    if (/^rtsp:/i.test(url)) args.push('-rtsp_transport', 'tcp', '-timeout', String(timeoutMs * 1000));
    // sans fichier de sortie, ffmpeg affiche les flux trouvés puis s'arrête
    args.push('-i', url);

    let stderr = '';
    let settled = false;
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs + 2000);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    proc.on('error', () => done({ ok: false, error: 'unknown' }));
    proc.on('close', () => done(parseFfmpegProbe(stderr)));
  });
}
