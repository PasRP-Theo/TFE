# Sentys — Système de surveillance résidentiel résilient

![Deploy](https://github.com/PasRP-Theo/TFE/actions/workflows/deploy.yml/badge.svg)

Système de vidéosurveillance complet avec streaming live, détection de mouvement, support Raspberry Pi Zero 2W avec mode hors ligne, et interface web PWA.

---

## Lancer en local

### Prérequis

**Node.js 20+**

```bash
# Windows — télécharger l'installeur sur https://nodejs.org
# Vérifier :
node -v
```

**PostgreSQL 16+**

```bash
# Windows — télécharger sur https://www.postgresql.org/download/windows/
# Vérifier :
psql --version
```

**FFmpeg**

```bash
# Windows :
winget install ffmpeg
# ou télécharger sur https://ffmpeg.org/download.html et ajouter au PATH
# Vérifier :
ffmpeg -version
```

**go2rtc**

```bash
# Télécharger go2rtc_windows_amd64.exe sur https://github.com/AlexxIT/go2rtc/releases
# Renommer en go2rtc.exe et placer dans server/ ou dans un dossier du PATH
# Vérifier :
go2rtc --version
```

### 1. Cloner le dépôt

```bash
git clone https://github.com/PasRP-Theo/TFE.git
cd TFE
```

### 2. Créer la base de données PostgreSQL

Rôles dédiés au moindre privilège (pas de superutilisateur `postgres` pour l'application) :

```bash
sudo -u postgres psql -v app_password="'$(openssl rand -base64 32)'" -v ai_password="'$(openssl rand -base64 32)'" -f server/sql/roles.sql
```

Le schéma est créé et tenu à jour par des **migrations versionnées**
(`server/src/db/migrations/`), appliquées automatiquement à chaque démarrage du serveur.
Chaque migration ne s'exécute qu'une fois, dans une transaction ; modifier une migration
déjà appliquée est refusé (empreinte SHA-256). Toute évolution du schéma = un nouveau fichier
`NNNN_description.sql` (ou `.js` pour une migration de données).

```bash
cd server
npm run migrate              # appliquer sans démarrer le serveur
npm run migrate -- --status  # état de chaque migration
```

### 3. Créer `server/.env`

```bash
cp server/.env.example server/.env
# puis renseigner DB_USER / DB_PASSWORD (rôle dédié : server/sql/roles.sql)
```

Les secrets (`JWT_SECRET`, etc.) sont générés au premier démarrage dans `~/.sentys/secrets.json`.
Aucune valeur par défaut n'est acceptée : voir [docs/securite/POLITIQUE-SECRETS.md](docs/securite/POLITIQUE-SECRETS.md).

Au premier démarrage, aucun compte n'existe : la console affiche un **jeton d'installation**
à saisir sur la page de connexion pour créer l'administrateur.

### 4. Installer les dépendances

```bash
cd server && npm install
cd ../client && npm install
```

### 5. Builder le client

```bash
cd client
npm run build
```

### 6. Démarrer le serveur

```bash
cd server
npm start
```

Ouvre [http://localhost:4000](http://localhost:4000) et crée l'administrateur avec le jeton
d'installation affiché dans la console (il n'existe aucun compte par défaut).

## Tests

```bash
cd server && npm test   # unitaires + intégration sur une vraie base PostgreSQL
cd client && npm test
```

Les tests d'intégration (`*.int.test.js`) exécutent réellement le SQL : en local sur
[PGlite](https://pglite.dev) (PostgreSQL en mémoire, rien à installer), et dans la CI sur un
serveur PostgreSQL 16 (`TEST_DATABASE_URL`). Voir `server/test/db.js`.

## Alertes : un moteur unique

Toute détection (mouvement d'un Pi ou du détecteur IA, caméra ou Pi hors ligne, démarrage
d'un flux…) passe par `raiseAlert()` (`server/src/alerts/engine.js`). Ce que déclenche
chaque type d'alerte est décrit à un seul endroit, `server/src/alerts/rules.js` :

| Règle | Rôle |
|---|---|
| `requiresArmed` | ignorée quand la surveillance est désarmée (PIN) |
| `setting` | réglage qui active ou coupe ce type d'alerte (ex. « Alerter si une caméra se déconnecte ») |
| `cooldownSeconds` | une seule alerte par sujet (caméra, Pi) pendant ce délai |
| `push` | notification sur les téléphones abonnés |

Le moteur crée l'alerte puis prévient l'interface en temps réel (si « Alertes en temps réel »
est activé) et envoie la notification push. Une coupure de caméra ou de Pi n'est signalée
qu'une fois par coupure (`server/src/alerts/offlineMonitor.js`).

Crée un compte admin dans **Paramètres → Utilisateurs**.
