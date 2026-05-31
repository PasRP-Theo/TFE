import { Router }       from 'express';
import bcrypt           from 'bcryptjs';
import jwt              from 'jsonwebtoken';
import { pool }         from '../db/index.js';
import { requireAuth }  from '../middleware/auth.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/auth.js';

const router = Router();

// inscription
router.post('/register', async (req, res) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Mot de passe trop court (8 caractères min)' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password, role)
       VALUES ($1, $2, $3) RETURNING id, username, role, created_at`,
      [username.toLowerCase().trim(), hash, role]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// connexion
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Champs manquants' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.role     = user.role;

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// déconnexion
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Déconnecté' });
  });
});

// profil
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ user: rows[0] });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
