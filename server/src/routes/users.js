import { Router } from 'express';
import bcrypt      from 'bcryptjs';
import { pool }    from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { logAudit } from '../../server.js';

const router = Router();

async function getAdminCount(client = pool) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
  return rows[0]?.count ?? 0;
}

async function getAppSettings(client = pool) {
  const { rows } = await client.query(
    'SELECT bootstrap_admin_user_id, default_admin_active FROM app_settings WHERE id = 1'
  );
  return rows[0] || { bootstrap_admin_user_id: null, default_admin_active: false };
}

// liste
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at'
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ajout
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Mot de passe trop court (8 caracteres min)' });
  if (!['user', 'admin'].includes(role))
    return res.status(400).json({ error: 'Role invalide' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1,$2,$3) RETURNING id, username, role, created_at',
      [username.toLowerCase().trim(), hash, role]
    );
    await logAudit(req.user?.username || 'admin', 'USER_CREATE', `Création de l'utilisateur ${username} (Rôle: ${role})`, req.ip);

    if (role === 'admin') {
      const settings = await getAppSettings();
      if (settings.default_admin_active && settings.bootstrap_admin_user_id) {
        await pool.query('DELETE FROM users WHERE id = $1', [settings.bootstrap_admin_user_id]);
        await pool.query(`UPDATE app_settings SET default_admin_active = false, bootstrap_admin_user_id = NULL, updated_at = NOW() WHERE id = 1`);
        await logAudit(req.user?.username || 'admin', 'USER_DELETE', 'Suppression automatique du compte administrateur initial (root)', req.ip);
      }
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Identifiant deja utilise' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// modification
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Identifiant invalide' });

  const nextUsername = typeof req.body.username === 'string' ? req.body.username.toLowerCase().trim() : undefined;
  const nextPassword = typeof req.body.password === 'string' ? req.body.password : undefined;
  const nextRole = typeof req.body.role === 'string' ? req.body.role : undefined;

  if (nextRole !== undefined && !['user', 'admin'].includes(nextRole))
    return res.status(400).json({ error: 'Role invalide' });
  if (nextUsername !== undefined && !nextUsername)
    return res.status(400).json({ error: 'Identifiant requis' });
  if (nextPassword !== undefined && nextPassword.length > 0 && nextPassword.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (6 caracteres min)' });

  try {
    const currentResult = await pool.query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [userId]
    );
    const currentUser = currentResult.rows[0];
    if (!currentUser) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (currentUser.role === 'admin' && nextRole === 'user') {
      const adminCount = await getAdminCount();
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur' });
      }
    }

    const updates = [];
    const values = [];

    if (nextUsername !== undefined && nextUsername !== currentUser.username) {
      values.push(nextUsername);
      updates.push(`username = $${values.length}`);
    }

    if (nextRole !== undefined && nextRole !== currentUser.role) {
      values.push(nextRole);
      updates.push(`role = $${values.length}`);
    }

    if (nextPassword !== undefined && nextPassword.length > 0) {
      const hash = await bcrypt.hash(nextPassword, 12);
      values.push(hash);
      updates.push(`password = $${values.length}`);
    }

    if (updates.length === 0) {
      const { rows } = await pool.query(
        'SELECT id, username, role, created_at FROM users WHERE id = $1',
        [userId]
      );
      return res.json(rows[0]);
    }

    values.push(userId);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING id, username, role, created_at`,
      values
    );

    const changes = [];
    if (nextUsername !== undefined && nextUsername !== currentUser.username) changes.push(`nom: ${currentUser.username} -> ${nextUsername}`);
    if (nextRole !== undefined && nextRole !== currentUser.role) changes.push(`rôle: ${currentUser.role} -> ${nextRole}`);
    if (nextPassword !== undefined && nextPassword.length > 0) changes.push(`mot de passe modifié`);
    if (changes.length > 0) {
      await logAudit(req.user?.username || 'admin', 'USER_UPDATE', `Modification de l'utilisateur ${currentUser.username} (${changes.join(', ')})`, req.ip);
    }

    const settings = await getAppSettings();
    const editedBootstrapAdmin = settings.bootstrap_admin_user_id === userId
      && settings.default_admin_active
      && ((nextUsername !== undefined && nextUsername !== 'root') || (nextPassword !== undefined && nextPassword.length > 0));

    if (editedBootstrapAdmin) {
      await pool.query(
        `UPDATE app_settings
         SET default_admin_active = false,
             updated_at = NOW()
         WHERE id = 1`
      );
    }

    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Identifiant deja utilise' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// suppression
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Identifiant invalide' });

    const currentResult = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [userId]);
    const currentUser = currentResult.rows[0];
    if (!currentUser) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (currentUser.role === 'admin') {
      const adminCount = await getAdminCount();
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur' });
      }
    }

    const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    if (!rowCount) return res.status(404).json({ error: 'Utilisateur introuvable' });
    await logAudit(req.user?.username || 'admin', 'USER_DELETE', `Suppression de l'utilisateur ${currentUser.username}`, req.ip);
    res.json({ message: 'Supprime' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;