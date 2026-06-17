# Sentys — Système de surveillance résidentiel résilient

![Deploy](https://github.com/PasRP-Theo/TFE/actions/workflows/deploy.yml/badge.svg)

Système de vidéosurveillance complet avec streaming live, détection de mouvement, support Raspberry Pi Zero 2W avec mode hors ligne, et interface web PWA.

---

## Lancer en local

### Prérequis

- [Node.js 20+](https://nodejs.org)
- [PostgreSQL 16+](https://www.postgresql.org/download/)
- [FFmpeg](https://ffmpeg.org/download.html) — ajouté au PATH
- [go2rtc](https://github.com/AlexxIT/go2rtc/releases) — binaire `go2rtc` dans le PATH ou dans `server/`

### 1. Cloner le dépôt

```bash
git clone https://github.com/PasRP-Theo/TFE.git
cd TFE
```

### 2. Créer la base de données PostgreSQL

```sql
CREATE DATABASE sentys;
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

> Crée un compte admin dans **Paramètres → Utilisateurs**, le compte `root` se supprime automatiquement.

---

## Ports utilisés

| Service | Port |
|---|---|
| Dashboard + API | 4000 |
| go2rtc WebRTC | 8889 |
| go2rtc API | 1984 |
| PostgreSQL | 5432 |
| MediaMTX (Pi) | 8554 |

---

## Nœuds caméra (Raspberry Pi Zero 2W)

Édite `pi/setup_picam3.sh` et change :

```bash
DEVICE_ID="pi-salon"                    # nom unique du Pi
SERVER_URL="http://192.168.x.x:4000"   # IP de ton PC serveur
```

Puis lance sur le Pi en SSH :

```bash
bash setup_picam3.sh
```
