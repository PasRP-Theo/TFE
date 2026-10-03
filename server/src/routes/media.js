import { Router } from 'express';
import express from 'express';
import path from 'path';
import { pool } from '../db/index.js';
import { logAudit } from '../audit/log.js';
import { verifyLiveCapability, verifyRecordingRequest } from '../security/urlSigning.js';

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const USER_CACHE_TTL_MS = 30_000;
const ACCESS_LOG_DEDUPE_MS = 10 * 60 * 1000;

const userCache = new Map();
const recentAccess = new Map();

// l'utilisateur doit toujours exister (compte supprimé → URL signée inutilisable)
async function resolveUser(userId) {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) return cached.user;
  const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [Number(userId)]);
  const user = rows[0] || null;
  userCache.set(userId, { user, at: Date.now() });
  return user;
}

// journal d'accès aux images (loi caméras art. 9, RGPD art. 5.2), dédupliqué
function logVideoAccess(user, action, details, ip) {
  const key = `${user.id}|${action}|${details}`;
  const last = recentAccess.get(key);
  if (last && Date.now() - last < ACCESS_LOG_DEDUPE_MS) return;
  recentAccess.set(key, Date.now());
  if (recentAccess.size > 5000) {
    const cutoff = Date.now() - ACCESS_LOG_DEDUPE_MS;
    for (const [k, t] of recentAccess) if (t < cutoff) recentAccess.delete(k);
  }
  logAudit(user.username, action, details, ip);
}

function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function createHlsRouter(hlsDir) {
  const router = Router();

  router.get('/s/:capability/:cameraId/:file', async (req, res) => {
    const { capability, cameraId, file } = req.params;
    if (!/^\d+$/.test(cameraId) || !SAFE_SEGMENT.test(file)) return res.status(404).end();
    const claims = verifyLiveCapability(capability, cameraId);
    if (!claims) return res.status(403).json({ error: 'Lien de flux expiré ou invalide' });
    try {
      const user = await resolveUser(claims.userId);
      if (!user) return res.status(403).json({ error: 'Lien de flux expiré ou invalide' });
      if (file.endsWith('.m3u8')) logVideoAccess(user, 'VIDEO_LIVE_VIEW', `Caméra ${cameraId}`, req.ip);
    } catch {
      return res.status(500).end();
    }
    noStore(res);
    res.sendFile(path.join(cameraId, file), { root: hlsDir, dotfiles: 'deny' }, err => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // tout autre accès HLS est refusé
  router.use((_req, res) => res.status(401).json({ error: 'Non authentifié' }));
  return router;
}

export function createRecordingsRouter(recordingsDir) {
  const router = Router();
  const serveStatic = express.static(recordingsDir, { dotfiles: 'deny', index: false, fallthrough: false });

  router.use(async (req, res, next) => {
    let decodedPath;
    try {
      decodedPath = `/recordings${decodeURIComponent(req.path)}`;
    } catch {
      return res.status(400).end();
    }
    const claims = verifyRecordingRequest(decodedPath, req.query);
    if (!claims) return res.status(403).json({ error: 'Lien expiré ou invalide' });
    try {
      const user = await resolveUser(claims.userId);
      if (!user) return res.status(403).json({ error: 'Lien expiré ou invalide' });
      const action = req.query.download === '1' ? 'RECORDING_DOWNLOAD' : 'RECORDING_VIEW';
      logVideoAccess(user, action, decodedPath.replace(/^\/recordings\//, ''), req.ip);
    } catch {
      return res.status(500).end();
    }
    noStore(res);
    // le lecteur intégré du navigateur (onglet « Ouvrir ») serait bloqué par la CSP API
    res.removeHeader('Content-Security-Policy');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(decodedPath).replace(/"/g, '')}"`);
    }
    serveStatic(req, res, next);
  });

  return router;
}
