import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { parseFfmpegProbe, probeStream } from './streamProbe.js';

describe('lecture de la sortie ffmpeg', () => {
  it('codec et résolution', () => {
    const stderr = "Input #0, rtsp, from 'rtsp://192.168.0.21:554/h264Preview_01_main':\n  Stream #0:0: Video: h264 (High), yuv420p(progressive), 2560x1920, 20 fps, 90k tbn\n";
    expect(parseFfmpegProbe(stderr)).toEqual({ ok: true, codec: 'h264', width: 2560, height: 1920 });
  });

  it('H.265', () => {
    expect(parseFfmpegProbe('  Stream #0:0: Video: hevc (Main), yuvj420p(pc), 3840x2160, 15 fps')).toMatchObject({ ok: true, codec: 'hevc' });
  });

  it('causes d\'échec reconnues', () => {
    expect(parseFfmpegProbe('method DESCRIBE failed: 401 Unauthorized')).toEqual({ ok: false, error: 'auth' });
    expect(parseFfmpegProbe('method DESCRIBE failed: 404 Not Found')).toEqual({ ok: false, error: 'not_found' });
    expect(parseFfmpegProbe('Connection to tcp://192.168.0.99:554 failed: Connection refused')).toEqual({ ok: false, error: 'unreachable' });
  });
});

// vrai ffmpeg sur de courtes vidéos générées (H.264 et H.265) ; ignoré si le binaire est absent
// (la CI installe les dépendances avec --ignore-scripts : ffmpeg-static n'y télécharge rien)
describe.skipIf(!ffmpegPath || !existsSync(ffmpegPath))('sonde réelle', () => {
  let dir;
  const generate = (file, codec) => spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10',
    '-t', '1', '-c:v', codec, '-pix_fmt', 'yuv420p', '-y', path.join(dir, file),
  ]).status === 0;

  beforeAll(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'sentys-probe-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('détecte un flux H.264', async () => {
    expect(generate('h264.mp4', 'libx264')).toBe(true);
    expect(await probeStream(path.join(dir, 'h264.mp4'))).toEqual({ ok: true, codec: 'h264', width: 320, height: 240 });
  }, 20_000);

  it('détecte un flux H.265 (à convertir)', async (ctx) => {
    if (!generate('hevc.mp4', 'libx265')) ctx.skip(); // ffmpeg sans encodeur H.265
    expect(await probeStream(path.join(dir, 'hevc.mp4'))).toMatchObject({ ok: true, codec: 'hevc' });
  }, 20_000);

  it('flux inexistant : échec propre, sans blocage', async () => {
    const result = await probeStream(path.join(dir, 'absent.mp4'), { timeoutMs: 3000 });
    expect(result.ok).toBe(false);
  }, 10_000);
});
