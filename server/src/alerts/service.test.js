import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { createAlert, getAlertsSummary } from './service.js';
import { pool } from '../db/index.js';

const BASE_ALERT = {
  sourceType: 'camera',
  alertType: 'offline',
  level: 'warning',
  title: 'Caméra hors ligne',
  message: 'La caméra 1 ne répond plus',
};

describe('createAlert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lève une erreur si les paramètres requis sont manquants', async () => {
    await expect(createAlert({ sourceType: 'camera' })).rejects.toThrow();
  });

  it('crée une alerte sans dedupeKey et retourne l\'objet inséré', async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ id: 1, ...BASE_ALERT, status: 'new' }],
    });

    const result = await createAlert(BASE_ALERT);
    expect(result.skipped).toBe(false);
    expect(result.alert.id).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('saute la création si dans la période de cooldown', async () => {
    const recentDate = new Date(Date.now() - 60_000); // 1 min ago < 600s cooldown
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ id: 42, created_at: recentDate }],
    });

    const result = await createAlert({ ...BASE_ALERT, dedupeKey: 'cam-offline-1' });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('cooldown');
    expect(result.alertId).toBe(42);
  });

  it('crée une alerte si le cooldown est expiré', async () => {
    const oldDate = new Date(Date.now() - 700_000); // 700s ago > 600s cooldown
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 5, created_at: oldDate }] })
      .mockResolvedValueOnce({ rows: [{ id: 6, ...BASE_ALERT, status: 'new' }] });

    const result = await createAlert({ ...BASE_ALERT, dedupeKey: 'cam-offline-1' });
    expect(result.skipped).toBe(false);
    expect(result.alert.id).toBe(6);
  });

  it('saute silencieusement en cas de race condition dedupe (erreur 23505)', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] }) // pas d'entrée récente
      .mockRejectedValueOnce(Object.assign(new Error('unique violation'), { code: '23505' }));

    const result = await createAlert({ ...BASE_ALERT, dedupeKey: 'cam-offline-race' });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('dedupe-race');
  });

  it('ne fait pas de requête dedupe si dedupeKey est null', async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ id: 10, ...BASE_ALERT, status: 'new' }],
    });

    await createAlert(BASE_ALERT); // pas de dedupeKey
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('getAlertsSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retourne les compteurs depuis la base de données', async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ pending_count: 3, critical_pending_count: 1, last_24h_count: 7 }],
    });

    const summary = await getAlertsSummary();
    expect(summary.pending_count).toBe(3);
    expect(summary.critical_pending_count).toBe(1);
    expect(summary.last_24h_count).toBe(7);
  });

  it('retourne des zéros si la requête ne retourne aucune ligne', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] });

    const summary = await getAlertsSummary();
    expect(summary.pending_count).toBe(0);
    expect(summary.critical_pending_count).toBe(0);
    expect(summary.last_24h_count).toBe(0);
  });
});
