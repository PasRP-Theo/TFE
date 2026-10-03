// Durées de conservation (RGPD art. 5.1.e ; loi caméras du 21/03/2007 : images 1 mois max
// sauf preuve d'une infraction, d'un dommage ou identification d'un auteur).
// Documentées dans docs/conformite/REGISTRE-TRAITEMENTS.md — toute modification doit y être reportée.

export const RECORDINGS_MAX_DAYS = 30;

function readDays(name, fallback, { max = Infinity } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  if (value > max) {
    console.warn(`[RETENTION] ${name}=${value} dépasse le maximum autorisé (${max} j) : ${max} j appliqués.`);
    return max;
  }
  return Math.floor(value);
}

export function getRetentionPolicy() {
  return {
    // images : plafonnées à 30 jours (loi caméras) ; les preuves sont exclues de la purge
    recordingsDays: readDays('RECORDINGS_RETENTION_DAYS', 30, { max: RECORDINGS_MAX_DAYS }),
    // métadonnées d'alertes et d'événements de mouvement
    alertsDays: readDays('ALERTS_RETENTION_DAYS', 90),
    motionEventsDays: readDays('MOTION_EVENTS_RETENTION_DAYS', 30),
    // journal d'audit (sécurité, responsabilité art. 5.2) : 1 an
    auditDays: readDays('AUDIT_RETENTION_DAYS', 365),
    // sessions expirées / révoquées conservées pour la détection de réutilisation
    sessionsDays: readDays('SESSIONS_RETENTION_DAYS', 30),
    // annonces réseau (minutes)
    discoveriesMinutes: readDays('CAMERA_DISCOVERY_TTL_MINUTES', 10),
  };
}
