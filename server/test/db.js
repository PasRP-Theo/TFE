// Base PostgreSQL réelle pour les tests d'intégration (le SQL est vraiment exécuté).
//  - TEST_DATABASE_URL défini (CI) : vrai serveur PostgreSQL, un schéma isolé par fichier de test
//  - sinon : PGlite (moteur PostgreSQL en WebAssembly, en mémoire), rien à installer
// Usage dans un fichier de test :
//   vi.mock('../db/index.js', async () => ({ pool: (await import('../../test/db.js')).testDb.pool }));
import { randomBytes } from 'crypto';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';

// tables conservées entre deux tests : historique des migrations et ligne unique des réglages
const KEPT_TABLES = new Set(['schema_migrations', 'app_settings']);

// PGlite n'a qu'une connexion : un client « emprunté » (transaction) est exclusif,
// comme une connexion d'un pool pg. Les requêtes directes (pool.query) passent sans attendre.
function pgliteAdapter(db) {
  const run = async (text, params = []) => {
    if (params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1] || { rows: [] };
      return { rows: last.rows, rowCount: last.affectedRows || last.rows.length };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  let queue = Promise.resolve();
  return {
    query: run,
    async connect() {
      let release;
      const previous = queue;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      return { query: run, release: () => release() };
    },
    end: () => db.close(),
  };
}

async function createPool() {
  if (process.env.TEST_DATABASE_URL) {
    const schema = `test_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
      max: 5,
    });
    const end = pool.end.bind(pool);
    pool.end = async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
      await end();
    };
    return pool;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  return pgliteAdapter(new PGlite());
}

async function createTestDatabase() {
  const pool = await createPool();
  await migrate(pool, { log: () => {} });

  return {
    pool,
    /** vide toutes les tables et remet les réglages par défaut (à appeler dans beforeEach) */
    async reset() {
      const { rows } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`
      );
      const tables = rows.map(row => row.tablename).filter(name => !KEPT_TABLES.has(name));
      if (tables.length) await pool.query(`TRUNCATE ${tables.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
      await pool.query('DELETE FROM app_settings');
      await pool.query(
        `INSERT INTO app_settings (id, app_name, app_subtitle, system_version) VALUES (1, 'SENTYS', 'Système de surveillance', 'v2.4.1')`
      );
    },
    close: () => pool.end(),
  };
}

// une base par fichier de test (vitest isole les modules de chaque fichier)
export const testDb = await createTestDatabase();
