import { pool } from '../db/index.js';

const DEFAULT_COOLDOWN_SECONDS = Number(process.env.ALERT_DEDUPE_COOLDOWN_SECONDS || 600);

export async function createAlert({
  sourceType,
  sourceId = null,
  cameraId = null,
  alertType,
  level = 'info',
  title,
  message,
  metadata = {},
  dedupeKey = null,
  cooldownSeconds = DEFAULT_COOLDOWN_SECONDS,
}) {
  if (!sourceType || !alertType || !title || !message) {
    throw new Error('Parametres d’alerte incomplets');
  }

  if (dedupeKey) {
    const { rows } = await pool.query(
      `SELECT id, created_at
       FROM alerts
       WHERE dedupe_key = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [dedupeKey]
    );

    const lastCreatedAt = rows[0]?.created_at ? new Date(rows[0].created_at).getTime() : null;
    if (lastCreatedAt && Date.now() - lastCreatedAt < cooldownSeconds * 1000) {
      return { skipped: true, reason: 'cooldown', alertId: rows[0].id };
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO alerts (source_type, source_id, camera_id, alert_type, level, title, message, metadata, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING *`,
      [sourceType, sourceId, cameraId, alertType, level, title, message, JSON.stringify(metadata || {}), dedupeKey]
    );
    return { skipped: false, alert: rows[0] };
  } catch (err) {
    if (err.code === '23505') return { skipped: true, reason: 'dedupe-race', alertId: null };
    throw err;
  }
}

export async function getAlertsSummary() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('new', 'viewed'))::int AS pending_count,
       COUNT(*) FILTER (WHERE level = 'critical' AND status IN ('new', 'viewed'))::int AS critical_pending_count,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h_count
     FROM alerts`
  );

  return rows[0] || {
    pending_count: 0,
    critical_pending_count: 0,
    last_24h_count: 0,
  };
}
