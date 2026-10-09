import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import express from 'express';

// YOLO simulé : le processus Python « répond » une personne détectée à 91 %
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: vi.fn(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    setImmediate(() => {
      proc.stdout.emit('data', '{"type":"person","label":"Personne","confidence":0.91}\n');
      proc.emit('close', 0);
    });
    return proc;
  }),
}));
vi.mock('../db/index.js', async () => ({ pool: (await import('../../test/db.js')).testDb.pool }));
vi.mock('./push.js', () => ({ broadcastPush: vi.fn(async () => ({ sent: 1, failed: 0 })) }));
vi.mock('../camera/manager.js', () => ({
  startCamera: vi.fn(), startHlsStream: vi.fn(async () => {}), stopHlsStream: vi.fn(),
  getState: vi.fn(() => ({ status: 'stopped' })), triggerMotionRecording: vi.fn(), RECORDINGS_DIR: '.',
}));
vi.mock('../security/deviceAuth.js', () => ({
  requireDevice: () => (_req, _res, next) => next(),
  requireDeviceIfPaired: () => (_req, _res, next) => next(),
  issueDeviceToken: vi.fn(), revokeDeviceToken: vi.fn(),
}));

const { testDb } = await import('../../test/db.js');
const { default: router } = await import('./cameraNodes.js');
const { broadcastPush } = await import('./push.js');
const { triggerMotionRecording } = await import('../camera/manager.js');
const { pool } = testDb;

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/camera-nodes', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await testDb.reset();
  vi.clearAllMocks();
  await pool.query(
    `INSERT INTO camera_nodes (device_id, name, host, stream_url, location)
     VALUES ('pi-jardin', 'Pi jardin', '10.0.0.9', 'rtsp://10.0.0.9:8554/cam1', 'Jardin')`
  );
  await pool.query(`INSERT INTO cameras (id, name, rtsp_url) VALUES (3, 'Jardin', 'rtsp://10.0.0.9:8554/cam1')`);
});

afterAll(async () => {
  server?.close();
  await testDb.close();
});

const motion = () => fetch(`${base}/api/camera-nodes/motion`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: 'pi-jardin', motion: true }),
});
const alerts = async () => (await pool.query('SELECT alert_type, level, title, camera_id FROM alerts')).rows;

describe('POST /api/camera-nodes/motion (de bout en bout)', () => {
  it('armé : enregistrement, alerte critique « Personne » et UNE notification', async () => {
    expect((await motion()).status).toBe(200);
    await vi.waitFor(async () => expect(await alerts()).toHaveLength(1));
    expect((await alerts())[0]).toEqual({
      alert_type: 'motion_detected', level: 'critical', title: 'Personne (91%) — CAM 3 — Jardin', camera_id: 3,
    });
    await vi.waitFor(() => expect(broadcastPush).toHaveBeenCalledTimes(1));
    expect(broadcastPush).toHaveBeenCalledWith(expect.objectContaining({ body: 'Zone : Jardin' }));
    await vi.waitFor(() => expect(triggerMotionRecording).toHaveBeenCalledWith(3, 30), { timeout: 5000 });
  });

  it('mouvements répétés : une seule alerte et une seule notification (cooldown)', async () => {
    await motion();
    await vi.waitFor(async () => expect(await alerts()).toHaveLength(1));
    await motion();
    await motion();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await alerts()).toHaveLength(1);
    expect(broadcastPush).toHaveBeenCalledTimes(1);
  });

  it('désarmé : badge mis à jour, mais ni enregistrement, ni alerte, ni notification', async () => {
    await pool.query('UPDATE app_settings SET surveillance_mode = false WHERE id = 1');
    const res = await motion();
    expect(await res.json()).toMatchObject({ ignored: true });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await alerts()).toEqual([]);
    expect(broadcastPush).not.toHaveBeenCalled();
    const { rows } = await pool.query(`SELECT motion_detected FROM camera_nodes WHERE device_id = 'pi-jardin'`);
    expect(rows[0].motion_detected).toBe(true);
  });

  it('« motion » en texte « false » n\'est pas un mouvement', async () => {
    await fetch(`${base}/api/camera-nodes/motion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'pi-jardin', motion: 'false' }),
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await alerts()).toEqual([]);
  });
});
