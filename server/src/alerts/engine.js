import { pool } from '../db/index.js';
import { broadcastPush } from '../routes/push.js';
import { createAlert } from './service.js';
import { ALERT_RULES } from './rules.js';

// Moteur d'alertes : toute détection (Pi, IA, caméra hors ligne…) passe par raiseAlert().
// Il applique la règle du type d'événement (rules.js), crée l'alerte puis prévient
// l'interface (temps réel) et les téléphones (push). Les routes ne décident plus de rien.

let realtime = null;

/** canal temps réel (Socket.IO) : l'interface recharge ses alertes sur « new_alert » */
export function setAlertRealtimeChannel(io) {
  realtime = io;
}

async function getAlertSettings() {
  const { rows } = await pool.query(
    `SELECT surveillance_mode, alerts_disconnect_enabled, alerts_realtime_enabled
     FROM app_settings WHERE id = 1`
  );
  return rows[0] || { surveillance_mode: true, alerts_disconnect_enabled: true, alerts_realtime_enabled: true };
}

/**
 * @param {object} event
 * @param {string} event.type        clé de ALERT_RULES (motion_detected, camera_offline…)
 * @param {string} event.subject     ce qui est surveillé, pour l'anti-doublon (« cam:3 », « node:pi-salon »)
 * @param {string} event.sourceType  @param {string|null} [event.sourceId]  @param {number|null} [event.cameraId]
 * @param {string} event.title       @param {string} event.message
 * @param {string} [event.level]     remplace le niveau de la règle
 * @param {string} [event.pushBody]  texte de la notification (sinon le message)
 * @param {object} [event.metadata]
 * @returns {Promise<{ skipped: boolean, reason?: string, alert?: object, alertId?: number }>}
 */
export async function raiseAlert(event) {
  const rule = ALERT_RULES[event.type];
  if (!rule) throw new Error(`Type d'alerte inconnu : ${event.type}`);

  const settings = await getAlertSettings();
  if (rule.requiresArmed && settings.surveillance_mode === false) return { skipped: true, reason: 'disarmed' };
  if (rule.setting && settings[rule.setting] === false) return { skipped: true, reason: 'disabled' };

  const result = await createAlert({
    sourceType: event.sourceType,
    sourceId: event.sourceId ?? null,
    cameraId: event.cameraId ?? null,
    alertType: event.type,
    level: event.level ?? rule.level,
    title: event.title,
    message: event.message,
    metadata: event.metadata ?? {},
    dedupeKey: event.subject ? `${event.type}:${event.subject}` : null,
    cooldownSeconds: rule.cooldownSeconds,
  });
  if (result.skipped) return result;

  const { alert } = result;
  if (settings.alerts_realtime_enabled !== false) {
    realtime?.emit('new_alert', { id: alert.id, level: alert.level, title: alert.title });
  }
  if (rule.push) {
    broadcastPush({ title: alert.title, body: event.pushBody ?? alert.message, url: rule.url ?? '/alerts' })
      .catch(err => console.error(`[PUSH ${event.type}]`, err.message));
  }
  return result;
}
