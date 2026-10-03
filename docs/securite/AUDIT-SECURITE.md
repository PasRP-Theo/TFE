# Audit sécurité & conformité — Sentys

| | |
|---|---|
| **Date** | 3 octobre 2026 |
| **Périmètre** | Dépôt `PasRP-Theo/TFE`, branche `feat/hybrid-ip-cameras` (commit `26e6ae7`, après suppression du mode kiosk) |
| **Méthode** | Revue de code et de configuration en lecture seule, `npm audit`, recherche de secrets dans le dépôt et l'historique Git |
| **Hors périmètre (non fourni)** | Configuration nginx, routeur/pare-feu, Tailscale, PostgreSQL (rôles, `pg_hba.conf`), PM2, systemd, firmware des caméras, sauvegardes |
| **Hypothèse de criticité** | Architecture **cible** : frontend sur Vercel, backend exposé sur Internet via un tunnel. Plusieurs points « critiques » ne sont aujourd'hui exploitables que depuis le LAN, mais le deviennent depuis Internet dès l'ouverture du tunnel. |

## État des corrections (mise à jour du 3 octobre 2026, branche `feat/hybrid-ip-cameras`)

Tous les constats de code sont corrigés. Ce qui reste relève de la **configuration de l'installation** (⚙️) ou d'une **confirmation juridique** (⚖️) — voir `docs/conformite/CHECKLIST-CONFORMITE.md`.

| Constat | Statut | Commit(s) |
|---|---|---|
| C1 compte root/root | ✅ corrigé | `5182c87` |
| C2 vidéo sans authentification | ✅ corrigé | `1c6e982` (+ `bca2cb1`) |
| C3 WebRTC sans authentification | ✅ corrigé | `fb42c01` |
| C4 identifiants RTSP exposés | ✅ corrigé | `fb42c01`, `86f316b` |
| C5 go2rtc ouvert | ✅ corrigé | `ed74c6a` |
| C6 listener unique en clair | ✅ code / ⚙️ pare-feu, nginx | `5200ccf` |
| C7 routes des appareils | ✅ corrigé | `5200ccf` |
| E1 secrets faibles, rôle SQL | ✅ code / ⚙️ rotation, rôles | `7016bd9` |
| E2 sessions | ✅ corrigé (option b) | `f62e509` |
| E3 politique de mots de passe, MFA | ✅ corrigé | `315938a`, `7c6e09b` |
| E4 énumération, verrouillage | ✅ corrigé | `315938a` |
| E5 en-têtes | ✅ corrigé | `5b8a3dd` |
| E6 dépendances | ✅ corrigé (0 en production) | `9938d7e` |
| E7 mise à jour de l'agent Pi | ✅ code / ⚙️ générer la clé et signer | `f66a4e2` |
| E8 push | ✅ corrigé | `a1f07a7` |
| E9 journal d'accès, purge de l'audit | ✅ corrigé | `1c6e982`, `511d26a` |
| M1 conservation | ✅ corrigé | `511d26a` |
| M2a chiffrement au repos (disque) | ⚙️ LUKS + sauvegardes | guide §3.4 |
| M2b identifiants caméras chiffrés | ✅ corrigé | `86f316b` |
| M3 CORS | ✅ corrigé | `5b8a3dd` |
| M4 / M5 erreurs et logs | ✅ corrigé | `ed74c6a` |
| M6 PIN | ✅ corrigé | `1797257` |
| M7 CI/CD | ✅ code / ⚙️ runner dédié, réglages GitHub | `9938d7e` |
| M8 données dans le dépôt | ✅ fichiers retirés / ⏳ historique Git | `191d204` |
| M9 droits des personnes | ✅ corrigé | `b35f900` |
| M10 flux en clair sur le LAN | ⚙️ VLAN IoT | guide §2 |
| M11 environnement du détecteur IA | ✅ corrigé | `5200ccf` |
| F1-F8 | ✅ corrigés (F6 : ⚖️ transfert Vercel) | `9938d7e`, `a1f07a7`, `191d204`, `26e6ae7` |
| **Nouveau** — polices chargées depuis Google Fonts (IP transmise à Google) | ✅ corrigé (auto-hébergement) | `5b8a3dd` |
| **Nouveau** — réinitialisation cassée (`TRUNCATE` sur tables référencées) | ✅ corrigé | `5182c87` |
| **Nouveau** — désabonnement push non transmis au serveur | ✅ corrigé | `a1f07a7` |

---

*Rapport initial (constats avant correction) :*

---

## Synthèse

| Criticité | Nombre | Thèmes principaux |
|---|---|---|
| 🔴 Critique | 7 | Compte `root/root`, vidéo accessible sans authentification, identifiants RTSP exposés, go2rtc ouvert, routes des appareils sans authentification |
| 🟠 Élevé | 9 | Secrets faibles, JWT non révocables, politique de mots de passe, en-têtes HTTP, dépendances vulnérables, mise à jour non signée du Pi, push, journal d'accès |
| 🟡 Moyen | 12 | Rétention, chiffrement au repos, CORS, fuites d'erreurs et de logs, PIN, CI/CD, données personnelles dans le dépôt, droits des personnes |
| 🟢 Faible / info | 8 | Code mort, typage CI, contenu des notifications push, Vercel (transferts hors UE) |

