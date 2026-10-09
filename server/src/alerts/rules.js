// Règles d'alerte : UN seul endroit décide de ce que chaque type d'événement déclenche.
//   level           niveau par défaut (un événement peut le préciser, ex. personne → critical)
//   requiresArmed   ignoré quand la surveillance est désarmée (PIN)
//   setting         colonne de app_settings qui active / coupe ce type d'alerte
//   cooldownSeconds anti-doublon : une seule alerte par sujet (caméra, Pi…) pendant ce délai
//   push            notification push vers les téléphones abonnés
//   url             page ouverte depuis la notification
export const ALERT_RULES = {
  motion_detected: {
    level: 'warning', requiresArmed: true, cooldownSeconds: 300, push: true, url: '/alerts',
  },
  offline_motion_detected: {
    level: 'warning', requiresArmed: true, cooldownSeconds: 0, push: false,
  },
  offline_recording: {
    level: 'warning', requiresArmed: false, cooldownSeconds: 0, push: false,
  },
  camera_offline: {
    level: 'critical', setting: 'alerts_disconnect_enabled', cooldownSeconds: 1800, push: true, url: '/alerts',
  },
  node_offline: {
    level: 'critical', setting: 'alerts_disconnect_enabled', cooldownSeconds: 1800, push: true, url: '/alerts',
  },
  camera_started: {
    level: 'info', cooldownSeconds: 10, push: false,
  },
  camera_stopped: {
    level: 'info', cooldownSeconds: 10, push: false,
  },
};
