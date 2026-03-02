import { Router } from 'express';
import bcrypt      from 'bcryptjs';
import { pool }    from '../db/index.js';

const router = Router();

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, role, created_at FROM users ORDER BY created_at'
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users — creation depuis le panel admin
router.post('/', async (req, res) => {
  const { email, password, role = 'user' } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (6 caracteres min)' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password, role) VALUES ($1,$2,$3) RETURNING id, email, role, created_at',
      [email.toLowerCase().trim(), hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Identifiant deja utilise' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/users/:id — modifier le role
router.patch('/:id', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role))
    return res.status(400).json({ error: 'Role invalide' });
  try {
    const { rows } = await pool.query(
      'UPDATE users SET role=$1 WHERE id=$2 RETURNING id, email, role, created_at',
      [role, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ message: 'Supprime' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;