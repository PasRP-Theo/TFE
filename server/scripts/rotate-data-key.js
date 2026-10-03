// Rotation de DATA_ENCRYPTION_KEY (identifiants caméras, secrets MFA).
//
// 1. openssl rand -base64 48                       → nouvelle clé
// 2. DATA_ENCRYPTION_KEY_PREVIOUS=<ancienne> DATA_ENCRYPTION_KEY=<nouvelle> npm run rotate-data-key
// 3. enregistrer la nouvelle clé (server/.env ou ~/.sentys/secrets.json), retirer l'ancienne, redémarrer
import 'dotenv/config';
import { pool } from '../src/db/index.js';
import { decryptString, encryptString, isEncryptedWithCurrentKey } from '../src/security/dataCrypto.js';

if (!process.env.DATA_ENCRYPTION_KEY || !process.env.DATA_ENCRYPTION_KEY_PREVIOUS) {
  console.error('DATA_ENCRYPTION_KEY (nouvelle) et DATA_ENCRYPTION_KEY_PREVIOUS (ancienne) sont requises.');
  process.exit(1);
}

const targets = [
  { table: 'cameras', column: 'credentials_enc', aad: id => `camera:${id}` },
  { table: 'users', column: 'totp_secret_enc', aad: id => `totp:${id}` },
  { table: 'users', column: 'totp_pending_enc', aad: id => `totp:${id}` },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');
  let rotated = 0;
  for (const { table, column, aad } of targets) {
    const { rows } = await client.query(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL FOR UPDATE`);
    for (const row of rows) {
      if (isEncryptedWithCurrentKey(row.value)) continue;
      const plaintext = decryptString(row.value, aad(row.id));
      await client.query(`UPDATE ${table} SET ${column} = $2 WHERE id = $1`, [row.id, encryptString(plaintext, aad(row.id))]);
      rotated += 1;
    }
  }
  await client.query('COMMIT');
  console.log(`[ROTATION] ${rotated} valeur(s) rechiffrée(s) avec la nouvelle clé.`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('[ROTATION] Échec, aucune modification appliquée :', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
