// Applique les migrations en attente sans démarrer le serveur (le serveur le fait aussi au démarrage).
//   npm run migrate            → applique
//   npm run migrate -- --status → liste l'état de chaque migration
import 'dotenv/config';
import { pool } from '../src/db/index.js';
import { migrate, listMigrations } from '../src/db/migrate.js';

try {
  if (process.argv.includes('--status')) {
    const { rows } = await pool.query('SELECT version, applied_at FROM schema_migrations').catch(() => ({ rows: [] }));
    const applied = new Map(rows.map(row => [row.version, row.applied_at]));
    for (const migration of listMigrations()) {
      const at = applied.get(migration.version);
      console.log(`${at ? '✔' : '…'} ${migration.name}${at ? `  (${new Date(at).toLocaleString('fr-FR')})` : '  en attente'}`);
    }
  } else {
    const done = await migrate(pool);
    console.log(done.length ? `${done.length} migration(s) appliquée(s)` : 'Base déjà à jour');
  }
} finally {
  await pool.end();
}
