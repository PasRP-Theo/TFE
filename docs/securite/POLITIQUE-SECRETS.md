# Politique de gestion des secrets — Sentys

Référentiels : RGPD art. 32, ETSI EN 303 645 §5.4, OWASP ASVS V13/V14, CRA annexe I.

## 1. Inventaire

| Secret | Rôle | Où il vit | Généré automatiquement | Rotation |
|---|---|---|---|---|
| `JWT_SECRET` | signature des sessions (remplacé par une paire ES256 à l'étape « sessions ») | `~/.sentys/secrets.json` ou `.env` | oui | à tout moment (déconnecte tout le monde) |
| `PASSWORD_PEPPER` | poivre HMAC des mots de passe | `~/.sentys/secrets.json` ou `.env` | oui | **non** sans réinitialisation des mots de passe : à sauvegarder |
| `DATA_ENCRYPTION_KEY` | AES-256-GCM des identifiants caméras et secrets MFA | `~/.sentys/secrets.json` ou `.env` | oui | `npm run rotate-data-key` |
| `URL_SIGNING_KEY` | signature des URLs vidéo (10–30 min) | mémoire (aléatoire au démarrage) ou `.env` | oui, éphémère | à chaque redémarrage |
| Jeton interne IA | webhook du détecteur | mémoire | oui, éphémère | à chaque redémarrage |
| Jetons d'appareils `sdt_…` | Pi / ESP32 → serveur | haché en base, en clair uniquement dans `device.conf` de l'appareil | par l'admin | Réglages → Appareils → Régénérer |
| `DB_PASSWORD` (`sentys_app`, `sentys_ai`) | accès PostgreSQL | `.env` | non | `ALTER ROLE … PASSWORD` puis `.env` |
| `VAPID_PRIVATE_KEY` | notifications push | `.env` | non | régénérer = réabonnement des navigateurs |
| Identifiants RTSP | accès caméras | chiffrés en base (AES-256-GCM) | non | changer dans la caméra puis dans l'interface |
| Clé privée de signature de l'agent Pi | intégrité des mises à jour | **hors serveur** (poste de l'administrateur) | non | voir `pi/README-signature` |
| Secrets GitHub Actions | CI/CD | GitHub → Settings → Secrets | non | à chaque départ d'un contributeur |

## 2. Règles

1. **Aucun secret dans Git.** `.env`, `.env.*` (sauf `.env.example`), `secrets.json` et les clés `*.pem` sont ignorés. Le scan `gitleaks` en CI bloque toute fuite ; le *push protection* GitHub est activé.
2. **Pas de valeur par défaut.** Le serveur refuse de démarrer avec une valeur connue (`demo_TFE`, `admin`, `changeme`…) ou trop courte (< 32 octets).
3. **Génération** : `openssl rand -base64 48` ou laisser le serveur générer.
4. **Stockage** : `~/.sentys/` en `700`, `secrets.json` et `.env` en `600`, propriétaire = utilisateur du service. Le runner CI n'y a pas accès.
5. **Transmission** : jamais par mail ni chat. Un jeton d'appareil est affiché une seule fois puis copié directement dans `device.conf`.
6. **Journaux** : aucun secret, jeton ni URL avec identifiants (masquage automatique).
7. **Sauvegarde** : `~/.sentys/secrets.json` et `.env` sont inclus dans la sauvegarde **chiffrée** (voir `docs/securite/GUIDE-RESEAU-ET-HEBERGEMENT.md`). Sans `PASSWORD_PEPPER` ni `DATA_ENCRYPTION_KEY`, les comptes et identifiants caméras sont irrécupérables.
8. **Compromission suspectée** : rotation immédiate de tous les secrets concernés, révocation des jetons d'appareils, puis procédure `PROCEDURE-VIOLATION.md`.

## 3. Migration depuis l'ancienne configuration

L'ancien README publiait `JWT_SECRET=demo_TFE` et `DB_PASSWORD=admin`. Si ces valeurs sont en production :

```bash
# 1. retirer JWT_SECRET du .env (il sera généré) — tous les utilisateurs devront se reconnecter
sed -i '/^JWT_SECRET=/d' server/.env
# 2. créer les rôles dédiés et changer le mot de passe
sudo -u postgres psql -v app_password="'$(openssl rand -base64 32)'" -v ai_password="'$(openssl rand -base64 32)'" -f server/sql/roles.sql
# 3. mettre DB_USER=sentys_app et le nouveau DB_PASSWORD dans server/.env
# 4. changer le mot de passe de l'utilisateur postgres
sudo -u postgres psql -c "ALTER ROLE postgres PASSWORD '$(openssl rand -base64 32)'"
pm2 restart sentys
```
