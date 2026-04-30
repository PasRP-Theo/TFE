import { Router } from 'express';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';
import { JWT_SECRET } from '../config/auth.js';

const router = Router();

export function configureWebPush() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_EMAIL) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    console.log('[PUSH] Notifications VAPID configurées.');
  } else {
    console.warn('[PUSH] Clés VAPID manquantes dans .env. Les notifications push seront désactivées.');
  }
}

export async function sendPushToAll(title, body, icon = '/pwa-192.png', data = {}) {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  try {
    const { rows: subscriptions } = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
    const payload = JSON.stringify({ title, body, icon, data });

    const promises = subscriptions.map(sub => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      return webpush.sendNotification(subscription, payload).catch(err => {
        if (err.statusCode === 410) {
          // Gone, subscription expired or removed
          console.log(`[PUSH] Abonnement expiré, suppression: ${sub.endpoint}`);
          return pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
        }
        console.error('[PUSH] Erreur envoi notification:', err.statusCode, err.body);
      });
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('[PUSH] Erreur lors de la récupération des abonnements:', err);
  }
}

router.post('/subscribe', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }

  try {
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
       VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = $2, auth = $3`,
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );
    res.status(201).json({ message: 'Abonnement enregistré' });
  } catch (err) {
    console.error('[PUSH SUBSCRIBE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint manquant' });
  }
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    res.status(200).json({ message: 'Abonnement supprimé' });
  } catch (err) {
    console.error('[PUSH UNSUBSCRIBE]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/test', async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Non authentifié" });
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    await sendPushToAll('🔔 Test Sentys', `Notification de test envoyée par ${decoded.username}.`);
    res.status(200).json({ message: 'Notification de test envoyée' });
  } catch (err) {
    res.status(401).json({ error: "Token invalide ou expiré" });
  }
});

export default router;