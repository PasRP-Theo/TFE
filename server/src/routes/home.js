import { Router } from 'express';
import { pool } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Météo : cache mémoire 30 min
let weatherCache = null;
let weatherCacheAt = 0;
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

const WEATHER_LAT = process.env.WEATHER_LAT || '50.5745';
const WEATHER_LON = process.env.WEATHER_LON || '4.5282';

const WMO_LABELS = {
  0: 'Ciel dégagé', 1: 'Principalement dégagé', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine modérée', 55: 'Bruine forte',
  61: 'Pluie légère', 63: 'Pluie modérée', 65: 'Pluie forte',
  71: 'Neige légère', 73: 'Neige modérée', 75: 'Neige forte', 77: 'Grains de neige',
  80: 'Averses légères', 81: 'Averses modérées', 82: 'Averses violentes',
  85: 'Averses de neige', 86: 'Averses de neige fortes',
  95: 'Orage', 96: 'Orage avec grêle', 99: 'Orage avec forte grêle',
};

const WMO_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️', 77: '❄️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  85: '🌨️', 86: '🌨️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

// ── LISTE DE COURSES ───────────────────────────────────────────────────────

router.get('/shopping', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM shopping_items ORDER BY position ASC, created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('[SHOPPING LIST]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/shopping', requireAuth, async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Texte requis' });
  try {
    const { rows: [{ max_pos }] } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) AS max_pos FROM shopping_items'
    );
    const { rows } = await pool.query(
      'INSERT INTO shopping_items (text, position) VALUES ($1, $2) RETURNING *',
      [text, max_pos + 1]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[SHOPPING ADD]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/shopping/:id', requireAuth, async (req, res) => {
  const { text, checked } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE shopping_items SET
         text    = COALESCE($2, text),
         checked = COALESCE($3, checked)
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        text != null ? String(text).trim() || null : null,
        checked != null ? Boolean(checked) : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Article introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[SHOPPING UPDATE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// /checked AVANT /:id pour éviter la collision de route
router.delete('/shopping/checked', requireAuth, async (_req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM shopping_items WHERE checked = true');
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error('[SHOPPING DELETE CHECKED]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/shopping/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM shopping_items WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Article introuvable' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[SHOPPING DELETE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── MÉTÉO (Open-Meteo, modèle IRM) ────────────────────────────────────────

router.get('/weather', requireAuth, async (_req, res) => {
  const now = Date.now();
  if (weatherCache && now - weatherCacheAt < WEATHER_CACHE_TTL_MS) {
    return res.json(weatherCache);
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
      `&timezone=Europe%2FBrussels&forecast_days=7&models=best_match`;

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const data = await response.json();

    const current = {
      temperature:         data.current.temperature_2m,
      apparentTemperature: data.current.apparent_temperature,
      humidity:            data.current.relative_humidity_2m,
      windSpeed:           data.current.wind_speed_10m,
      weatherCode:         data.current.weather_code,
      label: WMO_LABELS[data.current.weather_code] ?? 'Inconnu',
      icon:  WMO_ICONS[data.current.weather_code]  ?? '🌡️',
      time:  data.current.time,
    };

    const daily = data.daily.time.map((date, i) => ({
      date,
      weatherCode:   data.daily.weather_code[i],
      label: WMO_LABELS[data.daily.weather_code[i]] ?? 'Inconnu',
      icon:  WMO_ICONS[data.daily.weather_code[i]]  ?? '🌡️',
      tempMax:       data.daily.temperature_2m_max[i],
      tempMin:       data.daily.temperature_2m_min[i],
      precipitation: data.daily.precipitation_sum[i],
      windMax:       data.daily.wind_speed_10m_max[i],
    }));

    weatherCache = {
      current,
      daily,
      source:   'Open-Meteo / IRM',
      location: { lat: WEATHER_LAT, lon: WEATHER_LON },
      cachedAt: new Date().toISOString(),
    };
    weatherCacheAt = now;

    res.json(weatherCache);
  } catch (err) {
    console.error('[WEATHER]', err);
    if (weatherCache) return res.json({ ...weatherCache, stale: true });
    res.status(503).json({ error: 'Service météo temporairement indisponible' });
  }
});

// ── NOTES ─────────────────────────────────────────────────────────────────

router.get('/notes', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM home_notes ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('[NOTES LIST]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/notes', requireAuth, async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Texte requis' });
  if (text.length > 500) return res.status(400).json({ error: 'Note trop longue (500 car. max)' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO home_notes (text) VALUES ($1) RETURNING *',
      [text]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[NOTES ADD]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/notes/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM home_notes WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Note introuvable' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[NOTES DELETE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
