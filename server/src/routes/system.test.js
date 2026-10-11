import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';

vi.mock('systeminformation', () => {
  const battery = vi.fn(async () => ({ hasBattery: true, isCharging: false, percent: 63 }));
  const empty = vi.fn(async () => ({}));
  return {
    default: {
      battery, cpu: empty, currentLoad: empty, cpuTemperature: empty, mem: empty, osInfo: empty,
      fsSize: vi.fn(async () => []), networkInterfaces: vi.fn(async () => []),
    },
  };
});
vi.mock('../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));
vi.mock('../camera/manager.js', () => ({ stopAllCameras: vi.fn() }));
vi.mock('../auth/setup.js', () => ({ issueSetupToken: vi.fn() }));
vi.mock('../audit/log.js', () => ({ logAudit: vi.fn() }));

const { default: si } = await import('systeminformation');
const { default: router } = await import('./system.js');

let server;
let base;
beforeAll(async () => {
  const app = express();
  app.use('/api/system', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server?.close());

describe('/api/system', () => {
  it('/power : alimentation seule, sans lire processeur ni disques', async () => {
    const power = await (await fetch(`${base}/api/system/power`)).json();
    expect(power).toEqual({ hasBattery: true, isCharging: false, percent: 63 });
    expect(si.fsSize).not.toHaveBeenCalled();
  });

  it('/info : requêtes simultanées → une seule lecture système', async () => {
    vi.mocked(si.fsSize).mockClear();
    const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}/api/system/info`)));
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(si.fsSize).toHaveBeenCalledTimes(1);
    expect((await responses[0].json()).battery.percent).toBe(63);
  });
});
