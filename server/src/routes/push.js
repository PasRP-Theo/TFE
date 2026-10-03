import { Router } from 'express';
import webpush from 'web-push';
import { pool } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../audit/log.js';

const router = Router();

const VAPID_READY = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (VAPID_READY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@sentys.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[PUSH] Clés VAPID non configurées — notifications push désactivées.');
}

const PUSH_TTL_SECONDS = 15 * 60;
const MINIMAL_PAYLOAD = {
  title: 'Sentys',
  body: 'Nouvelle alerte — ouvrez l\'application pour le détail.',
};

export async function sendPushNotification(subscription, payload) {
  if (!VAPID_READY) return;
  // le contenu est chiffré de bout en bout (RFC 8291) ; le service push ne voit que l'émetteur et l'heure
  return webpush.sendNotification(subscription, payload, { TTL: PUSH_TTL_SECONDS, urgency: 'high' });
}

async function isMinimalContentEnabled() {
  try {
    const { rows } = await pool.query('SELECT push_minimal_content FROM app_settings WHERE id = 1');
    return rows[0]?.push_minimal_content !== false;
  } catch {
    return true;
  }
}

/**
 * Construit la charge utile : par défaut minimale (aucun nom de caméra, zone ni type de détection
 * sur l'écran verrouillé). Le détail reste consultable dans l'application, après authentification.
 */
export async function buildPushPayload({ title, body, url = '/' }) {
  const minimal = await isMinimalContentEnabled();
  return JSON.stringify({
    ...(minimal ? MINIMAL_PAYLOAD : { title, body }),
    icon: '/pwa-192.png',
    data: { url },
  });
}

async function deliver(rows, payload) {
  const stale = [];
  const results = await Promise.allSettled(rows.map(row =>
    sendPushNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload)
      .catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) stale.push(row.endpoint);
        throw err;
      })
  ));
  if (stale.length > 0) {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])', [stale])
      .catch(err => console.error('[PUSH CLEANUP]', err.message));
  }
  return {
    sent: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  };
}

// envoi aux seuls abonnements rattachés à un compte existant
export async function broadcastPush({ title, body, url }) {
  if (!VAPID_READY) return { sent: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id`
  );
  return deliver(rows, await buildPushPayload({ title, body, url }));
}

// clé vapid
router.get('/vapid-public-key', (req, res) => {
  if (!VAPID_READY) return res.status(503).json({ error: 'Push notifications non configurées' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// abonnement (consentement : action explicite de l'utilisateur dans les Réglages)
router.post('/subscribe', requireAuth, async (req, res) => {
  const { subscription } = req.body || {};
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth   = subscription?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    return res.status(400).json({ error: 'Subscription invalide' });
  }

  try {
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = $2, auth = $3, user_id = $4`,
      [endpoint, p256dh, auth, req.user.id]
    );
    await logAudit(req.user.username, 'PUSH_SUBSCRIBED', 'Notifications activées sur un appareil', req.ip);
    res.status(201).json({ message: 'Abonnement enregistré' });
  } catch (err) {
    console.error('[PUSH SUBSCRIBE]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// désabonnement (retrait du consentement) : uniquement ses propres abonnements
router.delete('/subscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.user.id]
    );
    if (rowCount > 0) await logAudit(req.user.username, 'PUSH_UNSUBSCRIBED', 'Notifications désactivées sur un appareil', req.ip);
    res.json({ message: 'Désabonnement effectué' });
  } catch (err) {
    console.error('[PUSH UNSUBSCRIBE]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// test : uniquement vers les appareils de l'utilisateur qui le demande
router.post('/test', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Aucun appareil abonné pour ce compte' });
    const payload = await buildPushPayload({
      title: 'Sentys — Test notification',
      body: 'Les notifications push fonctionnent correctement.',
    });
    const { sent, failed } = await deliver(rows, payload);
    res.json({ message: `Notification envoyée à ${sent} appareil(s)`, sent, failed });
  } catch (err) {
    console.error('[PUSH TEST]', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
