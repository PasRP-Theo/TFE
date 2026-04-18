import webPush from 'web-push';
import { pool } from './db/index.js';

let isVapidConfigured = false;

export function configureVapid() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('[PUSH] VAPID keys not configured. Push notifications are disabled.');
    return;
  }
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'https://sentys.example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  isVapidConfigured = true;
  console.log('[PUSH] VAPID configured for push notifications.');
}

export function getVapidPublicKey() {
  if (!isVapidConfigured) return null;
  return process.env.VAPID_PUBLIC_KEY;
}

export async function saveSubscription(userId, subscription) {
  if (!isVapidConfigured) throw new Error('VAPID not configured');
  if (!userId || !subscription || !subscription.endpoint) {
    throw new Error('Invalid subscription payload');
  }

  await pool.query(
    `INSERT INTO push_subscriptions (user_id, subscription_object)
     VALUES ($1, $2)
     ON CONFLICT (user_id, (subscription_object->>'endpoint')) DO NOTHING`,
    [userId, subscription]
  );
}

export async function sendPushNotification(subscription, payload) {
  if (!isVapidConfigured) {
    console.warn('[PUSH] Cannot send notification, VAPID not configured.');
    return;
  }
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error) {
    console.error('[PUSH] Error sending notification:', error.statusCode, error.body);
    if (error.statusCode === 410 || error.statusCode === 404) {
      console.log('[PUSH] Subscription expired or invalid, removing from DB.');
      await pool.query(
        `DELETE FROM push_subscriptions WHERE (subscription_object->>'endpoint') = $1`,
        [subscription.endpoint]
      );
    }
  }
}

export async function sendNotificationToUser(userId, payload) {
    if (!isVapidConfigured) return;
    const { rows } = await pool.query(
        'SELECT subscription_object FROM push_subscriptions WHERE user_id = $1',
        [userId]
    );

    if (rows.length === 0) return;

    const promises = rows.map(row => sendPushNotification(row.subscription_object, payload));
    await Promise.all(promises);
}

export async function sendNotificationToAdmins(payload) {
    if (!isVapidConfigured) return;
    const { rows } = await pool.query(`
        SELECT ps.subscription_object
        FROM push_subscriptions ps
        JOIN users u ON ps.user_id = u.id
        WHERE u.role = 'admin'
    `);

    if (rows.length === 0) {
        console.log(`[PUSH] No subscriptions found for any admin users.`);
        return;
    }

    console.log(`[PUSH] Sending notification to ${rows.length} admin subscriptions.`);
    const promises = rows.map(row => sendPushNotification(row.subscription_object, payload));
    await Promise.all(promises);
}