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

  const insertSql =
    `INSERT INTO alerts (source_type, source_id, camera_id, alert_type, level, title, message, metadata, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING *`;
  const insertValues = [sourceType, sourceId, cameraId, alertType, level, title, message, JSON.stringify(metadata || {}), dedupeKey];

  if (!dedupeKey) {
    const { rows } = await pool.query(insertSql, insertValues);
    return { skipped: false, alert: rows[0] };
  }

  // anti-doublon : verrou par clé le temps de la transaction, pour que deux détections
  // simultanées ne créent pas deux alertes ; après le cooldown, la même clé est réutilisable
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dedupeKey]);
    const { rows: recent } = await client.query(
      `SELECT id FROM alerts
       WHERE dedupe_key = $1 AND created_at > NOW() - make_interval(secs => $2)
       ORDER BY created_at DESC
       LIMIT 1`,
      [dedupeKey, cooldownSeconds]
    );
    if (recent[0]) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'cooldown', alertId: recent[0].id };
    }
    const { rows } = await client.query(insertSql, insertValues);
    await client.query('COMMIT');
    return { skipped: false, alert: rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// système désarmé (PIN) : les détections de mouvement ne déclenchent ni enregistrement ni alerte
export async function isSurveillanceArmed() {
  const { rows } = await pool.query('SELECT surveillance_mode FROM app_settings WHERE id = 1');
  return rows[0]?.surveillance_mode !== false;
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
