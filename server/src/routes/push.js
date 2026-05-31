import { Router } from 'express';
import webpush from 'web-push';
import { pool } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

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

// clé vapid
router.get('/vapid-public-key', (req, res) => {
  if (!VAPID_READY) return res.status(503).json({ error: 'Push notifications non configurées' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// abonnement
router.post('/subscribe', requireAuth, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Subscription invalide' });
  }

  const { endpoint, keys } = subscription;
  const p256dh = keys?.p256dh;
  const auth   = keys?.auth;
  const userId = req.user?.id ?? null;

  try {
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = $2, auth = $3, user_id = $4`,
      [endpoint, p256dh, auth, userId]
    );
    res.status(201).json({ message: 'Abonnement enregistré' });
  } catch (err) {
    console.error('[PUSH SUBSCRIBE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// désabonnement
router.delete('/subscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant' });
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    res.json({ message: 'Désabonnement effectué' });
  } catch (err) {
    console.error('[PUSH UNSUBSCRIBE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// test push
router.post('/test', requireAuth, async (req, res) => {
  const payload = JSON.stringify({
    title: 'Sentys — Test notification',
    body:  'Les notifications push fonctionnent correctement.',
    icon:  '/pwa-192.png',
    data:  { url: '/' },
  });

  try {
    const { rows } = await pool.query('SELECT * FROM push_subscriptions');
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Aucun abonné enregistré' });
    }

    const results = await Promise.allSettled(
      rows.map(row =>
        sendPushNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload
        ).catch(async err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]);
          }
          throw err;
        })
      )
    );

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    res.json({ message: `Notification envoyée à ${sent} abonné(s)`, sent, failed });
  } catch (err) {
    console.error('[PUSH TEST]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export async function sendPushNotification(subscription, payload) {
  if (!VAPID_READY) return;
  return webpush.sendNotification(subscription, payload);
}

export default router;
