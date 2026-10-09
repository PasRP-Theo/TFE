import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../db/index.js', async () => ({ pool: (await import('../../test/db.js')).testDb.pool }));
vi.mock('../routes/push.js', () => ({ broadcastPush: vi.fn(async () => ({ sent: 1, failed: 0 })) }));

const { testDb } = await import('../../test/db.js');
const { raiseAlert, setAlertRealtimeChannel } = await import('./engine.js');
const { broadcastPush } = await import('../routes/push.js');
const { pool } = testDb;

const io = { emit: vi.fn() };
setAlertRealtimeChannel(io);

const motion = (overrides = {}) => ({
  type: 'motion_detected', subject: 'cam:3', sourceType: 'camera', sourceId: '3', cameraId: null,
  title: 'Personne (91%) — CAM 3', message: 'Personne détectée', pushBody: 'Zone : jardin', ...overrides,
});
const setting = (column, value) => pool.query(`UPDATE app_settings SET ${column} = $1 WHERE id = 1`, [value]);
const alertCount = async () => (await pool.query('SELECT COUNT(*)::int AS n FROM alerts')).rows[0].n;

beforeEach(async () => {
  await testDb.reset();
  vi.clearAllMocks();
});
afterAll(() => testDb.close());

describe('raiseAlert', () => {
  it('crée l\'alerte, prévient l\'interface et envoie UNE notification', async () => {
    const result = await raiseAlert(motion({ level: 'critical' }));
    expect(result.skipped).toBe(false);
    expect(result.alert).toMatchObject({ alert_type: 'motion_detected', level: 'critical', dedupe_key: 'motion_detected:cam:3' });
    expect(io.emit).toHaveBeenCalledWith('new_alert', expect.objectContaining({ id: result.alert.id, level: 'critical' }));
    expect(broadcastPush).toHaveBeenCalledTimes(1);
    expect(broadcastPush).toHaveBeenCalledWith({ title: 'Personne (91%) — CAM 3', body: 'Zone : jardin', url: '/alerts' });
  });

  it('pendant le cooldown : ni alerte, ni interface, ni notification', async () => {
    await raiseAlert(motion());
    vi.clearAllMocks();
    const second = await raiseAlert(motion());
    expect(second).toMatchObject({ skipped: true, reason: 'cooldown' });
    expect(io.emit).not.toHaveBeenCalled();
    expect(broadcastPush).not.toHaveBeenCalled();
    expect(await alertCount()).toBe(1);
  });

  it('surveillance désarmée : un mouvement ne produit rien', async () => {
    await setting('surveillance_mode', false);
    expect(await raiseAlert(motion())).toEqual({ skipped: true, reason: 'disarmed' });
    expect(await alertCount()).toBe(0);
    expect(broadcastPush).not.toHaveBeenCalled();
  });

  it('surveillance désarmée : une caméra hors ligne reste signalée', async () => {
    await setting('surveillance_mode', false);
    const result = await raiseAlert({
      type: 'camera_offline', subject: 'cam:3', sourceType: 'camera', sourceId: '3',
      title: 'CAM 3 hors ligne', message: 'La caméra ne répond plus',
    });
    expect(result.skipped).toBe(false);
    expect(result.alert.level).toBe('critical');
    expect(broadcastPush).toHaveBeenCalledTimes(1);
  });

  it('« Alerter si une caméra se déconnecte » désactivé : pas d\'alerte hors ligne', async () => {
    await setting('alerts_disconnect_enabled', false);
    const result = await raiseAlert({
      type: 'node_offline', subject: 'node:pi-salon', sourceType: 'camera-node', sourceId: 'pi-salon',
      title: 'Noeud hors ligne', message: '…',
    });
    expect(result).toEqual({ skipped: true, reason: 'disabled' });
  });

  it('« Alertes en temps réel » désactivé : alerte créée, interface non prévenue', async () => {
    await setting('alerts_realtime_enabled', false);
    const result = await raiseAlert(motion());
    expect(result.skipped).toBe(false);
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('alertes informatives : pas de notification push', async () => {
    await raiseAlert({
      type: 'camera_started', subject: 'cam:3', sourceType: 'camera', sourceId: '3',
      title: 'Stream démarré — CAM 3', message: 'Flux activé',
    });
    expect(broadcastPush).not.toHaveBeenCalled();
    expect(io.emit).toHaveBeenCalledTimes(1);
  });

  it('refuse un type d\'alerte inconnu', async () => {
    await expect(raiseAlert({ ...motion(), type: 'inconnu' })).rejects.toThrow(/inconnu/);
  });
});
