import { Router } from 'express';
import { pool } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { startCamera, stopCamera } from '../camera/manager.js';

const router = Router();

const LANGUAGE_OPTIONS = new Set(['fr-FR', 'en-GB']);
const TIME_FORMAT_OPTIONS = new Set(['24h', '12h']);
const DENSITY_OPTIONS = new Set(['compact', 'standard', 'touch']);
const CAMERA_CARD_SIZE_OPTIONS = new Set(['compact', 'standard', 'large']);
const CAMERA_ADD_MODE_OPTIONS = new Set(['node', 'discover', 'manual']);

function serializeConfig(row) {
  return {
    appName: row.app_name,
    appSubtitle: row.app_subtitle,
    systemVersion: row.system_version,
    loginMessage: row.login_message,
    interfaceLanguage: row.interface_language,
    timeFormat: row.time_format,
    showSystemVersion: row.show_system_version,
    uiDensity: row.ui_density,
    cameraCardSize: row.camera_card_size,
    showStatusPanel: row.show_status_panel,
    cameraAutostartEnabled: row.camera_autostart_enabled,
    cameraRefreshSeconds: row.camera_refresh_seconds,
    showOfflineCameras: row.show_offline_cameras,
    defaultCameraAddMode: row.default_camera_add_mode,
    cameraDiscoveryIntervalSeconds: row.camera_discovery_interval_seconds,
    alertsRealtimeEnabled: row.alerts_realtime_enabled,
    alertsDailySummaryEnabled: row.alerts_daily_summary_enabled,
    alertsSoundEnabled: row.alerts_sound_enabled,
    alertsDisconnectEnabled: row.alerts_disconnect_enabled,
    surveillanceMode: row.surveillance_mode,
    defaultAdminUsername: 'root',
    defaultAdminActive: row.default_admin_active,
    kioskPin: row.kiosk_pin,
  };
}

async function getConfigRow() {
  const { rows } = await pool.query(
    `SELECT app_name, app_subtitle, system_version,
            login_message, interface_language, time_format, show_system_version,
            ui_density, camera_card_size, show_status_panel,
            camera_autostart_enabled, camera_refresh_seconds, show_offline_cameras,
            default_camera_add_mode, camera_discovery_interval_seconds,
            alerts_realtime_enabled, alerts_daily_summary_enabled,
            alerts_sound_enabled, alerts_disconnect_enabled, surveillance_mode,
            default_admin_active, kiosk_pin
     FROM app_settings
     WHERE id = 1`
  );
  return rows[0];
}

function readString(value, { trim = true } = {}) {
  if (typeof value !== 'string') return undefined;
  return trim ? value.trim() : value;
}

function readBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function readInteger(value) {
  return Number.isInteger(value) ? value : undefined;
}

