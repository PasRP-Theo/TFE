# Sentys — Système de surveillance intelligent

![Deploy](https://github.com/PasRP-Theo/TFE/actions/workflows/deploy.yml/badge.svg)

Système de vidéosurveillance complet avec streaming live, détection d'objets par IA (YOLOv8), enregistrement déclenché par mouvement, support Raspberry Pi Zero 2W avec mode hors ligne, et interface web PWA.

---

## Table des matières

1. [Architecture générale](#architecture-générale)
2. [Stack technique](#stack-technique)
3. [Client — React + Vite](#client--react--vite)
4. [Serveur — Node.js + Express](#serveur--nodejs--express)
5. [Base de données — PostgreSQL](#base-de-données--postgresql)
6. [Streaming vidéo — HLS + WebRTC](#streaming-vidéo--hls--webrtc)
7. [Détection IA — YOLOv8](#détection-ia--yolov8)
8. [Pi Zero 2W — Sentys Agent](#pi-zero-2w--sentys-agent)
9. [CI/CD — Pipeline GitHub Actions](#cicd--pipeline-github-actions)
10. [Variables d'environnement](#variables-denvironnement)
11. [Installation](#installation)
12. [Dépannage](#dépannage)

---

## Architecture générale

```
┌─────────────────────────────────────────────────────────┐
│                      Internet / LAN                      │
└───────────┬─────────────────────────┬───────────────────┘
            │                         │
    ┌───────▼────────┐       ┌────────▼────────┐
    │   Navigateur   │       │  Pi Zero 2W     │
    │  (PWA React)   │       │  MediaMTX RTSP  │
    │  HLS / WebRTC  │       │  sentys_agent   │
    └───────┬────────┘       └────────┬────────┘
            │  Socket.IO / HTTP       │  HTTP announce
            │                         │  upload offline clips
    ┌───────▼─────────────────────────▼───────┐
    │           Serveur Host (Linux)           │
    │                                          │
    │  Express (Node.js) + Socket.IO :4000     │
    │  FFmpeg  →  HLS  /hls/{id}/              │
    │  go2rtc  →  WebRTC :1984                 │
    │  Python  →  YOLOv8 + OpenCV              │
    │  PM2     →  process manager              │
    └───────────────────┬──────────────────────┘
                        │
               ┌────────▼────────┐
               │   PostgreSQL    │
               │     :5432       │
               └─────────────────┘
```

---

## Stack technique

| Couche | Technologie | Version |
|---|---|---|
| Frontend | React + **TypeScript** | 19.2.0 |
| Build tool | Vite | 8.0.0 |
| Routing client | React Router DOM | 7.13.1 |
| Streaming HLS | hls.js | 1.6.16 |
| Temps réel | Socket.IO | 4.8.3 |
| PWA | vite-plugin-pwa | 1.2.0 |
| Backend | Node.js + Express (**JavaScript ES Modules**) | 4.18.2 |
| Base de données | PostgreSQL | 12+ |
| Driver DB | pg (node-postgres) | 8.11.3 |
| Authentification | JWT (jsonwebtoken) | 9.0.0 |
| Hachage mots de passe | bcryptjs | 2.4.3 |
| Upload fichiers | Multer | 2.0.0 |
| Notifications push | web-push | 3.6.7 |
| Rate limiting | express-rate-limit | 8.2.1 |
| Vidéo HLS | FFmpeg | 4.2+ |
| WebRTC | go2rtc | latest |
| IA détection objets | YOLOv8n (ultralytics) | latest |
| Vision par ordinateur | OpenCV (cv2) | latest |
| IoT messaging | MQTT | 5.3.0 |
| Découverte réseau | multicast-dns | 7.2.5 |
| Process manager | PM2 | latest |
| Pi — agent | Python 3 | 3.8+ |
| Pi — streaming RTSP | MediaMTX | latest |
| Pi — capture caméra | rpicam-vid | latest |

---

## Client — React + Vite

### Dépendances

```json
{
  "react": "^19.2.0",
  "react-router-dom": "^7.13.1",
  "hls.js": "^1.6.16",
  "socket.io-client": "^4.8.3",
  "react-simple-keyboard": "^3.8.192",
  "vite-plugin-pwa": "^1.2.0"
}
```

### Pages et composants principaux

| Composant | Description |
|---|---|
| `LoginPage` | Auth JWT + mode kiosque sans mot de passe (réseau local) |
| `CameraFeed` | Flux live HLS/WebRTC + historique mouvements + badge **HORS LIGNE** |
| `AlertsPage` | Alertes temps réel, niveaux critical/warning, acquittement |
| `SystemInfo` | Métriques CPU, RAM, disque, réseau, batterie |
| `Settings` | Configuration admin : nom app, langue, densité UI, alertes |
| `BrandLogo` | Logo personnalisable |

### Fonctionnalités

- **PWA** : installable sur tablette ou kiosque (icône, mode standalone)
- **Socket.IO** : mises à jour en temps réel sans rechargement (alertes, statut caméras)
- **Mode kiosque** : timeout d'inactivité 5 min, clavier virtuel pour écrans tactiles
- **Thème** : clair / sombre
- **Rôles** : admin vs utilisateur (paramètres réservés aux admins)
- **Batterie** : affichage de l'état de charge de la machine hôte

---

## Serveur — Node.js + Express

### Dépendances

```json
{
  "express": "^4.18.2",
  "socket.io": "^4.8.3",
  "pg": "^8.11.3",
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.0.0",
  "express-rate-limit": "^8.2.1",
  "ffmpeg-static": "^5.3.0",
  "mqtt": "^5.3.0",
  "multicast-dns": "^7.2.5",
  "multer": "^2.0.0",
  "web-push": "^3.6.7",
  "ws": "^8.16.0",
  "dotenv": "^16.0.0",
  "cors": "^2.8.5"
}
```

### Routes API

#### Authentification
| Méthode | Route | Accès |
|---|---|---|
| POST | `/auth/register` | Public (premier utilisateur = admin) |
| POST | `/auth/login` | Public |
| GET | `/auth/me` | Authentifié |

#### Caméras
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/cameras` | Liste des caméras + état courant |
| POST | `/api/cameras` | Ajouter une caméra |
| POST | `/api/cameras/:id/start` | Démarrer le flux |
| POST | `/api/cameras/:id/stop` | Arrêter |
| POST | `/api/cameras/:id/pause` | Mettre en pause |
| POST | `/api/cameras/:id/motion` | Webhook mouvement (reçu du détecteur IA) |
| GET | `/api/cameras/discoveries` | Caméras découvertes automatiquement |

#### Noeuds Pi
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/camera-nodes` | Liste des Pi enregistrés |
| POST | `/api/camera-nodes/announce` | Annonce Pi → serveur (toutes les 30s) |
| POST | `/api/camera-nodes/motion` | Mouvement détecté par le Pi |
| GET | `/api/camera-nodes/:id/motion-history` | Historique des mouvements |
| POST | `/api/camera-nodes/:id/upload-recording` | Upload clip hors ligne |

#### Système & Divers
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/system` | CPU, RAM, disque, réseau |
| GET | `/api/alerts` | Liste des alertes |
| PATCH | `/api/app-config` | Config globale (admin uniquement) |
| GET | `/api/agent/sentys_agent.py` | Sert le script Pi pour auto-update |
| GET | `/health` | Health check |
| GET | `/hls/:id/index.m3u8` | Flux HLS live |
| GET | `/recordings/:id/:file` | Télécharger un enregistrement |

### Middleware

- **CORS** : toutes origines avec credentials
- **Rate limiting** : login 10 req/15min, API 200 req/60s
- **JWT** : token Bearer dans l'en-tête Authorization
- **Socket.IO auth** : validation JWT sur les connexions WebSocket
- **Mode kiosque** : connexion sans mot de passe depuis `192.168.*`, `10.*`, `127.0.0.1`
- **Audit log** : toutes les actions sont enregistrées en base

### Gestionnaire caméras (`camera/manager.js`)

Gère le cycle de vie complet de chaque caméra :

1. **Démarrage** → sonde l'URL RTSP/HTTP, lance FFmpeg vers HLS, lance le détecteur Python
2. **Streaming HLS** → segments fMP4 de 1s, buffer 3 segments, sortie `/hls/{id}/`
3. **Détection mouvement** → processus Python YOLOv8 par caméra
4. **Enregistrement** → clips MP4 30s dans `/recordings/{id}/` déclenchés par mouvement
5. **Nettoyage** → suppression automatique après 30 jours

**Scan réseau automatique :**
- Scanne les sous-réseaux configurés (ex: `192.168.0.0/24`)
- Teste les ports RTSP standards et endpoints HTTP courants
- 30 connexions parallèles, timeout 700ms par test

---

## Base de données — PostgreSQL

### Tables

| Table | Rôle |
|---|---|
| `users` | Comptes utilisateurs (rôle admin / user) |
| `app_settings` | Configuration globale (1 seule ligne) |
| `cameras` | Caméras RTSP définies manuellement |
| `camera_discoveries` | Caméras découvertes automatiquement sur le réseau |
| `camera_nodes` | Noeuds Pi Zero enregistrés |
| `camera_node_motion_events` | Événements mouvement des Pi (+ enregistrements hors ligne) |
| `alerts` | Alertes avec déduplication, niveaux, statut |
| `audit_logs` | Journal d'audit de toutes les actions admin |
| `push_subscriptions` | Abonnements Web Push par navigateur |

### Colonnes clés — `camera_node_motion_events`

```sql
id                SERIAL PRIMARY KEY
device_id         VARCHAR(100)
motion            BOOLEAN
offline_recording BOOLEAN DEFAULT false   -- clip enregistré hors ligne
recording_path    VARCHAR(255)            -- nom du fichier MP4
detected_at       TIMESTAMP
```

### Connexion par défaut

```
Host:     localhost
Port:     5432
Database: sentys
User:     postgres
Password: admin
```

Les tables sont créées automatiquement au premier démarrage du serveur.

---

## Streaming vidéo — HLS + WebRTC

### HLS (principal — latence ~3-5s)

```
Caméra RTSP → FFmpeg → segments fMP4 (1s) → /hls/{id}/ → hls.js (navigateur)
```

- Format : fMP4 (compatible tous navigateurs modernes)
- Buffer : 3 segments de 1 seconde
- Bibliothèque client : hls.js 1.6.16

### WebRTC via go2rtc (optionnel — latence < 1s)

```
Caméra RTSP → go2rtc (:1984) → WHEP/SDP → navigateur
```

- Protocole de négociation : WHEP (WebRTC-HTTP Egress Protocol)
- Fallback automatique vers HLS si go2rtc indisponible
- Enregistrement dynamique des streams : `PUT /api/streams?name=cam{id}&src={url}`

---

## Détection IA — YOLOv8

### Pipeline de traitement

```
Flux RTSP → OpenCV → MOG2 → contours → YOLOv8n → classification → webhook → alerte
```

1. Capture frame (RTSP via OpenCV)
2. Redimensionnement 640×360
3. Soustraction de fond MOG2 (history=500, threshold=50)
4. Opérations morphologiques (open + close)
5. Détection de contours valides (aire min 1800 px²)
6. Classification YOLO sur la frame (jusqu'à 10 frames en mode one-shot)
7. Webhook vers le serveur + création alerte + notification push

### Classes détectées

| Classe YOLO | Label affiché | Confiance min |
|---|---|---|
| 0 — person | Humain détecté | 45% |
| 15 — cat | Chat détecté | 50% |
| 16 — dog | Chien détecté | 50% |
| 14 — bird | Oiseau détecté | 50% |
| 2 — car | Véhicule détecté | 52% |
| 3 — motorcycle | Véhicule détecté | 52% |
| 5 — bus | Véhicule détecté | 52% |
| 7 — truck | Véhicule détecté | 52% |

Si aucun objet reconnu → "Mouvement détecté" (fallback).

### Modes d'exécution

| Mode | Déclencheur | Description |
|---|---|---|
| **Par caméra** | `CAMERA_ID` + `RTSP_URL` env | Boucle continue, détection temps réel |
| **One-shot** (`--analyze`) | Pi node signale un mouvement | Lit jusqu'à 10 frames, retourne JSON |
| **Autonome** | Aucune env | Interroge la DB, thread par caméra |

### Paramètres

```python
COOLDOWN_SECONDS = 30    # délai min entre deux déclenchements
CONFIRM_FRAMES   = 2     # frames à confirmer avant alerte
MIN_CONTOUR_AREA = 1800  # taille min du blob de mouvement (px²)
```

---

## Pi Zero 2W — Sentys Agent

### Rôle

Le Pi Zero 2W publie son flux RTSP via **MediaMTX** et exécute `sentys_agent.py` en continu via systemd.

### 1. Annonce réseau

Toutes les 30 secondes, le Pi envoie son IP et URL RTSP au serveur → il apparaît dans l'onglet **Annonces réseau**.

```python
POST /api/camera-nodes/announce
{
  "deviceId":  "pi-zero-01",
  "name":      "Pi Zero 2W",
  "host":      "192.168.0.XX",
  "streamUrl": "rtsp://192.168.0.XX:8554/cam1",
  "model":     "Raspberry Pi Zero",
  "location":  "Entrée"
}
```

### 2. Mode hors ligne

Quand le serveur est inaccessible :
- **MediaMTX est arrêté** (libère la caméra)
- Des clips MP4 de 30s sont enregistrés localement dans `/home/picam/offline_recordings/`
- Stockage limité à **500 Mo** (les plus anciens clips supprimés en premier)
- Clips invalides (< 50 Ko) ignorés

### 3. Synchronisation au retour en ligne

Dès que le serveur redevient accessible :
- MediaMTX redémarré (flux RTSP de nouveau disponible)
- Tous les clips en attente uploadés vers le serveur
- Apparaissent dans l'historique avec le badge **HORS LIGNE**
- Supprimés localement après upload réussi

### Configuration (`sentys_agent.py`)

```python
SERVER_URL        = "http://192.168.0.47:4000"
DEVICE_ID         = "pi-zero-01"    # unique par Pi !
DEVICE_NAME       = "Pi Zero 2W"
DEVICE_LOCATION   = "Entrée"       # optionnel
RTSP_PORT         = 8554
RTSP_PATH         = "cam1"          # unique par Pi !
CLIP_DURATION_SEC = 30
ANNOUNCE_INTERVAL = 30
MAX_STORAGE_MB    = 500
```

### Auto-update (`auto_update.sh`)

Le Pi se met à jour **automatiquement** via cron toutes les 5 minutes :

```
git push → Pipeline → Serveur mis à jour
                            ↓
               GET /api/agent/sentys_agent.py
                            ↓
     Pi compare → différent → remplace → redémarre service
```

```bash
# Crontab sur le Pi
*/5 * * * * /home/picam/auto_update.sh >> /home/picam/update.log 2>&1
```

### Multi-Pi

Chaque Pi a un `DEVICE_ID` et `RTSP_PATH` uniques, le reste est identique :

```
Pi 1 → DEVICE_ID="pi-zero-01"  RTSP_PATH="cam1"
Pi 2 → DEVICE_ID="pi-zero-02"  RTSP_PATH="cam2"
Pi 3 → DEVICE_ID="pi-zero-03"  RTSP_PATH="cam3"
```

---

## CI/CD — Pipeline GitHub Actions

**Déclencheur :** push sur la branche `main`
**Runner :** self-hosted Linux x64 (le serveur host)

### Étapes

| Étape | Description |
|---|---|
| Checkout | Clone le code au commit exact |
| Validate path | Vérifie que `DEPLOY_PATH` est défini |
| Prepare repo | `git fetch` + `reset --hard` (préserve `.env`, `hls/`, `recordings/`) |
| Stop PM2 | `pm2 stop sentys` pour libérer la RAM |
| Build client | `npm ci` + `npm run build` (Vite) |
| Record version | Écrit commit SHA + timestamp dans `deploy-info.json` |
| Install server deps | `npm ci --omit=dev` (prod uniquement) |
| Setup Python venv | Crée `venv/` si absent, installe ultralytics/opencv/psycopg2 |
| Restart | `pm2 delete` + `pm2 start` + `pm2 save` |

### Variable GitHub requise

| Variable | Exemple |
|---|---|
| `DEPLOY_PATH` | `/home/theo/TFE` |

### Fichiers préservés lors du déploiement

- `.env` et `.env.*`
- `hls/` (segments HLS en cours)
- `recordings/` et `server/recordings/` (enregistrements vidéo)

---

## Variables d'environnement

Fichier `.env` dans `server/` :

```env
# Base de données
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sentys
DB_USER=postgres
DB_PASSWORD=admin

# Serveur
PORT=4000
JWT_SECRET=changez_moi_en_production

# Vidéo
RECORDINGS_DIR=../recordings
HLS_DIR=../hls
FFMPEG_PATH=                      # auto-détecté si vide
RTSP_TRANSPORT=tcp
RECORDINGS_RETENTION_DAYS=30

# Scan réseau
CAMERA_SCAN_SUBNETS=192.168.0
CAMERA_SCAN_CONCURRENCY=30
CAMERA_RTSP_TIMEOUT=1000
CAMERA_SCAN_TIMEOUT=700

# WebRTC (optionnel)
GO2RTC_URL=http://127.0.0.1:1984
GO2RTC_BIN=/usr/local/bin/go2rtc

# Notifications push (optionnel)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

---

## Installation

### Prérequis

- Node.js 18+
- PostgreSQL 12+
- FFmpeg 4.2+
- Python 3.8+ avec pip
- PM2 (`npm install -g pm2`)
- go2rtc (optionnel, pour WebRTC < 1s de latence)

### Serveur

```bash
cd server
npm install

# Configuration
cp .env.example .env
# Éditer .env avec vos paramètres

# Python / IA
python3 -m venv venv
venv/bin/pip install ultralytics opencv-python psycopg2-binary requests

# Lancement
npm start
# ou en développement
npm run dev
```

### Client

```bash
cd client
npm install
npm run dev      # développement (hot reload)
npm run build    # production → client/dist/
```

### Pi Zero 2W (installation initiale)

```bash
# Depuis ton PC — envoyer les scripts
scp pi/sentys_agent.py picam@<IP_PI>:/home/picam/sentys_agent.py
scp pi/auto_update.sh  picam@<IP_PI>:/home/picam/auto_update.sh

# Sur le Pi via SSH
chmod +x /home/picam/auto_update.sh

# Créer le service systemd
sudo nano /etc/systemd/system/sentys-agent.service
```

Contenu du service :

```ini
[Unit]
Description=Sentys Agent
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/picam/sentys_agent.py
WorkingDirectory=/home/picam
Restart=always
RestartSec=5
User=picam
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable sentys-agent
sudo systemctl start sentys-agent

# Cron pour auto-update
crontab -e
# Ajouter :
*/5 * * * * /home/picam/auto_update.sh >> /home/picam/update.log 2>&1
```

Après l'installation initiale, **aucune intervention manuelle sur le Pi n'est nécessaire**. Les mises à jour se font automatiquement à chaque `git push`.

---

## Dépannage

### Serveur

```bash
# Logs applicatifs
pm2 logs sentys

# Statut PM2
pm2 list

# Version déployée
cat /home/theo/TFE/.deploy-commit
cat /home/theo/TFE/.deploy-time
```

### Pi Zero 2W

```bash
# Logs du service agent
sudo journalctl -u sentys-agent -f

# Logs de mise à jour automatique
cat /home/picam/update.log

# Forcer une mise à jour immédiate
/home/picam/auto_update.sh

# Redémarrer manuellement
sudo systemctl restart sentys-agent
```

### Pipeline GitHub Actions

Le runner self-hosted doit être actif sur le serveur host avec les labels `self-hosted`, `linux`, `x64`.

Le nom de fichier des imports TypeScript est sensible à la casse sur Linux — vérifier que les imports correspondent exactement au nom des fichiers.
