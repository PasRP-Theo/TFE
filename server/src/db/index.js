import pg from 'pg';
import { warnIfWeak } from '../config/secrets.js';
import { migrate } from './migrate.js';
const { Pool } = pg;

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  throw new Error(`[DB] Variables manquantes dans .env : ${missing.join(', ')}`);
}

warnIfWeak('DB_PASSWORD', process.env.DB_PASSWORD);
if (process.env.DB_USER === 'postgres') {
  console.warn('[SECRETS ⚠] DB_USER=postgres (superutilisateur) : utilisez le rôle dédié sentys_app (server/sql/roles.sql).');
}

export const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('error', err => console.error('[PostgreSQL]', err.message));

// schéma : migrations versionnées (src/db/migrations, voir migrate.js)
export async function initDB() {
  await migrate(pool);
  // pas de compte par défaut : voir src/auth/setup.js
  console.log('[DB] Base de données initialisée (migrations à jour)');
}

// purge discoveries
async function _pruneStaleDiscoveries(ttlMinutes) {
  const { rowCount } = await pool.query(
    `DELETE FROM camera_discoveries WHERE last_seen_at < NOW() - ($1 || ' minutes')::INTERVAL`,
    [ttlMinutes]
  );
  if (rowCount > 0) console.log(`[DISCOVERY CLEANUP] ${rowCount} entrée(s) expirée(s) supprimée(s)`);
}

export function scheduleDiscoveryCleanup(ttlMinutes = 10, intervalMs = 5 * 60 * 1000) {
  _pruneStaleDiscoveries(ttlMinutes).catch(err => console.error('[DISCOVERY CLEANUP]', err));
  setInterval(() => _pruneStaleDiscoveries(ttlMinutes).catch(err => console.error('[DISCOVERY CLEANUP]', err)), intervalMs);
}
