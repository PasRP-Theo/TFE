import { pool } from '../db/index.js';
import { cleanupOldRecordings } from '../camera/manager.js';
import { getRetentionPolicy } from './policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function purge(label, sql, params) {
  try {
    const { rowCount } = await pool.query(sql, params);
    if (rowCount > 0) console.log(`[RETENTION] ${label} : ${rowCount} ligne(s) supprimée(s)`);
  } catch (err) {
    console.error(`[RETENTION] ${label} :`, err.message);
  }
}

export async function runRetention() {
  const policy = getRetentionPolicy();
  await cleanupOldRecordings({ retentionDays: policy.recordingsDays })
    .catch(err => console.error('[RETENTION] enregistrements :', err.message));
  await purge('alertes', `DELETE FROM alerts WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`, [policy.alertsDays]);
  await purge('événements de mouvement', `DELETE FROM camera_node_motion_events WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`, [policy.motionEventsDays]);
  await purge('journal d\'audit', `DELETE FROM audit_logs WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`, [policy.auditDays]);
  await purge('sessions', `DELETE FROM refresh_tokens WHERE COALESCE(revoked_at, expires_at) < NOW() - ($1 || ' days')::INTERVAL`, [policy.sessionsDays]);
  await purge('jetons d\'appareils révoqués', `DELETE FROM device_tokens WHERE revoked_at < NOW() - INTERVAL '90 days'`, []);
  await purge('codes de récupération utilisés', `DELETE FROM mfa_recovery_codes WHERE used_at < NOW() - INTERVAL '30 days'`, []);
}

export function scheduleRetention() {
  const policy = getRetentionPolicy();
  console.log(`[RETENTION] images ${policy.recordingsDays} j · alertes ${policy.alertsDays} j · mouvements ${policy.motionEventsDays} j · audit ${policy.auditDays} j`);
  runRetention();
  setInterval(runRetention, DAY_MS);
}
