import { pool } from '../db/index.js';

// ne jamais passer de mot de passe, jeton ou URL avec identifiants dans details
export async function logAudit(username, action, details, ip) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (username, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [username, action, details, ip]
    );
  } catch (err) {
    console.error('[AUDIT LOG ERROR]', err.message);
  }
}