**Points positifs constatés**
- Requêtes SQL paramétrées partout ; les fragments dynamiques (`alerts.js`, `users.js`) sont des constantes.
- bcrypt avec un coût de 12.
- Limitation de débit sur le login.
- `JWT_SECRET` obligatoire au démarrage.
- Masquage des URLs RTSP dans l'API (`maskStreamUrl`) et dans les logs ffmpeg (`redactStreamUrl`).
- Purge automatique des enregistrements à 30 jours.
- CORS Express en liste blanche.
- Abonnement push sur action explicite (opt-in) dans les Réglages.
- Protection contre le path traversal à la suppression d'un enregistrement.
- Le mode kiosk (connexion sans mot de passe basée sur l'IP) a déjà été supprimé (`26e6ae7`).

---

## 🔴 Critique

### C1 — Compte administrateur par défaut `root` / `root`
- **Fichiers** : [server/src/db/index.js:278](../../server/src/db/index.js#L278), [server/src/routes/system.js:111](../../server/src/routes/system.js#L111) (la réinitialisation recrée `root/root`).
- **Risque** : prise de contrôle totale par toute personne qui atteint l'interface avant le premier changement, ou après une réinitialisation. Le compte n'est désactivé que si l'on crée un autre admin ou si l'on modifie celui-ci.
- **Référentiels** : ETSI EN 303 645 §5.1-1 (pas de mot de passe universel par défaut) ; RGPD art. 25 et 32 ; OWASP A07.
- **Correction** :
  - supprimer tout mot de passe par défaut ;
  - au premier démarrage, générer un **jeton d'installation à usage unique** (aléatoire, 15 min), affiché uniquement dans la console serveur, qui permet de créer le premier admin ;
  - la réinitialisation ne recrée plus de compte et repasse en mode installation.
- **Vérification** : sur une base vide, `POST /auth/login {"username":"root","password":"root"}` → 401 ; le jeton n'apparaît que dans `pm2 logs`.

### C2 — Flux live et enregistrements servis sans authentification
- **Fichier** : [server/server.js](../../server/server.js) — `app.use('/hls', express.static(...))` et `app.use('/recordings', express.static(...))`.
- **Risque** : quiconque atteint le serveur (le LAN aujourd'hui, Internet demain) peut regarder le live (`/hls/<id>/index.m3u8`, les identifiants étant séquentiels) et télécharger tous les enregistrements. Les noms de fichiers sont devinables (horodatage).
- **Référentiels** : RGPD art. 5.1.f et 32 ; loi caméras du 21/03/2007, art. 9 (accès aux images limité aux personnes autorisées) ; OWASP A01 ; ASVS V4 (contrôle d'accès).
- **Correction** :
  - **Live** : middleware JWT sur `/hls` ; le jeton est transmis par hls.js (`xhrSetup` → en-tête `Authorization`).
  - **Enregistrements** : URL signée HMAC-SHA256 (`?exp=…&sig=…`, durée de vie 5 min), émise par `GET /api/cameras/:id/history`, avec vérification en temps constant (`crypto.timingSafeEqual`).
  - Aucune dépendance supplémentaire.
- **Vérification** : `curl -i https://<api>/hls/1/index.m3u8` → 401 ; une URL d'enregistrement expirée → 403.

### C3 — Négociation WebRTC sans authentification
- **Fichier** : [server/src/routes/webrtc.js](../../server/src/routes/webrtc.js) — `POST /:cameraId`, `POST /:cameraId/register`, `DELETE /:cameraId`.
- **Risque** : n'importe qui obtient le **flux vidéo live** par WebRTC, ou supprime ou recrée des flux go2rtc.
- **Référentiels** : identiques à C2.
- **Correction** : `requireAuth` sur la négociation ; `requireAdmin` sur `register` et `DELETE`.
- **Vérification** : `curl -X POST <api>/api/webrtc/1 --data 'v=0'` → 401.

### C4 — Identifiants RTSP renvoyés en clair par une route publique
- **Fichiers** :
  - [server/src/routes/cameras.js:188](../../server/src/routes/cameras.js#L188) : l'ajout manuel copie l'URL complète, identifiants compris, dans `camera_discoveries.stream_url` ;
  - [server/src/routes/cameras.js:225](../../server/src/routes/cameras.js#L225) : `GET /api/cameras/discoveries` (**sans authentification**) renvoie `stream_url` **non masquée** ;
  - `GET /api/cameras` et `GET /api/cameras/:id/state` sont aussi sans authentification (noms, emplacements, hôtes, état).
- **Risque** : fuite des identifiants des caméras, puis accès direct aux caméras depuis le LAN. Cartographie de la maison (« Chambre », « Entrée »…).
- **Référentiels** : RGPD art. 32 ; ETSI §5.4 (stockage sécurisé des paramètres de sécurité) ; OWASP A01/A02.
- **Correction** :
  - authentification sur ces trois routes ;
  - ne jamais écrire d'identifiants dans `camera_discoveries` ;
  - masquer `stream_url` à la sérialisation ;
  - migration de nettoyage des lignes existantes ;
  - à terme, identifiants chiffrés en AES-256-GCM (point M2b).
- **Vérification** : `curl <api>/api/cameras/discoveries` → 401 ; `SELECT stream_url FROM camera_discoveries WHERE stream_url ~ '//[^/]+:[^/]+@'` → 0 ligne.

### C5 — API go2rtc ouverte sur toutes les interfaces, sans authentification
- **Fichiers** : [server/go2rtc.yaml](../../server/go2rtc.yaml) (`listen: :1984`) ; [server/src/go2rtc/manager.js:93](../../server/src/go2rtc/manager.js#L93) (journalise l'URL RTSP complète).
- **Risque** : depuis le LAN, l'API go2rtc liste les sources avec leurs identifiants, permet d'ajouter des flux et sert sa propre interface de lecture. Selon la version de go2rtc, les sources `exec:` peuvent permettre une **exécution de commandes** sur le serveur. *À vérifier selon la version installée.*
- **Référentiels** : ETSI §5.6 (minimiser les surfaces exposées) ; OWASP A05 ; RGPD art. 32.
- **Correction** :
  - `api.listen: "127.0.0.1:1984"` ;
  - n'ouvrir le port WebRTC (8555) que sur le LAN ou le tailnet ;
  - masquer l'URL dans les logs ;
  - vérifier la version de go2rtc et désactiver les sources `exec`/`echo` si l'option existe.
- **Vérification** : depuis un autre poste du LAN, `curl http://192.168.0.47:1984/api/streams` → connexion refusée.

### C6 — Express écoute en HTTP clair sur `0.0.0.0:4000`
- **Fichier** : [server/server.js](../../server/server.js) (`httpServer.listen(PORT, "0.0.0.0")`).
- **Risque** : nginx (TLS) est contourné, car tout le LAN parle directement à Node en clair, jetons JWT compris. Avec un tunnel pointé sur ce port, **toutes** les routes deviennent publiques, y compris celles des appareils (C7).
- **Référentiels** : RGPD art. 32 ; ASVS V12 (communications) ; ETSI §5.5.
- **Correction** : deux listeners.
  - `127.0.0.1:4000` derrière nginx/tunnel : utilisateurs uniquement, routes des appareils refusées.
  - `<IP LAN ou VLAN IoT>:4100` : routes des appareils uniquement, avec jeton d'appareil (C7).
- **Vérification** : `ss -tlnp | grep node` ; via le tunnel, `curl <api>/api/camera-nodes/announce` → 404.

### C7 — Routes des appareils sans authentification, uploads non bornés
- **Fichiers** :
  - [server/src/routes/cameraNodes.js](../../server/src/routes/cameraNodes.js) : `announce`, `motion`, `:deviceId/upload-recording`, `:deviceId/config`, `wake`, `sleep` ;
  - [server/src/routes/cameras.js](../../server/src/routes/cameras.js) : `announce`, `:id/motion`, `:id/upload-offline`.
- **Risques** :
  - injection de fausses alertes et notifications push (spam, ou masquage d'une vraie intrusion) ;
  - déclenchement d'enregistrements ;
  - nœud malveillant annoncé qu'un admin pourrait « connecter » ;
  - `upload-offline` écrit un flux **sans limite de taille** (saturation du disque) avec un `:id` non validé (`..` → écriture dans le dossier parent), puis lance `ffmpeg` dessus ;
  - `upload-recording` accepte jusqu'à 500 Mo.
- **Référentiels** : ETSI §5.5 et §5.6 ; ASVS V4 et V12 (fichiers) ; OWASP A01/A04 ; RGPD art. 32 (intégrité).
- **Correction** :
  - jeton par appareil (32 octets aléatoires, stocké **haché** en base, délivré lors de l'appairage validé par un admin, révocable), envoyé en `Authorization: Bearer` par l'agent Pi, l'ESP32 et `motion_detector.py` ;
  - `:id` validé comme entier ;
  - limite de taille sur `upload-offline` et quota disque ;
  - ces routes ne sont servies que sur le listener appareils (C6).
- **Vérification** : `curl -X POST <lan>:4100/api/cameras/1/motion` sans jeton → 401 ; un upload de plus de N Mo → 413.

---

## 🟠 Élevé

### E1 — Secrets faibles documentés et rôle SQL superutilisateur
- **Fichier** : [README.md](../../README.md) : `DB_USER=postgres`, `DB_PASSWORD=admin`, `JWT_SECRET=demo_TFE`.
- **Risque** : **si ces valeurs sont celles de la production**, n'importe qui peut forger un JWT admin (HS256 avec un secret connu) et l'utilisateur SQL a tous les droits sur l'instance. *Je ne peux pas savoir quelles valeurs tu utilises en production : à confirmer.*
- **Référentiels** : ETSI §5.4 ; ASVS V13/V14 (configuration, secrets) ; RGPD art. 32 ; OWASP A02/A05.
- **Correction** :
  - le serveur refuse de démarrer si `JWT_SECRET` fait moins de 32 octets ou figure dans une liste de valeurs connues ;
  - générer des secrets avec `openssl rand -base64 48` ;
  - rôle SQL `sentys_app` (DML sur ses tables uniquement, pas de DDL) et rôle séparé pour les migrations ;
  - rôle `sentys_ai` en lecture seule pour `motion_detector.py` ;
  - **rotation immédiate** si les valeurs du README sont utilisées ;
  - `.env.example` avec des emplacements vides.
- **Vérification** : `JWT_SECRET=demo_TFE node server.js` → refus ; `\du` dans psql.

### E2 — Sessions JWT : longue durée, non révocables, stockées en `localStorage`
- **Fichiers** : [server/src/config/auth.js](../../server/src/config/auth.js) (HS256, 1 h), [client/src/hooks/useAuth.tsx](../../client/src/hooks/useAuth.tsx) (`localStorage`), [server/src/middleware/auth.js](../../server/src/middleware/auth.js).
- **Risques** :
  - la déconnexion n'invalide rien côté serveur ;
  - un utilisateur supprimé ou rétrogradé garde ses droits jusqu'à l'expiration (le rôle est lu dans le jeton, pas en base) ;
  - un XSS permettrait de voler le jeton.
- **Référentiels** : ASVS V3/V7 (sessions) ; NIST 800-63B §7 ; OWASP A07.
- **Correction** :
  - jeton d'accès de 15 min, signé en asymétrique (ES256 ou EdDSA via `node:crypto`, sans dépendance) ;
  - refresh token opaque, haché en base, avec rotation et détection de réutilisation ;
  - `token_version` par utilisateur (déconnexion globale, changement de rôle) ;
  - déconnexion qui révoque réellement.
- **⚠️ Décision d'architecture requise (cookies cross-site)** : le cahier des charges demande des cookies `HttpOnly; Secure; SameSite`. Or le frontend (`*.vercel.app`) et l'API (`*.ts.net` avec Funnel) sont **deux sites différents**. Le cookie de l'API serait donc un cookie tiers, bloqué par Safari et Firefox et en voie de restriction dans Chrome. **Tailscale Funnel ne permet pas de domaine personnalisé.** Options :
  - **(a)** Domaine personnalisé commun (`app.exemple.be` sur Vercel, `api.exemple.be`) avec un cookie `SameSite=Lax` sur `api.` → impose un tunnel compatible avec les domaines personnalisés. Cloudflare Tunnel déchiffre le TLS chez Cloudflare ; un reverse proxy sur un VPS en TCP passthrough est possible mais plus lourd.
  - **(b)** Garder Funnel : jeton d'accès **en mémoire** (jamais dans `localStorage`) et refresh token dans un cookie `HttpOnly; Secure; SameSite=None; Partitioned` (CHIPS). Il fonctionne dans Chrome, Edge et Firefox ; sur Safari, la session est perdue à la fermeture de l'onglet (reconnexion requise). *Comportement Safari à valider en test.*
  - **(c)** Servir aussi le frontend depuis le backend (même origine) et n'utiliser Vercel que comme vitrine.
- **Vérification** : après déconnexion, rejouer l'ancien refresh token → 401 ; rétrograder un admin → 403 dans les 15 min au plus.

### E3 — Politique de mots de passe non conforme à NIST 800-63B rév. 4
- **Fichiers** : [server/src/routes/users.js:38](../../server/src/routes/users.js#L38) (8 caractères minimum), [users.js:79](../../server/src/routes/users.js#L79) (**6** caractères à la modification), [server/server.js](../../server/server.js) `/auth/register`.
- **Risques** : mots de passe courts ; aucune vérification contre les mots de passe compromis ; pas de MFA ; bcrypt **tronque silencieusement au-delà de 72 octets** (conflit avec « 64 caractères minimum autorisés » en UTF-8 multi-octets).
- **Référentiels** : NIST 800-63B rév. 4 §3.1.1 ; OWASP ASVS V6 ; OWASP Password Storage Cheat Sheet.
- **Correction** :
  - 15 caractères minimum (8 si MFA active), 128 maximum acceptés, aucune règle de composition, copier-coller autorisé ;
  - pré-hachage HMAC-SHA256 avec un **poivre** (`PASSWORD_PEPPER`, hors base) puis bcrypt(12), ce qui supprime aussi la troncature à 72 octets ;
  - migration transparente des hachages existants à la connexion suivante ;
  - liste hors ligne des mots de passe compromis (top 100k, sans requête externe, cohérent avec « 100 % local ») ; HIBP en k-anonymat en option, car il implique un flux sortant (préfixe SHA-1) ;
  - MFA TOTP (RFC 6238, implémentable avec `node:crypto`) avec 10 codes de récupération hachés.
  - *Argon2id* : Node ≥ 24.7 expose `crypto.argon2` (expérimental) ; sinon il faut une dépendance native. À décider (voir les questions).
- **Vérification** : tests unitaires de la politique ; création avec un mot de passe de 14 caractères → 400 ; mot de passe de 100 caractères accepté.

### E4 — Énumération des comptes par timing et verrouillage insuffisant
- **Fichier** : [server/server.js](../../server/server.js) `/auth/login`.
- **Risques** : `bcrypt.compare` n'est exécuté que si l'utilisateur existe, donc la réponse est mesurablement plus rapide pour un identifiant inconnu. La limitation (8 tentatives / 15 min) est **par IP seulement** : une attaque distribuée sur un compte n'est pas freinée.
- **Référentiels** : ASVS V6 ; NIST 800-63B §3.2.2 (throttling) ; OWASP A07.
- **Correction** : comparaison avec un hachage factice si l'utilisateur est inconnu ; compteur d'échecs par compte avec délai progressif ; message générique (déjà le cas) ; journalisation de chaque échec.
- **Vérification** : mesure de 50 requêtes avec un compte existant et inexistant (écart inférieur à 10 %) ; 10 échecs → délai croissant.

### E5 — Aucun en-tête de sécurité HTTP
- **Fichiers** : [server/server.js](../../server/server.js) ; configuration nginx absente du dépôt (non auditable) ; pas de `vercel.json`.
- **Risque** : pas de CSP (un XSS permet de voler le jeton), pas de HSTS, risque de clickjacking, fuite de `Referer`.
- **Référentiels** : ASVS V3/V14 ; OWASP A05 ; ANSSI/CCB, recommandations TLS.
- **Correction** :
  - **API** (middleware Express, sans dépendance) : `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, `Cache-Control: no-store` sur `/api` et `/recordings`.
  - **Frontend** (`vercel.json`) : CSP stricte (`default-src 'self'; connect-src 'self' https://<api>; media-src blob:; worker-src 'self'; frame-ancestors 'none'`), HSTS, `Permissions-Policy` (caméra, micro et géolocalisation désactivés).
  - Versionner la configuration nginx (TLS 1.2/1.3 uniquement).
- **Vérification** : `curl -sI` ; observatory.mozilla.org sur l'URL Vercel ; `testssl.sh` sur le tunnel.

### E6 — Dépendances vulnérables
- **Serveur** (production) : 11 vulnérabilités, dont 7 élevées.
  - `systeminformation` ≤ 5.31.6 : **injection de commande** dans `networkInterfaces()`, **appelée** dans [system.js](../../server/src/routes/system.js). L'exploitation demande de contrôler le nom d'un profil réseau local : risque réel faible, mais correctif trivial.
  - Autres : `multer`, `ws`, `socket.io-parser`, `engine.io`, `path-to-regexp`, `express-rate-limit`.
- **Client** : 26 vulnérabilités, dont 2 critiques (`vitest`, `@vitest/coverage-v8`, outils de développement uniquement) et `react-router-dom` (élevée, embarqué dans le bundle).
- **Référentiels** : OWASP A06 ; CRA, annexe I (gestion des vulnérabilités, SBOM) ; ETSI §5.3.
- **Correction** : `npm audit fix` puis tests ; `nodemon` passe en devDependency (déjà le cas) ; Dependabot (`.github/dependabot.yml`) ; job CI `npm audit --omit=dev --audit-level=high` ; SBOM CycloneDX via `npm sbom` (intégré à npm, sans dépendance) publié en artefact CI.
- **Vérification** : `npm audit --omit=dev` → 0 élevée ou critique.

### E7 — Mise à jour de l'agent Pi non authentifiée et exécutée avec `sudo`
- **Fichiers** : [pi/auto_update.sh](../../pi/auto_update.sh), [server/server.js](../../server/server.js) `GET /api/agent/sentys_agent.py`.
- **Risque** : l'agent est téléchargé en **HTTP clair** sans signature, puis redémarré avec `sudo`. Une attaque de l'homme du milieu sur le LAN (ARP spoofing) donne une **exécution de code** sur chaque Pi.
- **Référentiels** : ETSI §5.3-2/-7 (mises à jour authentifiées) ; CRA, annexe I §2 ; ENISA, *Baseline Security for IoT*.
- **Correction** : signer l'agent (Ed25519 via `openssl pkeyutl`, clé privée hors serveur, clé publique déposée sur le Pi à l'installation) ; le script vérifie la signature avant d'installer ; service systemd sous un utilisateur dédié avec des droits `sudo` limités aux commandes nécessaires.
- **Vérification** : modifier un octet de l'agent servi → la mise à jour est refusée.

### E8 — Notifications push envoyées à tous les abonnements, jamais rattachées ni nettoyées
- **Fichiers** : [server/src/routes/push.js](../../server/src/routes/push.js), [server/src/camera/manager.js:888](../../server/src/camera/manager.js#L888), schéma `push_subscriptions` (`ON DELETE SET NULL`).
- **Risque** : un **utilisateur supprimé continue de recevoir** les alertes de la maison (abonnement conservé). `POST /test` envoie à tout le monde depuis n'importe quel compte.
- **Référentiels** : RGPD art. 5.1.f et art. 17 ; ePrivacy (le consentement est attaché à la personne).
- **Correction** : `ON DELETE CASCADE` ; envoi uniquement aux abonnements d'utilisateurs actifs ; `/test` limité aux abonnements de l'appelant ; suppression des abonnements à la déconnexion globale.
- **Vérification** : supprimer un utilisateur → `SELECT count(*) FROM push_subscriptions WHERE user_id IS NULL` = 0.

### E9 — Pas de journal des accès aux images, journal d'audit sans purge
- **Fichiers** : [server/server.js](../../server/server.js) (`logAudit`, table `audit_logs`).
- **Risque** : impossible de savoir qui a visionné ou téléchargé quelles images (principe de responsabilité, demande d'accès). `audit_logs` contient des IP sans limite de conservation.
- **Référentiels** : RGPD art. 5.2 et 30 ; loi caméras art. 9 ; ASVS V16 (journalisation).
- **Correction** :
  - événements `VIDEO_LIVE_VIEW`, `RECORDING_VIEW`, `RECORDING_DOWNLOAD`, `RECORDING_DELETE`, `CAMERA_CREATE/UPDATE/DELETE`, `SETTINGS_UPDATE`, `MFA_*`, `TOKEN_REVOKE` ;
  - jamais de mot de passe, de jeton ni d'URL avec identifiants ;
  - purge configurable (`AUDIT_RETENTION_DAYS`, 365 proposé, *durée à justifier dans le registre*) ;
  - rotation des logs PM2 (`pm2-logrotate`, ou `logrotate` système sans dépendance npm).
- **Vérification** : lire un enregistrement → ligne `RECORDING_VIEW` ; `grep -iE "password|Bearer|eyJ" ~/.pm2/logs/*` → vide.

---

## 🟡 Moyen

### M1 — Conservation des données
- Les enregistrements sont purgés à 30 jours ✓ (`RECORDINGS_RETENTION_DAYS`). En revanche :
  - `camera_node_motion_events` et `audit_logs` ne sont **jamais purgés** ;
  - les alertes sont gardées 90 jours, avec des métadonnées (emplacement, hôte).
- **Référentiels** : RGPD art. 5.1.e ; loi caméras (images : 1 mois maximum, sauf preuve d'une infraction, d'un dommage ou identification d'un auteur).
- **Correction** : purges configurables pour toutes les tables, valeurs par défaut documentées dans le registre ; impossible de dépasser 30 jours pour les images sans marquage explicite « conservé comme preuve » (journalisé).

### M2 — Chiffrement au repos
- **a) Enregistrements et base** : pas de chiffrement au repos ; pas de stratégie de sauvegarde. **Recommandation** : chiffrement du disque (LUKS/dm-crypt) sur le serveur. C'est la solution la plus robuste, transparente pour ffmpeg et HLS, sans changement de code. Sauvegardes chiffrées (`pg_dump | age`, ou `gpg`) avec une clé hors serveur. Le chiffrement applicatif des MP4 casserait la lecture progressive (requêtes Range) : non recommandé.
- **b) Identifiants RTSP** : stockés en clair dans `cameras.rtsp_url` (et `camera_discoveries`, voir C4). **Correction** : AES-256-GCM (`node:crypto`), clé `CAMERA_SECRET_KEY` hors base, identifiant de clé stocké avec le chiffré pour permettre une rotation (`npm run rotate-camera-key`).
- **Référentiels** : RGPD art. 32.1.a ; ETSI §5.4.

### M3 — CORS incohérent entre Express, OPTIONS et Socket.IO
- [server/server.js](../../server/server.js) : `app.options("/{*path}", cors())` autorise **toute origine** en préflight ; Socket.IO a `origin: true`. Risque limité, car l'authentification passe par un en-tête et non un cookie, mais à aligner, surtout si des cookies sont introduits (E2).
- **Correction** : une seule config CORS partagée (liste blanche `ALLOWED_ORIGINS`), également pour Socket.IO.

### M4 — Messages d'erreur internes renvoyés au client
- [webrtc.js](../../server/src/routes/webrtc.js) (`res.status(502).json({ error: err.message })`, qui peut contenir la réponse de go2rtc), [cameras.js](../../server/src/routes/cameras.js) `DELETE /archives/:id`.
- **Correction** : messages génériques au client et détail dans les logs. **Référentiel** : ASVS V16.

### M5 — URLs de flux en clair dans les logs
- [go2rtc/manager.js:93](../../server/src/go2rtc/manager.js#L93) journalise l'URL RTSP **avec identifiants** ; [cameras.js:276](../../server/src/routes/cameras.js#L276) journalise les URLs trouvées par le scan.
- **Correction** : `redactStreamUrl` partout ; test unitaire qui vérifie qu'aucun `console.*` ne reçoit d'URL avec `user:pass@`.

### M6 — PIN de surveillance
- [appConfig.js](../../server/src/routes/appConfig.js) : PIN `1234` par défaut, stocké **en clair**, renvoyé aux admins par `GET /api/app-config`, comparé sans temps constant. `verify-pin` est sans authentification (un oracle limité par débit). L'armement exige déjà un JWT admin, donc le PIN n'ajoute presque rien.
- **Correction** : pas de PIN par défaut (défini à l'installation) ; PIN haché ; vérification **dans** la requête d'armement (et non via un oracle séparé) avec `timingSafeEqual`. Ou suppression du PIN si un simple JWT admin suffit (à décider).

### M7 — CI/CD et runner self-hosted
- [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) : le runner tourne **sur l'hôte de production**, probablement sous l'utilisateur de PM2 ; actions référencées par tag et non par SHA ; pas de bloc `permissions:` ; `npm ci` exécute les scripts d'installation sur l'hôte.
- **Correction** :
  - `permissions: contents: read` ;
  - actions épinglées par SHA ;
  - runner sous un utilisateur dédié sans accès à `.env` ni à la base, avec déploiement via un script restreint ;
  - `npm ci --ignore-scripts` (sauf `ffmpeg-static`, à approuver) ;
  - activer *Secret scanning* et *Push protection* (gratuits sur un dépôt public) ;
  - job `gitleaks` (binaire officiel téléchargé en CI, pas de dépendance npm) ;
  - ne jamais déclencher de workflow sur `pull_request` avec un runner self-hosted (c'est le cas aujourd'hui ✓, à conserver).
- **Référentiels** : CRA, annexe I ; OWASP A08 ; CCB, guide de cyber-hygiène.

### M8 — Données personnelles ou d'infrastructure dans le dépôt public *(à vérifier)*
- [home.js:12-13](../../server/src/routes/home.js#L12) : coordonnées par défaut `50.5745, 4.5282`. **Si elles correspondent à ton domicile**, c'est une localisation publiée.
- [system.js](../../server/src/routes/system.js) : la réinitialisation renomme l'application `AUBEPINES`. Si c'est ton nom de rue, cela permet de recouper avec les coordonnées.
- `server/ffmpeg_debug.txt` (IP interne, chemin de flux), fichiers parasites `server/client@0.0.0`, `server/tsc`, bundle versionné dans `server/public/`.
- **Correction** : coordonnées uniquement via `.env` sans valeur par défaut ; supprimer ces fichiers. Pour l'historique Git, une réécriture (`git filter-repo`) est destructive : à décider avec toi, et inutile si les données ne sont pas personnelles.
- **Référentiels** : RGPD art. 5.1.c et 25.

### M9 — Droits des personnes (art. 15-22)
- Pas d'export des données d'un utilisateur, pas de suppression de son propre compte.
- À la suppression d'un compte, le nom reste dans `audit_logs` et les abonnements push sont conservés (E8).
- Pour les **personnes filmées** (tiers), il n'existe pas de procédure de droit d'accès aux images.
- **Correction** :
  - `GET /api/me/export` (JSON : compte, abonnements, actions d'audit) ;
  - `DELETE /api/me` et suppression par un admin avec effacement effectif (cascade) ;
  - pseudonymisation du nom dans `audit_logs` après suppression ;
  - procédure manuelle documentée pour les personnes filmées : délai d'un mois (art. 12.3) et floutage des tiers.

### M10 — Flux en clair sur le LAN
- Pi, ESP32 et `motion_detector.py` communiquent avec le serveur en HTTP clair ; RTSP est en clair.
- **Correction** : isolation VLAN (voir le guide réseau), jetons d'appareils (C7), RTSPS si la caméra le supporte (souvent pas le cas : à documenter comme risque résiduel).
- **Référentiels** : ETSI §5.5 ; RGPD art. 32.

### M11 — Le détecteur IA reçoit tout l'environnement du serveur
- [manager.js:606](../../server/src/camera/manager.js#L606) : `env: { ...process.env, … }` transmet `JWT_SECRET`, `DB_PASSWORD`, `VAPID_PRIVATE_KEY` au processus Python.
- **Correction** : environnement minimal (variables `CAMERA_ID`, `RTSP_URL`, URL du webhook, jeton d'appareil et identifiants SQL en lecture seule).
- **Référentiel** : principe du moindre privilège (ASVS V14, RGPD art. 25).

### M12 — Données de capteurs
- Les tables `sensors` et `sensor_readings` sont **commentées** dans [db/index.js](../../server/src/db/index.js) : aucune donnée de capteur n'est traitée actuellement. Le registre doit le refléter, et le point sera à réauditer quand la fonction sera activée.

---

## 🟢 Faible / informationnel

| ID | Constat | Fichier | Correction |
|---|---|---|---|
| F1 | Code mort à risque : routes d'authentification par session dont `register` est **sans contrôle admin** (non montées, mais dangereuses si elles le deviennent) ; `express-session` inutilisé ; `usePushNotifications.ts` (IP en dur, import cassé) ; `sw-push-handler.ts` inutilisé | [routes/auth.js](../../server/src/routes/auth.js), [usePushNotifications.ts](../../client/src/hooks/usePushNotifications.ts) | Supprimer |
| F2 | `/auth/register` accepte n'importe quelle chaîne comme rôle (admin uniquement) | [server.js](../../server/server.js) | Liste blanche `user`/`admin` |
| F3 | La CI lance `tsc --noEmit` sur un tsconfig à références, donc **ne vérifie aucun fichier** ; 4 erreurs de type existantes | [test.yml](../../.github/workflows/test.yml) | `tsc -b` et corriger les erreurs |
| F4 | Contenu des notifications push : nom de caméra et libellé (« Personne — Entrée »). Le payload est chiffré de bout en bout (RFC 8291) ; le service push (Google, Apple, Mozilla) ne voit que les métadonnées (heure, fréquence) | [manager.js:880](../../server/src/camera/manager.js#L880) | Option « contenu minimal » par défaut : « Nouvelle alerte Sentys », détails dans l'application |
| F5 | `deploy-info.json` public (SHA du commit) | [deploy.yml](../../.github/workflows/deploy.yml) | Servir derrière l'authentification ou retirer |
| F6 | Vercel (Vercel Inc., US) reçoit l'**adresse IP** et l'user-agent des utilisateurs lors du chargement des fichiers statiques : traitement par un sous-traitant et transfert hors UE (couvert par le DPA Vercel et le *Data Privacy Framework*, *à vérifier dans les conditions en vigueur*). Aucune donnée vidéo, d'identifiant ni de capteur n'y transite si aucun `rewrite` vers l'API n'est configuré | — | Mentionner dans la politique de confidentialité ; ne pas activer Vercel Analytics ou Speed Insights ; pas de rewrites vers l'API |
| F7 | `localStorage` (jeton, préférences d'affichage) : stockage strictement nécessaire, **sans consentement requis** (ePrivacy art. 5.3) | client | À mentionner dans les informations ; le jeton sortira de `localStorage` (E2) |
| F8 | Panneau de contrôle Pi 2B : depuis la suppression du kiosk, il faut un vrai compte | — | Compte dédié rôle `user`, sessions courtes, verrouillage de l'écran au niveau de l'OS |

---

## Analyse juridique (Belgique) — points certains et points à confirmer

> Je ne suis pas juriste. Ce qui suit est une grille de lecture à **faire confirmer** par l'APD (autoriteprotectiondonnees.be), la police locale ou ton promoteur.

**Applicabilité du RGPD**
- Une caméra filmant **uniquement** l'intérieur ou ta propriété privée relève en principe de l'**exemption domestique** (art. 2.2.c RGPD).
- La CJUE (*Ryneš*, C-212/13, 2014) a jugé que l'exemption **ne s'applique pas** dès qu'une caméra filme, même partiellement, l'espace public. → **Si une caméra extérieure capte la rue ou le trottoir, le RGPD s'applique** et tu es responsable du traitement.
- Pour Sentys en tant que **produit** (TFE), appliquer le RGPD par défaut est de toute façon la bonne posture (Privacy by Design, art. 25).

**Loi caméras du 21 mars 2007 (modifiée en 2018)**
- Une habitation privée est un « lieu fermé non accessible au public ».
- **Déclaration** à la police via declarationcamera.be : obligatoire pour les caméras de surveillance d'un lieu fermé non accessible au public. *Il existe une exception pour les caméras installées par une personne physique à des fins personnelles et domestiques à l'intérieur de son habitation : à confirmer, ainsi que le cas des caméras extérieures filmant uniquement ta propriété.*
- **Pictogramme** : obligatoire selon le modèle de l'AR du 10/02/2008 (modifié), sauf exceptions pour l'usage strictement domestique intérieur. *À confirmer.*
- **Voie publique** : un particulier ne peut pas diriger une caméra **spécifiquement** vers la voie publique ou un lieu dont il n'est pas responsable (voisins). Si l'angle capte inévitablement une partie de la rue, il faut **minimiser** (orientation, masques de confidentialité). *L'étendue tolérée est à confirmer auprès de la police.*
- **Conservation** : 1 mois maximum, sauf si les images servent à prouver une infraction ou un dommage, ou à identifier un auteur. Le défaut de 30 jours est conforme.
- **Accès** : le responsable et les personnes qu'il autorise ; transmission possible à la police ou à la justice. La personne filmée a un droit d'accès (demande motivée).
- **Son** : l'enregistrement audio n'est pas visé par la loi caméras et pose d'autres problèmes. Sentys utilise `-an` (pas d'audio) ✓ : à conserver.

**AIPD (art. 35)** : probablement **non obligatoire** pour un particulier, l'usage n'étant pas à grande échelle (liste APD des traitements soumis à AIPD). *À confirmer.* Elle reste **recommandée** et utile pour le TFE ; je fournirai une AIPD simplifiée.

**Détection « personne » par IA** : la détection d'objets (YOLO) sans identification n'est **pas** un traitement de données biométriques au sens de l'art. 9. Toute reconnaissance faciale changerait radicalement l'analyse (à ne pas introduire).

**Notification de violation (art. 33-34)** : elle n'est obligatoire que si le RGPD s'applique (voir ci-dessus). La procédure sera fournie quand même.

---

## Plan de correction proposé (un commit par ligne)

| # | Correction | Points couverts |
|---|---|---|
| 1 | Installation sans mot de passe par défaut (jeton à usage unique), la réinitialisation ne recrée pas `root` | C1 |
| 2 | Authentification sur les routes caméras, discoveries, state et WebRTC ; nettoyage des identifiants dans `camera_discoveries` | C3, C4 |
| 3 | HLS authentifié (Bearer) et enregistrements par URL signée, avec journal d'accès vidéo | C2, E9 (partiel) |
| 4 | go2rtc sur 127.0.0.1, logs masqués, erreurs génériques | C5, M4, M5 |
| 5 | Deux listeners (public / appareils) et jetons d'appareils, validation des `:id`, limites d'upload | C6, C7, M11 |
| 6 | Durcissement des secrets au démarrage, `.env.example`, politique de gestion des secrets, rôles SQL | E1 |
| 7 | En-têtes de sécurité (Express et `vercel.json`), CORS unifié | E5, M3 |
| 8 | `npm audit fix`, Dependabot, SBOM, audit et gitleaks en CI, durcissement du workflow | E6, M7, F3 |
| 9 | Politique de mots de passe (15+, poivre et bcrypt, liste compromise), anti-énumération, verrouillage progressif | E3, E4 |
| 10 | Sessions : accès 15 min asymétrique, refresh rotatif révocable, `token_version` (**selon l'option E2 choisie**) | E2 |
| 11 | MFA TOTP et codes de récupération | E3 |
| 12 | Push : rattachement par utilisateur, cascade, contenu minimal | E8, F4 |
| 13 | Rétention configurable pour toutes les tables, purge de l'audit | M1, E9 |
| 14 | Export et suppression de compte (droits RGPD) | M9 |
| 15 | PIN haché (ou supprimé) | M6 |
| 16 | Chiffrement AES-256-GCM des identifiants RTSP et rotation de clé (lié aux caméras IP) | M2b |
| 17 | Signature de l'agent Pi | E7 |
| 18 | Nettoyage : code mort, fichiers parasites, coordonnées par défaut | F1, F2, M8 |
| 19 | Documents : registre art. 30, AIPD, politique de confidentialité, texte du pictogramme, procédure de violation, guide réseau (VLAN, blocage sortant, LUKS, sauvegardes), checklist finale | Livrables |

---

## Décisions attendues

1. **Validation du plan** et de l'ordre ci-dessus.
2. **Sessions (E2)** : option (a) domaine commun, (b) Funnel avec jeton en mémoire et cookie partitionné, ou (c) même origine ?
3. **Hachage** : garder bcrypt(12) avec un poivre (conforme OWASP, aucune nouvelle dépendance) ou passer à Argon2id (`crypto.argon2` si le serveur a Node ≥ 24.7, sinon une dépendance native à justifier) ? Quelle version de Node tourne sur le serveur ?
4. **Secrets du README** : `DB_PASSWORD=admin` et `JWT_SECRET=demo_TFE` sont-ils les valeurs de production ?
5. **Coordonnées météo et « AUBEPINES »** : s'agit-il de ton domicile ou de ta rue ?
6. **PIN** : le garder (haché) ou le supprimer ?
7. **Caméras** : l'une d'elles filme-t-elle la voie publique ou chez des voisins ? Cela conditionne le registre et l'AIPD.
