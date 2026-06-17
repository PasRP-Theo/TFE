import { Router } from 'express';
import { pool } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';
import { stopAllCameras, startCamera } from '../camera/manager.js';
import rateLimit from 'express-rate-limit';

const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 50 : 8,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
});

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
    defaultAdminUsername: 'root',
    defaultAdminActive: row.default_admin_active,
    kioskPin: row.kiosk_pin,
    surveillanceMode: row.surveillance_mode,
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
            alerts_sound_enabled, alerts_disconnect_enabled,
            default_admin_active, kiosk_pin, surveillance_mode
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

router.get('/', async (req, res) => {
  try {
    const row = await getConfigRow();
    const config = serializeConfig(row);
    let isAdmin = false;
    try {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        const decoded = jwt.verify(header.slice(7), JWT_SECRET);
        isAdmin = decoded?.role === 'admin';
      }
    } catch { /* non authentifié */ }
    if (!isAdmin) delete config.kioskPin;
    res.json(config);
  } catch (err) {
    console.error('[APP CONFIG GET]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/verify-pin', pinLimiter, async (req, res) => {
  const { pin } = req.body;
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN invalide' });
  }
  try {
    const row = await getConfigRow();
    res.json({ valid: pin === row.kiosk_pin });
  } catch (err) {
    console.error('[VERIFY PIN]', err);
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
  const nextKioskPin = readString(req.body.kioskPin);
  const nextSurveillanceMode = readBoolean(req.body.surveillanceMode);

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
      kioskPin: nextKioskPin ?? current.kiosk_pin,
      surveillanceMode: nextSurveillanceMode ?? current.surveillance_mode,
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
           kiosk_pin = $19,
           surveillance_mode = $20,
           updated_at = NOW()
       WHERE id = 1
       RETURNING app_name, app_subtitle, system_version,
                 login_message, interface_language, time_format, show_system_version,
                 ui_density, camera_card_size, show_status_panel,
                 camera_autostart_enabled, camera_refresh_seconds, show_offline_cameras,
                 default_camera_add_mode, camera_discovery_interval_seconds,
                 alerts_realtime_enabled, alerts_daily_summary_enabled,
                 alerts_sound_enabled, alerts_disconnect_enabled,
                 default_admin_active, kiosk_pin, surveillance_mode`,
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
        values.kioskPin,
        values.surveillanceMode,
      ]
    );

    if (nextSurveillanceMode === false) {
      stopAllCameras();
    } else if (nextSurveillanceMode === true) {
      const { rows: cameras } = await pool.query('SELECT * FROM cameras WHERE active = true');
      await Promise.all(cameras.map(cam => startCamera(cam).catch(() => {})));
    }

    res.json(serializeConfig(rows[0]));
  } catch (err) {
    console.error('[APP CONFIG PATCH]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
