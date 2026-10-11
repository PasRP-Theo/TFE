import { describe, it, expect, afterAll } from 'vitest';
import { cpSync, mkdtempSync, appendFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { testDb } from '../../test/db.js';
import { migrate, listMigrations, MIGRATIONS_DIR } from './migrate.js';

const { pool } = testDb;
afterAll(() => testDb.close());

describe('migrations', () => {
  it('applique toutes les migrations sur une base vide, dans l\'ordre', async () => {
    const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY version');
    expect(rows.map(r => r.name)).toEqual(listMigrations().map(m => m.name));
  });

  it('ne réapplique rien au démarrage suivant', async () => {
    expect(await migrate(pool, { log: () => {} })).toEqual([]);
  });

  it('s\'applique aussi sur une installation existante (schéma déjà créé par l\'ancien initDB)', async () => {
    // on « oublie » l'historique : le schéma est là mais aucune migration n'est enregistrée,
    // exactement la situation de la base de production au premier démarrage de cette version
    await pool.query('DELETE FROM schema_migrations');
    const applied = await migrate(pool, { log: () => {} });
    expect(applied).toEqual(listMigrations().map(m => m.name));
  });

  it('crée le schéma attendu', async () => {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`
    );
    expect(rows.map(r => r.tablename)).toEqual(expect.arrayContaining([
      'alerts', 'app_settings', 'audit_logs', 'camera_node_motion_events', 'camera_nodes', 'cameras',
      'device_tokens', 'mfa_recovery_codes', 'push_subscriptions', 'refresh_tokens', 'users',
    ]));
  });

  it('remplace l\'index unique de dedupe_key (0003)', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema() AND tablename = 'alerts' AND indexname LIKE 'idx_alerts_dedupe%'`
    );
    expect(rows.map(r => r.indexname)).toEqual(['idx_alerts_dedupe_key_created']);
  });

  it('refuse une migration modifiée après son application', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sentys-migrations-'));
    try {
      cpSync(MIGRATIONS_DIR, dir, { recursive: true });
      appendFileSync(path.join(dir, '0003_alerts_dedupe_index.sql'), '\n-- modifiée\n');
      await expect(migrate(pool, { dir, log: () => {} })).rejects.toThrow(/modifiée après son application/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('annule entièrement une migration en échec', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sentys-migrations-'));
    try {
      cpSync(MIGRATIONS_DIR, dir, { recursive: true });
      const { writeFileSync } = await import('fs');
      writeFileSync(path.join(dir, '9999_cassee.sql'), 'CREATE TABLE temp_ok (id INT);\nSELECT * FROM table_inexistante;\n');
      await expect(migrate(pool, { dir, log: () => {} })).rejects.toThrow(/9999_cassee/);
      const { rows } = await pool.query(`SELECT to_regclass('temp_ok') AS t`);
      expect(rows[0].t).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
