import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Migrations versionnées : src/db/migrations/NNNN_nom.sql (SQL) ou NNNN_nom.js (export up(client)).
// Chacune s'exécute une seule fois, dans sa propre transaction, dans l'ordre des numéros.
// L'empreinte de chaque fichier est conservée : modifier une migration déjà appliquée est refusé.
export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// verrou global : deux instances du serveur ne migrent jamais en même temps
const MIGRATION_LOCK_ID = 727_001;

export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter(file => /^\d{4}_[\w-]+\.(sql|js)$/.test(file))
    .sort()
    .map(file => {
      const content = readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
      return {
        version: file.slice(0, 4),
        name: file,
        file: path.join(dir, file),
        checksum: createHash('sha256').update(content).digest('hex'),
        sql: file.endsWith('.sql') ? content : null,
      };
    });
}

/** @returns {Promise<string[]>} noms des migrations appliquées lors de cet appel */
export async function migrate(pool, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    CHAR(4)      PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        checksum   CHAR(64)     NOT NULL,
        applied_at TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    const { rows } = await client.query('SELECT version, name, checksum FROM schema_migrations');
    const done = new Map(rows.map(row => [row.version, row]));

    for (const migration of listMigrations(dir)) {
      const previous = done.get(migration.version);
      if (previous) {
        if (previous.checksum !== migration.checksum) {
          throw new Error(`[MIGRATION] ${migration.name} a été modifiée après son application : créez une nouvelle migration`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        if (migration.sql !== null) {
          await client.query(migration.sql);
        } else {
          const { up } = await import(pathToFileURL(migration.file).href);
          await up(client);
        }
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`[MIGRATION] ${migration.name} : ${err.message}`, { cause: err });
      }
      applied.push(migration.name);
      log(`[MIGRATION] ${migration.name} appliquée`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