router.get('/', async (_req, res) => {
  try {
    const row = await getConfigRow();
    res.json(serializeConfig(row));
  } catch (err) {
    console.error('[APP CONFIG GET]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/', requireAuth, requireAdmin, async (req, res) => {
  const nextAppName = readString(req.body.appName);
  const nextAppSubtitle = readString(req.body.appSubtitle);
  const nextLoginMessage = readString(req.body.loginMessage);
  const nextInterfaceLanguage = readString(req.body.interfaceLanguage);
  const nextTimeFormat = readString(req.body.timeFormat);
  const nextShowSystemVersion = readBoolean(req.body.showSystemVersion);
  const nextUiDensity = readString(req.body.uiDensity);
  const nextCameraCardSize = readString(req.body.cameraCardSize);
  const nextShowStatusPanel = readBoolean(req.body.showStatusPanel);
  const nextCameraAutostartEnabled = readBoolean(req.body.cameraAutostartEnabled);
  const nextCameraRefreshSeconds = readInteger(req.body.cameraRefreshSeconds);
  const nextShowOfflineCameras = readBoolean(req.body.showOfflineCameras);
  const nextDefaultCameraAddMode = readString(req.body.defaultCameraAddMode);
  const nextCameraDiscoveryIntervalSeconds = readInteger(req.body.cameraDiscoveryIntervalSeconds);
  const nextAlertsRealtimeEnabled = readBoolean(req.body.alertsRealtimeEnabled);
  const nextAlertsDailySummaryEnabled = readBoolean(req.body.alertsDailySummaryEnabled);
  const nextAlertsSoundEnabled = readBoolean(req.body.alertsSoundEnabled);
  const nextAlertsDisconnectEnabled = readBoolean(req.body.alertsDisconnectEnabled);
  const nextSurveillanceMode = readBoolean(req.body.surveillanceMode);
  const nextKioskPin = readString(req.body.kioskPin);

  if (nextAppName !== undefined && !nextAppName) {
    return res.status(400).json({ error: 'Le titre principal ne peut pas être vide' });
  }
  if (nextAppSubtitle !== undefined && !nextAppSubtitle) {
    return res.status(400).json({ error: 'Le sous-titre ne peut pas être vide' });
  }
  if (nextLoginMessage !== undefined && !nextLoginMessage) {
    return res.status(400).json({ error: 'Le message de connexion ne peut pas être vide' });
  }
  if (nextInterfaceLanguage !== undefined && !LANGUAGE_OPTIONS.has(nextInterfaceLanguage)) {
    return res.status(400).json({ error: 'Langue invalide' });
  }
  if (nextTimeFormat !== undefined && !TIME_FORMAT_OPTIONS.has(nextTimeFormat)) {
    return res.status(400).json({ error: 'Format horaire invalide' });
  }
  if (nextUiDensity !== undefined && !DENSITY_OPTIONS.has(nextUiDensity)) {
    return res.status(400).json({ error: 'Densité d’interface invalide' });
  }
  if (nextCameraCardSize !== undefined && !CAMERA_CARD_SIZE_OPTIONS.has(nextCameraCardSize)) {
    return res.status(400).json({ error: 'Taille de carte caméra invalide' });
  }
  if (nextDefaultCameraAddMode !== undefined && !CAMERA_ADD_MODE_OPTIONS.has(nextDefaultCameraAddMode)) {
    return res.status(400).json({ error: 'Mode d’ajout caméra invalide' });
  }
  if (nextCameraRefreshSeconds !== undefined && (nextCameraRefreshSeconds < 2 || nextCameraRefreshSeconds > 15)) {
    return res.status(400).json({ error: 'Le rafraîchissement caméra doit être compris entre 2 et 15 secondes' });
  }
  if (nextCameraDiscoveryIntervalSeconds !== undefined && (nextCameraDiscoveryIntervalSeconds < 3 || nextCameraDiscoveryIntervalSeconds > 30)) {
    return res.status(400).json({ error: 'L’intervalle de découverte doit être compris entre 3 et 30 secondes' });
  }
  if (nextKioskPin !== undefined && !/^\d{4}$/.test(nextKioskPin)) {
    return res.status(400).json({ error: 'Le code PIN doit comporter exactement 4 chiffres' });
  }

  try {
    const current = await getConfigRow();
    const values = {
      appName: nextAppName ?? current.app_name,
      appSubtitle: nextAppSubtitle ?? current.app_subtitle,
      loginMessage: nextLoginMessage ?? current.login_message,
      interfaceLanguage: nextInterfaceLanguage ?? current.interface_language,
      timeFormat: nextTimeFormat ?? current.time_format,
      showSystemVersion: nextShowSystemVersion ?? current.show_system_version,
      uiDensity: nextUiDensity ?? current.ui_density,
      cameraCardSize: nextCameraCardSize ?? current.camera_card_size,
      showStatusPanel: nextShowStatusPanel ?? current.show_status_panel,
      cameraAutostartEnabled: nextCameraAutostartEnabled ?? current.camera_autostart_enabled,
      cameraRefreshSeconds: nextCameraRefreshSeconds ?? current.camera_refresh_seconds,
      showOfflineCameras: nextShowOfflineCameras ?? current.show_offline_cameras,
      defaultCameraAddMode: nextDefaultCameraAddMode ?? current.default_camera_add_mode,
      cameraDiscoveryIntervalSeconds: nextCameraDiscoveryIntervalSeconds ?? current.camera_discovery_interval_seconds,
      alertsRealtimeEnabled: nextAlertsRealtimeEnabled ?? current.alerts_realtime_enabled,
      alertsDailySummaryEnabled: nextAlertsDailySummaryEnabled ?? current.alerts_daily_summary_enabled,
      alertsSoundEnabled: nextAlertsSoundEnabled ?? current.alerts_sound_enabled,
      alertsDisconnectEnabled: nextAlertsDisconnectEnabled ?? current.alerts_disconnect_enabled,
      surveillanceMode: nextSurveillanceMode ?? current.surveillance_mode,
      kioskPin: nextKioskPin ?? current.kiosk_pin,
    };

    const { rows } = await pool.query(
      `UPDATE app_settings
       SET app_name = $1,
           app_subtitle = $2,
           login_message = $3,
           interface_language = $4,
           time_format = $5,
           show_system_version = $6,
           ui_density = $7,
           camera_card_size = $8,
           show_status_panel = $9,
           camera_autostart_enabled = $10,
           camera_refresh_seconds = $11,
           show_offline_cameras = $12,
           default_camera_add_mode = $13,
           camera_discovery_interval_seconds = $14,
           alerts_realtime_enabled = $15,
           alerts_daily_summary_enabled = $16,
           alerts_sound_enabled = $17,
           alerts_disconnect_enabled = $18,
           surveillance_mode = $19,
           kiosk_pin = $20,
           updated_at = NOW()
       WHERE id = 1
       RETURNING app_name, app_subtitle, system_version,
                 login_message, interface_language, time_format, show_system_version,
                 ui_density, camera_card_size, show_status_panel,
                 camera_autostart_enabled, camera_refresh_seconds, show_offline_cameras,
                 default_camera_add_mode, camera_discovery_interval_seconds,
                 alerts_realtime_enabled, alerts_daily_summary_enabled,
                 alerts_sound_enabled, alerts_disconnect_enabled, surveillance_mode,
                 default_admin_active, kiosk_pin`,
      [
        values.appName,
        values.appSubtitle,
        values.loginMessage,
        values.interfaceLanguage,
        values.timeFormat,
        values.showSystemVersion,
        values.uiDensity,
        values.cameraCardSize,
        values.showStatusPanel,
        values.cameraAutostartEnabled,
        values.cameraRefreshSeconds,
        values.showOfflineCameras,
        values.defaultCameraAddMode,
        values.cameraDiscoveryIntervalSeconds,
        values.alertsRealtimeEnabled,
        values.alertsDailySummaryEnabled,
        values.alertsSoundEnabled,
        values.alertsDisconnectEnabled,
        values.surveillanceMode,
        values.kioskPin,
      ]
    );

    if (nextSurveillanceMode !== undefined && nextSurveillanceMode !== current.surveillance_mode) {
      // Exécution en arrière-plan pour ne pas bloquer la réponse HTTP
      setTimeout(async () => {
        try {
          const { rows: cameras } = await pool.query('SELECT * FROM cameras');
          if (nextSurveillanceMode) {
            console.log('[APP CONFIG] Mode surveillance activé -> Démarrage en arrière-plan');
            cameras.forEach(cam => {
              startCamera(cam).catch(err => console.error(`[START CAM ${cam.id}]`, err));
            });
          } else {
            console.log('[APP CONFIG] Mode surveillance désactivé -> Arrêt de toutes les caméras');
            cameras.forEach(cam => {
              try {
                stopCamera(cam.id);
              } catch (err) {
                console.error(`[APP CONFIG] Erreur à l'arrêt de la caméra ${cam.id}:`, err);
              }
            });
          }
        } catch (err) {
          console.error('[APP CONFIG] Erreur lors du changement d\'état des caméras', err);
        }
      }, 0);
    }

    res.json(serializeConfig(rows[0]));
  } catch (err) {
    console.error('[APP CONFIG PATCH]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
