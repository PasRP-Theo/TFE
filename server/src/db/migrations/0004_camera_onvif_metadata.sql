-- Sentys — 0004 : caméras multi-marques (assistant ONVIF)
-- transcode : la caméra n'émet pas de H.264 (H.265…) ; le flux est converti pour les navigateurs
-- video_codec / manufacturer / model : relevés à l'ajout (ONVIF + sonde ffmpeg), pour l'affichage
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS transcode    BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS video_codec  VARCHAR(20);
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(80);
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS model        VARCHAR(120);
