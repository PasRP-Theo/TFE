-- ─────────────────────────────────────────────────────────────────────────────
-- Sentys — rôles PostgreSQL au moindre privilège (RGPD art. 32, ASVS V14)
-- À exécuter une fois en superutilisateur :
--   sudo -u postgres psql -v app_password="'…'" -v ai_password="'…'" -f server/sql/roles.sql
-- Mots de passe : openssl rand -base64 32
-- ─────────────────────────────────────────────────────────────────────────────

-- Propriétaire du schéma : sert uniquement aux migrations (au démarrage du serveur)
-- Le serveur Node applique ses migrations au démarrage : sentys_app doit donc
-- posséder les tables. Le superutilisateur postgres n'est plus utilisé.
CREATE ROLE sentys_app LOGIN PASSWORD :app_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20;

-- Détecteur IA en mode autonome : lecture seule de la table cameras
CREATE ROLE sentys_ai LOGIN PASSWORD :ai_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4;

-- Base dédiée, possédée par sentys_app
CREATE DATABASE sentys OWNER sentys_app;
REVOKE ALL ON DATABASE sentys FROM PUBLIC;
GRANT CONNECT ON DATABASE sentys TO sentys_app, sentys_ai;

\connect sentys

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO sentys_app;
GRANT USAGE ON SCHEMA public TO sentys_ai;

-- sentys_ai : SELECT sur cameras uniquement (tables créées plus tard par sentys_app)
ALTER DEFAULT PRIVILEGES FOR ROLE sentys_app IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
-- après le premier démarrage du serveur :
--   GRANT SELECT (id, rtsp_url, active) ON cameras TO sentys_ai;

-- Migration d'une base existante appartenant à postgres :
--   ALTER DATABASE demotfe OWNER TO sentys_app;
--   puis pour chaque table : ALTER TABLE <table> OWNER TO sentys_app;
--   (REASSIGN OWNED BY postgres TO sentys_app; est à proscrire : il touche aussi aux objets système)
