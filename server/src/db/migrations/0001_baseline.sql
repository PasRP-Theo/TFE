-- Sentys — schéma de base (0001)
-- Consolide tout ce que initDB() et server.js créaient à chaque démarrage avant
-- l'introduction des migrations. Chaque instruction est idempotente : ce fichier
-- s'applique aussi bien sur une base vide que sur une installation existante.
-- Ne plus modifier ce fichier : toute évolution du schéma = nouvelle migration.

-- ── Tables principales ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(255) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  DEFAULT 'user',
  created_at TIMESTAMP    DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='users' and column_name='email') THEN
    ALTER TABLE users RENAME COLUMN email TO username;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_settings (
  id                      SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_name                VARCHAR(120) NOT NULL DEFAULT 'SENTYS',
  app_subtitle            VARCHAR(180) NOT NULL DEFAULT 'Système de surveillance',
  system_version          VARCHAR(40)  NOT NULL DEFAULT 'v2.4.1',
  login_message           VARCHAR(240) NOT NULL DEFAULT 'Connexion sécurisée au système',
  interface_language      VARCHAR(10)  NOT NULL DEFAULT 'fr-FR',
  time_format             VARCHAR(8)   NOT NULL DEFAULT '24h',
  show_system_version     BOOLEAN      NOT NULL DEFAULT false,
  ui_density              VARCHAR(16)  NOT NULL DEFAULT 'standard',
  camera_card_size        VARCHAR(16)  NOT NULL DEFAULT 'standard',
  show_status_panel       BOOLEAN      NOT NULL DEFAULT true,
  camera_autostart_enabled BOOLEAN     NOT NULL DEFAULT true,
  camera_refresh_seconds  INTEGER      NOT NULL DEFAULT 3,
  show_offline_cameras    BOOLEAN      NOT NULL DEFAULT true,
  default_camera_add_mode VARCHAR(16)  NOT NULL DEFAULT 'node',
  camera_discovery_interval_seconds INTEGER NOT NULL DEFAULT 5,
  alerts_realtime_enabled BOOLEAN      NOT NULL DEFAULT true,
  alerts_daily_summary_enabled BOOLEAN NOT NULL DEFAULT false,
  alerts_sound_enabled    BOOLEAN      NOT NULL DEFAULT true,
  alerts_disconnect_enabled BOOLEAN    NOT NULL DEFAULT true,
  bootstrap_admin_user_id INTEGER,
  default_admin_active    BOOLEAN      NOT NULL DEFAULT false,
  kiosk_pin               VARCHAR(10)  NOT NULL DEFAULT '1234',
  updated_at              TIMESTAMP    NOT NULL DEFAULT NOW()
);

/* Intégration capteurs désactivée à la demande.
CREATE TABLE IF NOT EXISTS sensors (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  type       VARCHAR(50)  NOT NULL,
  location   VARCHAR(100),
  mqtt_topic VARCHAR(200) UNIQUE,
  unit       VARCHAR(20),
  alert_at   FLOAT,
  active     BOOLEAN     DEFAULT true,
  created_at TIMESTAMP   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id          SERIAL PRIMARY KEY,
  sensor_id   INT REFERENCES sensors(id) ON DELETE CASCADE,
  value       FLOAT       NOT NULL,
  status      VARCHAR(20) DEFAULT 'OK',
  recorded_at TIMESTAMP   DEFAULT NOW()
);
*/

