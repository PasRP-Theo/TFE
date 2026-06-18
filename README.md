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

```sql
CREATE DATABASE DEMOTFE;
```

Les tables sont créées automatiquement au premier démarrage.

### 3. Créer `server/.env`

```env
PORT=4000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=DEMOTFE
DB_USER=postgres
DB_PASSWORD=admin
JWT_SECRET=demo_TFE
HLS_DIR=../hls
RECORDINGS_DIR=../recordings
GO2RTC_BIN=go2rtc
```

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
