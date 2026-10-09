-- Sentys — 0003 : la clé anti-doublon des alertes n'est plus unique
-- dedupe_key se répète d'une alerte à l'autre (« motion:cam:3 ») : l'index unique
-- faisait échouer toute nouvelle alerte après la première, silencieusement.
-- L'anti-doublon repose désormais sur un verrou par clé + délai (alerts/service.js).
DROP INDEX IF EXISTS idx_alerts_dedupe_key_unique;
DROP INDEX IF EXISTS idx_alerts_dedupe_key;
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe_key_created
  ON alerts(dedupe_key, created_at DESC) WHERE dedupe_key IS NOT NULL;