CREATE TABLE IF NOT EXISTS cameras (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  rtsp_url   VARCHAR(500) NOT NULL,
  location   VARCHAR(100) DEFAULT '',
  active     BOOLEAN      DEFAULT true,
  created_at TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS camera_discoveries (
  id            SERIAL PRIMARY KEY,
  device_id     VARCHAR(120) UNIQUE NOT NULL,
  name          VARCHAR(120) NOT NULL,
  host          VARCHAR(120) NOT NULL,
  stream_url    VARCHAR(500) NOT NULL,
  location      VARCHAR(120) DEFAULT '',
  model         VARCHAR(120) DEFAULT '',
  source        VARCHAR(30)  DEFAULT 'announce',
  last_seen_at  TIMESTAMP    DEFAULT NOW(),
  created_at    TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS camera_nodes (
  id              SERIAL PRIMARY KEY,
  device_id       VARCHAR(120) UNIQUE NOT NULL,
  name            VARCHAR(120) NOT NULL,
  host            VARCHAR(120) NOT NULL,
  stream_url      VARCHAR(500) NOT NULL,
  location        VARCHAR(120) DEFAULT '',
  model           VARCHAR(120) DEFAULT '',
  source          VARCHAR(30)  DEFAULT 'pi-node',
  motion_detected BOOLEAN      DEFAULT false,
  last_motion_at  TIMESTAMP,
  last_seen_at    TIMESTAMP    DEFAULT NOW(),
  created_at      TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS camera_node_motion_events (
  id          SERIAL PRIMARY KEY,
  device_id   VARCHAR(120) NOT NULL,
  motion      BOOLEAN      DEFAULT true,
  detected_at TIMESTAMP    DEFAULT NOW(),
  created_at  TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id               SERIAL PRIMARY KEY,
  source_type      VARCHAR(40)  NOT NULL,
  source_id        VARCHAR(120),
  camera_id        INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
  alert_type       VARCHAR(60)  NOT NULL,
  level            VARCHAR(20)  NOT NULL DEFAULT 'info',
  title            VARCHAR(180) NOT NULL,
  message          TEXT         NOT NULL,
  metadata         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key       VARCHAR(160),
  status           VARCHAR(20)  NOT NULL DEFAULT 'new',
  acknowledged_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at  TIMESTAMP,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

/* Intégration capteurs désactivée à la demande.
CREATE INDEX IF NOT EXISTS idx_readings_sensor
  ON sensor_readings(sensor_id, recorded_at DESC);
*/

CREATE INDEX IF NOT EXISTS idx_camera_discoveries_last_seen
  ON camera_discoveries(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_camera_nodes_last_seen
  ON camera_nodes(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_camera_nodes_host
  ON camera_nodes(host);

CREATE INDEX IF NOT EXISTS idx_camera_node_motion_events_device_time
  ON camera_node_motion_events(device_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at
  ON alerts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_status_level
  ON alerts(status, level);

CREATE INDEX IF NOT EXISTS idx_alerts_type_source
  ON alerts(alert_type, source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_alerts_dedupe_key
  ON alerts(dedupe_key);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  endpoint   TEXT UNIQUE NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopping_items (
  id         SERIAL PRIMARY KEY,
  text       VARCHAR(255) NOT NULL,
  checked    BOOLEAN      NOT NULL DEFAULT FALSE,
  position   INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS home_notes (
  id         SERIAL PRIMARY KEY,
  text       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Colonnes ajoutées au fil des versions, contraintes CHECK ──────────────
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS login_message VARCHAR(240) NOT NULL DEFAULT 'Connexion sécurisée au système';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS interface_language VARCHAR(10) NOT NULL DEFAULT 'fr-FR';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS time_format VARCHAR(8) NOT NULL DEFAULT '24h';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS show_system_version BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ui_density VARCHAR(16) NOT NULL DEFAULT 'standard';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS camera_card_size VARCHAR(16) NOT NULL DEFAULT 'standard';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS show_status_panel BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS camera_autostart_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS camera_refresh_seconds INTEGER NOT NULL DEFAULT 3;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS show_offline_cameras BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_camera_add_mode VARCHAR(16) NOT NULL DEFAULT 'discover';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS camera_discovery_interval_seconds INTEGER NOT NULL DEFAULT 5;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS alerts_realtime_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS alerts_daily_summary_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS alerts_sound_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS alerts_disconnect_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS kiosk_pin VARCHAR(10) NOT NULL DEFAULT '1234';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS surveillance_mode BOOLEAN NOT NULL DEFAULT true;
UPDATE app_settings SET show_system_version = false WHERE id = 1;
ALTER TABLE camera_node_motion_events ADD COLUMN IF NOT EXISTS offline_recording BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE camera_node_motion_events ADD COLUMN IF NOT EXISTS recording_path VARCHAR(255);
ALTER TABLE camera_nodes ADD COLUMN IF NOT EXISTS cfg_clip_duration    INTEGER NOT NULL DEFAULT 30;
ALTER TABLE camera_nodes ADD COLUMN IF NOT EXISTS cfg_max_storage_mb   INTEGER NOT NULL DEFAULT 500;
ALTER TABLE camera_nodes ADD COLUMN IF NOT EXISTS cfg_announce_interval INTEGER NOT NULL DEFAULT 30;
ALTER TABLE camera_nodes ADD COLUMN IF NOT EXISTS cfg_rtsp_port         INTEGER NOT NULL DEFAULT 8554;
ALTER TABLE camera_nodes ADD COLUMN IF NOT EXISTS cfg_rtsp_path         VARCHAR(60) NOT NULL DEFAULT 'cam1';

-- Contraintes CHECK sur les colonnes source (DROP+CREATE pour mise à jour)
DO $$ BEGIN
  ALTER TABLE camera_discoveries DROP CONSTRAINT IF EXISTS chk_discoveries_source;
  ALTER TABLE camera_discoveries ADD CONSTRAINT chk_discoveries_source
    CHECK (source IN ('announce', 'mdns', 'manual', 'pi-node', 'probe'));
END $$;

DO $$ BEGIN
  ALTER TABLE camera_nodes DROP CONSTRAINT IF EXISTS chk_nodes_source;
  ALTER TABLE camera_nodes ADD CONSTRAINT chk_nodes_source
    CHECK (source IN ('pi-node', 'announce', 'manual', 'mediamtx', 'ia_detector'));
END $$;

-- Contrainte CHECK format PIN (chiffres uniquement, 4-8 caractères)
DO $$ BEGIN
  ALTER TABLE app_settings ADD CONSTRAINT chk_kiosk_pin
    CHECK (kiosk_pin ~ '^[0-9]{4,8}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Index ─────────────────────────────────────────────────────────────────
-- Index manquants sur alerts
CREATE INDEX IF NOT EXISTS idx_alerts_camera_id
  ON alerts(camera_id) WHERE camera_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_source_id
  ON alerts(source_id) WHERE source_id IS NOT NULL;

-- Index unique partiel sur dedupe_key (ignore les NULLs) — remplacé par 0003
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedupe_key_unique
  ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── Réglages : ligne unique ───────────────────────────────────────────────
INSERT INTO app_settings (id, app_name, app_subtitle, system_version)
       VALUES (1, 'SENTYS', 'Système de surveillance', 'v2.4.1')
       ON CONFLICT (id) DO NOTHING;

-- mode d'ajout par défaut (appliqué une seule fois, plus à chaque démarrage)
UPDATE app_settings SET default_camera_add_mode = 'discover' WHERE id = 1;

-- ── C4 : aucun identifiant de caméra dans les découvertes ─────────────────
UPDATE camera_discoveries
       SET stream_url = regexp_replace(stream_url, '//[^/@[:space:]]+@', '//')
       WHERE stream_url ~ '//[^/@[:space:]]+@';

-- ── C7 : jetons d'appareils (Pi, ESP32), stockés hachés, révocables ───────
CREATE TABLE IF NOT EXISTS device_tokens (
  id           SERIAL PRIMARY KEY,
  device_id    VARCHAR(120) UNIQUE NOT NULL,
  token_hash   CHAR(64)     UNIQUE NOT NULL,
  label        VARCHAR(120) NOT NULL DEFAULT '',
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  revoked_at   TIMESTAMP
);

-- ── E3/E4 : verrouillage progressif par compte ────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;

-- ── E2 : sessions — révocation globale et jetons de rafraîchissement rotatifs ───
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id         UUID         NOT NULL,
  token_hash        CHAR(64)     UNIQUE NOT NULL,
  family_started_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMP    NOT NULL,
  revoked_at        TIMESTAMP,
  user_agent        VARCHAR(255),
  ip_address        VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ── E3 : MFA TOTP (secret chiffré) et codes de récupération hachés ────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT;

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  CHAR(64)  NOT NULL,
  used_at    TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON mfa_recovery_codes(user_id);

-- ── E8 : abonnements push rattachés au compte ─────────────────────────────
DELETE FROM push_subscriptions WHERE user_id IS NULL;
ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey;
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS push_minimal_content BOOLEAN NOT NULL DEFAULT true;

-- ── M6 : PIN d'armement haché ─────────────────────────────────────────────
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS pin_hash CHAR(64);
ALTER TABLE app_settings ALTER COLUMN kiosk_pin DROP NOT NULL;
ALTER TABLE app_settings ALTER COLUMN kiosk_pin DROP DEFAULT;

-- ── M2b : identifiants RTSP chiffrés (données migrées par 0002) ──────────
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS credentials_enc TEXT;

-- ── Journal d'audit (auparavant créé dans server.js) ─────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255),
  action VARCHAR(255) NOT NULL,
  details TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE audit_logs ALTER COLUMN details TYPE TEXT USING details::text;
CREATE INDEX IF NOT EXISTS idx_audit_logs_username_created ON audit_logs(username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at DESC);
