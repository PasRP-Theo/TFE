import { Router } from 'express';
import { pool }   from '../db/index.js';

const router = Router();

// GET /api/grocery
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM grocery_items ORDER BY category, created_at`
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/grocery
router.post('/', async (req, res) => {
  const { name, category, quantity, unit } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO grocery_items (name, category, quantity, unit)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, category, quantity || 1, unit || 'pcs']
    );
    res.status(201).json(rows[0]);
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PATCH /api/grocery/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'category', 'quantity', 'unit', 'checked'];
  const updates = [], values = [];
  let idx = 1;
  allowed.forEach(f => {
    if (req.body[f] !== undefined) { updates.push(`${f}=$${idx++}`); values.push(req.body[f]); }
  });
  if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
  values.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE grocery_items SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Article introuvable' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/grocery/checked/all  ← avant /:id
router.delete('/checked/all', async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM grocery_items WHERE checked=true`);
    res.json({ deleted: rowCount });
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/grocery/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM grocery_items WHERE id=$1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Article introuvable' });
    res.json({ message: 'Supprimé' });
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

export default router;