import { describe, it, expect, vi, beforeEach } from 'vitest';

const client = { query: vi.fn(), release: vi.fn() };
vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn(async () => client) },
}));

const sqlCalls = () => client.query.mock.calls.map(([sql]) => sql);

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
  beforeEach(() => { vi.clearAllMocks(); client.query.mockReset(); });

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

  it('saute la création si une alerte de même clé existe dans le cooldown', async () => {
    client.query.mockImplementation(async (sql) => (
      sql.startsWith('SELECT id FROM alerts') ? { rows: [{ id: 42 }] } : { rows: [] }
    ));

    const result = await createAlert({ ...BASE_ALERT, dedupeKey: 'cam-offline-1' });
    expect(result).toEqual({ skipped: true, reason: 'cooldown', alertId: 42 });
    expect(sqlCalls()).not.toContainEqual(expect.stringContaining('INSERT'));
    expect(sqlCalls()).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('réutilise la même clé après le cooldown (nouvelle alerte créée)', async () => {
    client.query.mockImplementation(async (sql) => (
      sql.startsWith('INSERT') ? { rows: [{ id: 6, ...BASE_ALERT, status: 'new' }] } : { rows: [] }
    ));

    const result = await createAlert({ ...BASE_ALERT, dedupeKey: 'cam-offline-1', cooldownSeconds: 600 });
    expect(result.skipped).toBe(false);
    expect(result.alert.id).toBe(6);
    // le cooldown est évalué par la base, sur la même clé
    const [, params] = client.query.mock.calls.find(([sql]) => sql.startsWith('SELECT id FROM alerts'));
    expect(params).toEqual(['cam-offline-1', 600]);
    expect(sqlCalls()).toContain('COMMIT');
  });

  it('verrouille la clé avant de vérifier puis d\'insérer (détections simultanées)', async () => {
    client.query.mockResolvedValue({ rows: [{ id: 7 }] });
    await createAlert({ ...BASE_ALERT, dedupeKey: 'motion:cam:3' });
    const calls = sqlCalls();
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('pg_advisory_xact_lock');
  });

  it('annule la transaction et libère la connexion en cas d\'erreur', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT')) throw new Error('db down');
      return { rows: [] };
    });
    await expect(createAlert({ ...BASE_ALERT, dedupeKey: 'k' })).rejects.toThrow('db down');
    expect(sqlCalls()).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
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
