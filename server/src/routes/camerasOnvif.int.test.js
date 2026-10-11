import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';

process.env.ONVIF_ALLOW_LOOPBACK = '1';

vi.mock('../db/index.js', async () => ({ pool: (await import('../../test/db.js')).testDb.pool }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 1, username: 'admin', role: 'admin' }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
vi.mock('../camera/manager.js', async (importOriginal) => ({
  ...(await importOriginal()),
  startCamera: vi.fn(async () => {}),
}));
// sonde ffmpeg simulée : la fausse caméra n'a pas de vrai serveur RTSP
vi.mock('../camera/streamProbe.js', async (importOriginal) => ({
  ...(await importOriginal()),
  probeStream: vi.fn(async () => ({ ok: true, codec: 'h264', width: 2560, height: 1920 })),
}));
vi.mock('../camera/onvif.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, discoverOnvifDevices: vi.fn(async () => [
    { host: '192.168.0.21', xaddr: 'http://192.168.0.21:8000/onvif/device_service', name: 'Jardin', hardware: 'RLC-510A' },
    { host: '192.168.0.34', xaddr: 'http://192.168.0.34:2020/onvif/device_service', name: null, hardware: 'C210' },
  ]) };
});

const { testDb } = await import('../../test/db.js');
const { startFakeOnvifCamera } = await import('../../test/fakeOnvifCamera.js');
const { default: router } = await import('./cameras.js');
const { probeStream } = await import('../camera/streamProbe.js');
const { decryptCameraCredentials } = await import('../camera/credentials.js');
const { pool } = testDb;

let server;
let base;
let camera;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cameras', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  camera = await startFakeOnvifCamera();
});

beforeEach(async () => {
  await testDb.reset();
  vi.mocked(probeStream).mockClear();
});

afterAll(async () => {
  server?.close();
  await camera?.close();
  await testDb.close();
  delete process.env.ONVIF_ALLOW_LOOPBACK;
});

const post = (path, body) => fetch(`${base}/api/cameras${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('assistant ONVIF (de bout en bout)', () => {
  it('recherche : liste les caméras et signale celles déjà ajoutées', async () => {
    await pool.query(`INSERT INTO cameras (name, rtsp_url) VALUES ('Tapo', 'rtsp://192.168.0.34:554/stream1')`);
    const data = await (await fetch(`${base}/api/cameras/onvif/discover`)).json();
    expect(data.devices.map(d => [d.host, d.alreadyAdded])).toEqual([['192.168.0.21', false], ['192.168.0.34', true]]);
    expect(data.brands.length).toBeGreaterThan(3);
  });

  it('connexion puis ajout : identifiants chiffrés, métadonnées enregistrées', async () => {
    const connect = await post('/onvif/connect', { host: '127.0.0.1', xaddr: camera.xaddr, username: 'admin', password: 'secret' });
    expect(connect.status).toBe(200);
    const found = await connect.json();
    expect(found).toMatchObject({ method: 'onvif', suggestedName: 'Reolink RLC-510A', codecLabel: 'H.264', verified: true });
    expect(JSON.stringify(found)).not.toContain('secret');

    const created = await post('/', {
      name: found.suggestedName, rtsp_url: found.streamUrl, location: 'Jardin',
      username: 'admin', password: 'secret',
      transcode: found.transcode, video_codec: found.codec, manufacturer: found.manufacturer, model: found.model,
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(await created.json())).not.toContain('secret');

    const { rows } = await pool.query('SELECT * FROM cameras');
    expect(rows[0]).toMatchObject({
      rtsp_url: 'rtsp://127.0.0.1:554/h264Preview_01_main?a=1&b=2',
      transcode: false, video_codec: 'h264', manufacturer: 'Reolink', model: 'RLC-510A',
    });
    expect(rows[0].credentials_enc).not.toContain('secret');
    expect(decryptCameraCredentials(rows[0])).toEqual({ username: 'admin', password: 'secret' });
  });

  it('mot de passe refusé : 422 (et non 401, qui déconnecterait l\'utilisateur)', async () => {
    const res = await post('/onvif/connect', { host: '127.0.0.1', xaddr: camera.xaddr, username: 'admin', password: 'faux' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'auth' });
  });

  it('adresse publique refusée : 400', async () => {
    const res = await post('/onvif/connect', { host: '1.1.1.1', username: 'a', password: 'b' });
    expect(res.status).toBe(400);
  });

  it('caméra H.265 : marquée à convertir', async () => {
    vi.mocked(probeStream).mockResolvedValueOnce({ ok: true, codec: 'hevc', width: 3840, height: 2160 });
    const found = await (await post('/onvif/connect', { host: '127.0.0.1', xaddr: camera.xaddr, username: 'admin', password: 'secret' })).json();
    expect(found).toMatchObject({ transcode: true, codecLabel: 'H.265' });
  });
});
