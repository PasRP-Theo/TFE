import { describe, it, expect, vi, beforeEach } from 'vitest';

const tokens = new Map(); // hash -> { device_id, revoked }

vi.mock('../db/index.js', () => ({
  pool: {
    query: vi.fn(async (sql, params) => {
      if (sql.startsWith('UPDATE device_tokens SET last_used_at')) {
        const entry = tokens.get(params[0]);
        return { rows: entry && !entry.revoked ? [{ device_id: entry.device_id }] : [] };
      }
      if (sql.startsWith('SELECT 1 FROM device_tokens')) {
        const active = [...tokens.values()].some(t => t.device_id === params[0] && !t.revoked);
        return { rows: active ? [{}] : [] };
      }
      return { rows: [] };
    }),
  },
}));

const { requireDevice, requireDeviceIfPaired, hashDeviceToken, getInternalToken } = await import('./deviceAuth.js');

function run(middleware, headers = {}) {
  return new Promise(resolve => {
    const req = { headers, ip: '192.168.0.10', params: {}, body: {} };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { resolve({ next: false, status: this.statusCode, req }); },
    };
    middleware(req, res, () => resolve({ next: true, status: 200, req }));
  });
}

beforeEach(() => {
  tokens.clear();
  tokens.set(hashDeviceToken('sdt_pi-salon'), { device_id: 'pi-salon', revoked: false });
  tokens.set(hashDeviceToken('sdt_revoque'), { device_id: 'pi-garage', revoked: true });
});

describe('requireDevice', () => {
  it('refuse une requête sans jeton', async () => {
    expect(await run(requireDevice())).toMatchObject({ next: false, status: 401 });
  });

  it('accepte un jeton valide pour le bon appareil', async () => {
    const result = await run(requireDevice({ getDeviceId: () => 'pi-salon' }), { authorization: 'Bearer sdt_pi-salon' });
    expect(result.next).toBe(true);
    expect(result.req.device).toEqual({ deviceId: 'pi-salon' });
  });

  it('refuse un jeton valide utilisé pour un autre appareil', async () => {
    const result = await run(requireDevice({ getDeviceId: () => 'pi-cuisine' }), { authorization: 'Bearer sdt_pi-salon' });
    expect(result).toMatchObject({ next: false, status: 403 });
  });

  it('refuse un jeton révoqué', async () => {
    expect(await run(requireDevice(), { authorization: 'Bearer sdt_revoque' })).toMatchObject({ next: false, status: 401 });
  });

  it('accepte le jeton interne seulement si autorisé', async () => {
    const header = { authorization: `Bearer ${getInternalToken()}` };
    expect((await run(requireDevice({ allowInternal: true }), header)).next).toBe(true);
    expect((await run(requireDevice(), header)).next).toBe(false);
  });
});

describe('requireDeviceIfPaired', () => {
  it('laisse annoncer un appareil non appairé sans jeton', async () => {
    expect((await run(requireDeviceIfPaired(() => 'esp32-nouveau'))).next).toBe(true);
  });

  it('exige le jeton pour un appareil déjà appairé', async () => {
    expect(await run(requireDeviceIfPaired(() => 'pi-salon'))).toMatchObject({ next: false, status: 401 });
    expect((await run(requireDeviceIfPaired(() => 'pi-salon'), { authorization: 'Bearer sdt_pi-salon' })).next).toBe(true);
  });
});
