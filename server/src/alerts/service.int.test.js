import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../db/index.js', async () => ({ pool: (await import('../../test/db.js')).testDb.pool }));

const { testDb } = await import('../../test/db.js');
const { createAlert, isSurveillanceArmed } = await import('./service.js');
const { pool } = testDb;

const ALERT = {
  sourceType: 'camera', sourceId: '3', alertType: 'motion_detected', level: 'warning',
  title: 'Mouvement — CAM 3', message: 'Mouvement détecté', dedupeKey: 'motion:cam:3', cooldownSeconds: 300,
};

beforeEach(() => testDb.reset());
afterAll(() => testDb.close());

async function ageAlerts(seconds) {
  await pool.query(`UPDATE alerts SET created_at = created_at - make_interval(secs => $1)`, [seconds]);
}

describe('createAlert (base réelle)', () => {
  it('ignore une deuxième alerte de même clé pendant le cooldown', async () => {
    const first = await createAlert(ALERT);
    const second = await createAlert(ALERT);
    expect(first.skipped).toBe(false);
    expect(second).toEqual({ skipped: true, reason: 'cooldown', alertId: first.alert.id });
  });

  it('crée de nouveau une alerte de même clé après le cooldown (régression : index unique)', async () => {
    await createAlert(ALERT);
    await ageAlerts(301);
    const again = await createAlert(ALERT);
    expect(again.skipped).toBe(false);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM alerts WHERE dedupe_key = $1', [ALERT.dedupeKey]);
    expect(rows[0].n).toBe(2);
  });

  it('ne mélange pas deux clés différentes', async () => {
    await createAlert(ALERT);
    const other = await createAlert({ ...ALERT, dedupeKey: 'motion:cam:4' });
    expect(other.skipped).toBe(false);
  });

  it('cooldown à 0 : chaque alerte est créée', async () => {
    const a = await createAlert({ ...ALERT, cooldownSeconds: 0 });
    const b = await createAlert({ ...ALERT, cooldownSeconds: 0 });
    expect([a.skipped, b.skipped]).toEqual([false, false]);
  });

  it('détections simultanées : une seule alerte', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createAlert(ALERT)));
    expect(results.filter(r => !r.skipped)).toHaveLength(1);
  });

  it('stocke les métadonnées en JSONB', async () => {
    const { alert } = await createAlert({ ...ALERT, metadata: { deviceId: 'pi-salon', confidence: 0.9 } });
    expect(alert.metadata).toEqual({ deviceId: 'pi-salon', confidence: 0.9 });
  });
});

describe('isSurveillanceArmed (base réelle)', () => {
  it('armé par défaut, désarmé quand le réglage le dit', async () => {
    expect(await isSurveillanceArmed()).toBe(true);
    await pool.query('UPDATE app_settings SET surveillance_mode = false WHERE id = 1');
    expect(await isSurveillanceArmed()).toBe(false);
  });
});
