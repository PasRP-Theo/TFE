import { Router } from 'express';
import { pool } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

function serializeConfig(row) {
  return {
    appName: row.app_name,
    appSubtitle: row.app_subtitle,
    systemVersion: row.system_version,
    defaultAdminUsername: 'root',
    defaultAdminActive: row.default_admin_active,
  };
}

async function getConfigRow() {
  const { rows } = await pool.query(
    `SELECT app_name, app_subtitle, system_version, default_admin_active
     FROM app_settings
     WHERE id = 1`
  );
  return rows[0];
}

router.get('/', async (_req, res) => {
  try {
    const row = await getConfigRow();
    res.json(serializeConfig(row));
  } catch (err) {
    console.error('[APP CONFIG GET]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/', requireAuth, requireAdmin, async (req, res) => {
  const nextAppName = typeof req.body.appName === 'string' ? req.body.appName.trim() : undefined;
  const nextAppSubtitle = typeof req.body.appSubtitle === 'string' ? req.body.appSubtitle.trim() : undefined;

  if (nextAppName !== undefined && !nextAppName) {
    return res.status(400).json({ error: 'Le titre principal ne peut pas être vide' });
  }
  if (nextAppSubtitle !== undefined && !nextAppSubtitle) {
    return res.status(400).json({ error: 'Le sous-titre ne peut pas être vide' });
  }

  try {
    const current = await getConfigRow();
    const appName = nextAppName ?? current.app_name;
    const appSubtitle = nextAppSubtitle ?? current.app_subtitle;

    const { rows } = await pool.query(
      `UPDATE app_settings
       SET app_name = $1,
           app_subtitle = $2,
           updated_at = NOW()
       WHERE id = 1
       RETURNING app_name, app_subtitle, system_version, default_admin_active`,
      [appName, appSubtitle]
    );

    res.json(serializeConfig(rows[0]));
  } catch (err) {
    console.error('[APP CONFIG PATCH]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
