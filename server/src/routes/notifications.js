import { Router } from 'express';
import { getVapidPublicKey, saveSubscription, sendNotificationToUser } from '../lib/push.js';

const router = Router();

// GET /api/notifications/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: 'Push notifications are not configured on the server.' });
  }
  res.json({ publicKey });
});

// POST /api/notifications/subscribe
router.post('/subscribe', async (req, res) => {
  const { subscription } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!subscription) {
    return res.status(400).json({ error: 'Subscription object required' });
  }

  try {
    await saveSubscription(userId, subscription);
    res.status(201).json({ message: 'Subscription saved' });
  } catch (err) {
    console.error('[PUSH SUBSCRIBE]', err);
    res.status(500).json({ error: err.message || 'Failed to save subscription' });
  }
});

// POST /api/notifications/test
router.post('/test', async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const payload = {
            title: 'Test de Notification SENTYS',
            body: 'Si vous recevez ceci, les notifications push fonctionnent !',
            icon: '/icons/icon-192x192.png',
            data: { url: '/alerts' }
        };
        await sendNotificationToUser(userId, payload);
        res.status(200).json({ message: 'Test notification sent' });
    } catch (err) {
        console.error('[PUSH TEST]', err);
        res.status(500).json({ error: err.message || 'Failed to send test notification' });
    }
});

export default router;