// Sentys — 0002 : migration des données sensibles héritées (auparavant à chaque démarrage)
// Idempotente : ne touche que ce qui n'a pas encore été migré.
import { hashPin, isValidPinFormat, LEGACY_DEFAULT_PIN } from '../../security/pin.js';
import { splitStreamCredentials, encryptCameraCredentials } from '../../camera/credentials.js';

export async function up(client) {
  // M6 : l'ancien PIN en clair est haché puis effacé (1234 = valeur par défaut, considéré non défini)
  const { rows: pinRows } = await client.query('SELECT kiosk_pin FROM app_settings WHERE id = 1 AND kiosk_pin IS NOT NULL');
  if (pinRows[0]) {
    const legacyPin = pinRows[0].kiosk_pin;
    if (legacyPin !== LEGACY_DEFAULT_PIN && isValidPinFormat(legacyPin)) {
      await client.query('UPDATE app_settings SET pin_hash = $1 WHERE id = 1', [hashPin(legacyPin)]);
    }
    await client.query('UPDATE app_settings SET kiosk_pin = NULL WHERE id = 1');
  }

  // M2b : identifiants RTSP sortis des URLs et chiffrés (AES-256-GCM)
  const { rows: legacyCameras } = await client.query(
    `SELECT id, rtsp_url FROM cameras WHERE rtsp_url ~ '^[a-zA-Z]+://[^/@]+@'`
  );
  for (const camera of legacyCameras) {
    const { cleanUrl, username, password } = splitStreamCredentials(camera.rtsp_url);
    await client.query(
      'UPDATE cameras SET rtsp_url = $2, credentials_enc = $3 WHERE id = $1',
      [camera.id, cleanUrl, encryptCameraCredentials(camera.id, { username, password })]
    );
  }
  if (legacyCameras.length) console.log(`[DB] Identifiants RTSP chiffrés pour ${legacyCameras.length} caméra(s)`);
}
