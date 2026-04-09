import { Router } from 'express';
import { pool } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getAlertsSummary } from '../alerts/service.js';

const router = Router();

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

router.get('/', requireAuth, async (req, res) => {
  const page = Math.max(parseInteger(req.query.page, 1), 1);
  const pageSize = Math.min(Math.max(parseInteger(req.query.pageSize, 20), 1), 100);
  const level = String(req.query.level || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const type = String(req.query.type || '').trim().toLowerCase();
  const search = String(req.query.search || '').trim();
  const offset = (page - 1) * pageSize;

  const conditions = [];
  const values = [];

  if (level) {
    values.push(level);
    conditions.push(`level = $${values.length}`);
  }
  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`alert_type = $${values.length}`);
  }
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    conditions.push(`(LOWER(title) LIKE $${values.length} OR LOWER(message) LIKE $${values.length} OR LOWER(COALESCE(source_id, '')) LIKE $${values.length})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countValues = [...values];
    const listValues = [...values, pageSize, offset];
    const [{ rows: countRows }, { rows }] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM alerts ${whereClause}`, countValues),
      pool.query(
        `SELECT id, source_type, source_id, camera_id, alert_type, level, title, message, metadata, status, acknowledged_by, acknowledged_at, created_at
         FROM alerts
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${values.length + 1}
         OFFSET $${values.length + 2}`,
        listValues
      ),
    ]);

    res.json({
      page,
      pageSize,
      total: countRows[0]?.total || 0,
      alerts: rows,
    });
  } catch (err) {
    console.error('[ALERT LIST]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture des alertes' });
  }
});

router.get('/summary', requireAuth, async (_req, res) => {
  try {
    const summary = await getAlertsSummary();
    res.json(summary);
  } catch (err) {
    console.error('[ALERT SUMMARY]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture du resume des alertes' });
  }
});

router.get('/analytics', requireAuth, async (_req, res) => {
  try {
    const [alerts24hResult, topCamerasResult, hourlyActivityResult, offlineResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total_alerts,
           COUNT(*) FILTER (WHERE level = 'critical')::int AS critical_alerts,
           COUNT(*) FILTER (WHERE status IN ('new', 'viewed'))::int AS pending_alerts
         FROM alerts
         WHERE created_at >= NOW() - INTERVAL '24 hours'`
      ),
      pool.query(
        `SELECT cn.name, cn.device_id, COUNT(me.id)::int AS motion_events
         FROM camera_nodes cn
         LEFT JOIN camera_node_motion_events me
           ON me.device_id = cn.device_id
          AND me.detected_at >= NOW() - INTERVAL '7 days'
         GROUP BY cn.name, cn.device_id
         ORDER BY motion_events DESC, cn.name ASC
         LIMIT 5`
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM detected_at)::int AS hour, COUNT(*)::int AS events
         FROM camera_node_motion_events
         WHERE detected_at >= NOW() - INTERVAL '7 days'
         GROUP BY hour
         ORDER BY hour ASC`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS offline_nodes
         FROM camera_nodes
         WHERE last_seen_at < NOW() - INTERVAL '90 seconds'`
      ),
    ]);

    const hours = Array.from({ length: 24 }, (_, hour) => {
      const match = hourlyActivityResult.rows.find((row) => row.hour === hour);
      return { hour, events: match?.events || 0 };
    });

    res.json({
      overview: {
        totalAlerts24h: alerts24hResult.rows[0]?.total_alerts || 0,
        criticalAlerts24h: alerts24hResult.rows[0]?.critical_alerts || 0,
        pendingAlerts: alerts24hResult.rows[0]?.pending_alerts || 0,
        offlineNodes: offlineResult.rows[0]?.offline_nodes || 0,
      },
      topActiveCameras: topCamerasResult.rows,
      hourlyActivity: hours,
    });
  } catch (err) {
    console.error('[ALERT ANALYTICS]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la lecture des statistiques' });
  }
});

router.get('/export', requireAuth, async (req, res) => {
  const level = String(req.query.level || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const type = String(req.query.type || '').trim().toLowerCase();
  const conditions = [];
  const values = [];

  if (level) {
    values.push(level);
    conditions.push(`level = $${values.length}`);
  }
  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`alert_type = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT created_at, alert_type, level, source_type, source_id, status, title, message
       FROM alerts
       ${whereClause}
       ORDER BY created_at DESC`,
      values
    );

    const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [
      ['created_at', 'alert_type', 'level', 'source_type', 'source_id', 'status', 'title', 'message'].join(','),
      ...rows.map((row) => [
        escapeCell(row.created_at),
        escapeCell(row.alert_type),
        escapeCell(row.level),
        escapeCell(row.source_type),
        escapeCell(row.source_id),
        escapeCell(row.status),
        escapeCell(row.title),
        escapeCell(row.message),
      ].join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="alerts-export.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('[ALERT EXPORT]', err);
    res.status(500).json({ error: 'Erreur serveur lors de l’export des alertes' });
  }
});

router.patch('/:id/ack', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE alerts
       SET status = 'acknowledged',
           acknowledged_by = $2,
           acknowledged_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Alerte introuvable' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[ALERT ACK]', err);
    res.status(500).json({ error: 'Erreur serveur lors de l’acquittement de l’alerte' });
  }
});

router.patch('/:id/view', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE alerts
       SET status = CASE WHEN status = 'new' THEN 'viewed' ELSE status END
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Alerte introuvable' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[ALERT VIEW]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la mise a jour de l’alerte' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM alerts WHERE id = $1', [req.params.id]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Alerte introuvable' });
    }

    res.json({ deleted: true, id: Number(req.params.id) });
  } catch (err) {
    console.error('[ALERT DELETE]', err);
    res.status(500).json({ error: 'Erreur serveur lors de la suppression de l’alerte' });
  }
});

export default router;
