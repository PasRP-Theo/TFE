import { Router }   from 'express';
import { negotiate, isReady, registerStream, unregisterStream } from '../go2rtc/manager.js';
import { pool }      from '../db/index.js';

const router = Router();

// ── GET /api/webrtc/status ───────────────────────────────────
// Indique au client si WebRTC est disponible
router.get('/status', (_req, res) => {
  res.json({ available: isReady() });
});

// ── POST /api/webrtc/:cameraId ───────────────────────────────
// Reçoit la SDP offer du navigateur et retourne la SDP answer de go2rtc.
// Le corps doit être en text/plain ou application/sdp.
router.post(
  '/:cameraId',
  (req, res, next) => {
    // Parser SDP comme texte brut (express.json() ne convient pas ici)
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { req.sdpBody = body; next(); });
  },
  async (req, res) => {
    if (!isReady()) {
      return res.status(503).json({ error: 'WebRTC non disponible (go2rtc inactif)' });
    }

    const cameraId = parseInt(req.params.cameraId, 10);
    if (isNaN(cameraId)) {
      return res.status(400).json({ error: 'cameraId invalide' });
    }

    const sdpOffer = req.sdpBody;
    if (!sdpOffer?.trim()) {
      return res.status(400).json({ error: 'SDP offer manquant dans le corps de la requête' });
    }

    try {
      let sdpAnswer;
      try {
        sdpAnswer = await negotiate(cameraId, sdpOffer);
      } catch (firstErr) {
        // Stream inconnu de go2rtc → on tente un enregistrement à la volée puis on réessaie
        const { rows } = await pool.query('SELECT rtsp_url FROM cameras WHERE id = $1', [cameraId]);
        if (rows[0]) {
          await registerStream(cameraId, rows[0].rtsp_url);
          sdpAnswer = await negotiate(cameraId, sdpOffer);
        } else {
          throw firstErr;
        }
      }
      res.type('application/sdp').send(sdpAnswer);
    } catch (err) {
      console.error(`[WEBRTC] Négociation cam ${cameraId} échouée :`, err.message);
      res.status(502).json({ error: err.message });
    }
  }
);

// ── POST /api/webrtc/:cameraId/register ──────────────────────
// Enregistre ou met à jour un stream dans go2rtc depuis la base
router.post('/:cameraId/register', async (req, res) => {
  const cameraId = parseInt(req.params.cameraId, 10);
  if (isNaN(cameraId)) return res.status(400).json({ error: 'cameraId invalide' });

  try {
    const { rows } = await pool.query('SELECT rtsp_url FROM cameras WHERE id = $1', [cameraId]);
    if (!rows[0]) return res.status(404).json({ error: 'Caméra introuvable' });
    const ok = await registerStream(cameraId, rows[0].rtsp_url);
    res.json({ registered: ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/webrtc/:cameraId ─────────────────────────────
// Retire un stream de go2rtc (appelé quand une caméra est supprimée)
router.delete('/:cameraId', async (req, res) => {
  const cameraId = parseInt(req.params.cameraId, 10);
  if (isNaN(cameraId)) return res.status(400).json({ error: 'cameraId invalide' });
  await unregisterStream(cameraId);
  res.json({ unregistered: true });
});

export default router;
