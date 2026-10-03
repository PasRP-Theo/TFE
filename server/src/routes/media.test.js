import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn(async (_sql, [id]) => ({ rows: id === 7 ? [{ id: 7, username: 'alice' }] : [] })) },
}));
vi.mock('../audit/log.js', () => ({ logAudit: vi.fn() }));

const { createHlsRouter, createRecordingsRouter } = await import('./media.js');
const { signLivePrefix, signRecordingUrl } = await import('../security/urlSigning.js');
const { logAudit } = await import('../audit/log.js');

let server;
let base;
let tmp;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'sentys-media-'));
  mkdirSync(path.join(tmp, 'hls', '2'), { recursive: true });
  mkdirSync(path.join(tmp, 'rec', '2'), { recursive: true });
  writeFileSync(path.join(tmp, 'hls', '2', 'index.m3u8'), '#EXTM3U');
  writeFileSync(path.join(tmp, 'rec', '2', 'clip.mp4'), 'mp4data');
  writeFileSync(path.join(tmp, 'secret.txt'), 'nope');

  const app = express();
  app.use('/hls', createHlsRouter(path.join(tmp, 'hls')));
  app.use('/recordings', createRecordingsRouter(path.join(tmp, 'rec')));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('HLS', () => {
  it('refuse l\'accès direct sans signature', async () => {
    expect((await fetch(`${base}/hls/2/index.m3u8`)).status).toBe(401);
  });

  it('sert le manifeste avec un préfixe signé et journalise l\'accès', async () => {
    const res = await fetch(`${base}${signLivePrefix(2, 7)}/index.m3u8`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(logAudit).toHaveBeenCalledWith('alice', 'VIDEO_LIVE_VIEW', 'Caméra 2', expect.anything());
  });

  it('refuse un préfixe signé pour une autre caméra', async () => {
    const prefix = signLivePrefix(3, 7).replace(/\/3$/, '/2');
    expect((await fetch(`${base}${prefix}/index.m3u8`)).status).toBe(403);
  });

  it('refuse un utilisateur supprimé', async () => {
    expect((await fetch(`${base}${signLivePrefix(2, 99)}/index.m3u8`)).status).toBe(403);
  });
});

describe('enregistrements', () => {
  it('refuse sans signature', async () => {
    expect((await fetch(`${base}/recordings/2/clip.mp4`)).status).toBe(403);
  });

  it('sert un fichier signé', async () => {
    const res = await fetch(`${base}${signRecordingUrl('/recordings/2/clip.mp4', 7)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('mp4data');
  });

  it('ne permet pas de sortir du dossier', async () => {
    const res = await fetch(`${base}${signRecordingUrl('/recordings/../secret.txt', 7)}`);
    expect(res.status).not.toBe(200);
  });
});
