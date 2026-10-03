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

Les tables sont créées automatiquement au premier démarrage.

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

Ouvre [http://localhost:4000](http://localhost:4000) — login : `root` / `root`

Crée un compte admin dans **Paramètres → Utilisateurs**.
