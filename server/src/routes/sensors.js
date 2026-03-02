import { Router }                    from 'express';
import { pool }                      from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// GET /api/sensors
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
             r.value       AS last_value,
             r.status      AS last_status,
             r.recorded_at AS last_seen
      FROM sensors s
      LEFT JOIN LATERAL (
        SELECT value, status, recorded_at
        FROM sensor_readings
        WHERE sensor_id = s.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) r ON true
      WHERE s.active = true
      ORDER BY s.id
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/sensors/:id/history
router.get('/:id/history', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const { rows } = await pool.query(
      `SELECT value, status, recorded_at
       FROM sensor_readings
       WHERE sensor_id = $1
       ORDER BY recorded_at DESC LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/sensors  (admin)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, type, location, mqtt_topic, unit, alert_at } = req.body;
  if (!name || !type)
    return res.status(400).json({ error: 'Nom et type requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO sensors (name, type, location, mqtt_topic, unit, alert_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, type, location, mqtt_topic, unit, alert_at]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Ce topic MQTT est déjà utilisé' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/sensors/:id  (admin)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, type, location, mqtt_topic, unit, alert_at, active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE sensors
       SET name=$1, type=$2, location=$3, mqtt_topic=$4, unit=$5, alert_at=$6, active=$7
       WHERE id=$8 RETURNING *`,
      [name, type, location, mqtt_topic, unit, alert_at, active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Capteur introuvable' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/sensors/:id  (admin - soft delete)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE sensors SET active=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Capteur désactivé' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;