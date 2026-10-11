import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../db/index.js', async () => ({ pool: (await import('../../test/db.js')).testDb.pool }));
vi.mock('../routes/push.js', () => ({ broadcastPush: vi.fn(async () => ({ sent: 1, failed: 0 })) }));

const { testDb } = await import('../../test/db.js');
const { createOfflineMonitor } = await import('./offlineMonitor.js');
const { pool } = testDb;

let clock;
let states;
let monitor;

const alerts = async () => (await pool.query('SELECT alert_type, source_id FROM alerts ORDER BY id')).rows;
const advance = ms => { clock += ms; };

beforeEach(async () => {
  await testDb.reset();
  clock = 1_000_000;
  states = {};
  monitor = createOfflineMonitor({ getCameraStates: () => states, confirmDelayMs: 60_000, now: () => clock });
  await pool.query(`INSERT INTO cameras (id, name, rtsp_url) VALUES (3, 'Jardin', 'rtsp://10.0.0.3/cam')`);
});
afterAll(() => testDb.close());

describe('caméras', () => {
  it('une coupure brève (< délai de confirmation) ne déclenche rien', async () => {
    states['3'] = { status: 'reconnecting' };
    await monitor.check();
    advance(30_000);
    states['3'] = { status: 'running' };
    await monitor.check();
    advance(60_000);
    await monitor.check();
    expect(await alerts()).toEqual([]);
  });

  it('une coupure confirmée déclenche UNE alerte, même si elle dure des heures', async () => {
    states['3'] = { status: 'reconnecting' };
    await monitor.check();
    for (let i = 0; i < 10; i += 1) {
      advance(60 * 60_000); // 1 h
      await monitor.check();
    }
    expect(await alerts()).toEqual([{ alert_type: 'camera_offline', source_id: '3' }]);
  });

  it('après le retour de la caméra, une nouvelle coupure est de nouveau signalée', async () => {
    states['3'] = { status: 'reconnecting' };
    await monitor.check();
    advance(61_000); await monitor.check();
    states['3'] = { status: 'running' };
    await monitor.check();
    // nouvelle coupure plus tard (hors cooldown de la règle : 30 min, mesuré par la base)
    advance(31 * 60_000);
    await pool.query(`UPDATE alerts SET created_at = created_at - INTERVAL '31 minutes'`);
    states['3'] = { status: 'reconnecting' };
    await monitor.check();
    advance(61_000); await monitor.check();
    expect(await alerts()).toHaveLength(2);
  });
});

describe('noeuds Pi', () => {
  it('signale un Pi silencieux depuis plus de 90 s, une seule fois', async () => {
    await pool.query(
      `INSERT INTO camera_nodes (device_id, name, host, stream_url, last_seen_at)
       VALUES ('pi-salon', 'Salon', '10.0.0.9', 'rtsp://10.0.0.9:8554/cam1', NOW() - INTERVAL '5 minutes'),
              ('pi-cuisine', 'Cuisine', '10.0.0.8', 'rtsp://10.0.0.8:8554/cam1', NOW())`
    );
    await monitor.check();
    advance(61_000); await monitor.check();
    advance(61_000); await monitor.check();
    expect(await alerts()).toEqual([{ alert_type: 'node_offline', source_id: 'pi-salon' }]);
  });
});

it('en cas d\'erreur lors de l\'alerte, retente au passage suivant', async () => {
  states['3'] = { status: 'reconnecting' };
  await monitor.check();
  advance(61_000);
  // la lecture des réglages échoue une fois (base indisponible au moment de l'alerte)
  // bind : pg.Pool.query a besoin de son « this » (PGlite non, d'où un test vert en local)
  const realQuery = pool.query.bind(pool);
  let failed = false;
  pool.query = async (sql, params) => {
    if (!failed && String(sql).includes('FROM app_settings')) {
      failed = true;
      throw new Error('base indisponible');
    }
    return realQuery(sql, params);
  };
  try {
    await expect(monitor.check()).rejects.toThrow('base indisponible');
  } finally {
    pool.query = realQuery;
  }
  await monitor.check();
  expect(await alerts()).toHaveLength(1);
});
