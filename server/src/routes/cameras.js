import { Router } from 'express';
import { pool }   from '../db/index.js';

const router = Router();

// GET /api/cameras
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cameras ORDER BY id');
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cameras
router.post('/', async (req, res) => {
  const { name, rtsp_url, location } = req.body;
  if (!name || !rtsp_url)
    return res.status(400).json({ error: 'Nom et URL RTSP requis' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO cameras (name, rtsp_url, location) VALUES ($1,$2,$3) RETURNING *',
      [name, rtsp_url, location || '']
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/cameras/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cameras WHERE id=$1', [req.params.id]);
    res.json({ message: 'Supprime' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;