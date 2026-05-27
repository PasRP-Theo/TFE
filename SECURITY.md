# Sentys — Architecture de sécurité

## Vue d'ensemble

Sentys est un système de vidéosurveillance hébergé localement. L'accès réseau est contrôlé par **Tailscale** (VPN mesh), ce qui constitue la première couche de défense. L'application ajoute une couche applicative via **JWT** pour gérer les niveaux d'accès.

```
Internet
   │
   └─► Tailscale VPN ──► PC hôte (192.168.0.47:4000)
                                │
                         ┌──────┴──────┐
                         │  Express.js │
                         │  + JWT Auth │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
               PostgreSQL    FFmpeg      Pi Zero 2W
```

---

## Couches de sécurité

### 1. Tailscale (réseau)
- Seuls les appareils enrôlés dans ton réseau Tailscale peuvent atteindre le serveur
- Authentification mutuelle via certificats (WireGuard sous le capot)
- Le Pi Zero et le PC hôte sont sur le même réseau Tailscale + LAN local

### 2. JWT (applicatif)

Les sessions utilisateur sont gérées via des **JSON Web Tokens** signés avec `JWT_SECRET`.

```
POST /auth/login  →  { token: "eyJ..." }
                          │
                    Stocké dans localStorage
                          │
              Authorization: Bearer eyJ...
                          │
               Vérifié par requireAuth middleware
```

**Durée de vie du token :** 1 heure (configurable via `JWT_EXPIRES_IN`)

**Vérification au démarrage :**
```js
// server/src/config/auth.js
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set'); // Refuse de démarrer
}
```

### 3. Rôles utilisateur

| Rôle    | Permissions                                                         |
|---------|---------------------------------------------------------------------|
| `admin` | Tout : ajouter/supprimer caméras, modifier config, voir les logs    |
| `user`  | Lecture : voir les flux, alertes, historique (pas de modifications) |

### 4. Rate limiting

| Endpoint        | Limite            |
|-----------------|-------------------|
| `/auth/login`   | 10 req / 15 min (50 en dev) |
| Toutes les routes API | 200 req / min |

---

## Routes protégées

### Routes publiques (intentionnel)
Ces routes sont appelées par le Pi Zero depuis le LAN — il n'a pas de credentials.

| Route | Raison |
|-------|--------|
| `POST /api/camera-nodes/announce` | Pi s'annonce au démarrage |
| `POST /api/camera-nodes/motion`   | Pi signale un mouvement |
| `GET  /api/camera-nodes/:id/wake` | Pi poll le signal de démarrage |
| `GET  /api/camera-nodes/:id/sleep`| Pi poll le signal d'arrêt |
| `GET  /api/camera-nodes/:id/config`| Pi lit sa configuration |
| `POST /api/camera-nodes/:id/upload-recording` | Pi upload les clips offline |
| `POST /api/cameras/announce`      | ESP32-CAM s'annonce |
| `GET  /api/cameras`               | Liste (lecture seule, kiosk-friendly) |
| `GET  /health`                    | Health check Tailscale / monitoring |
| `GET  /auth/login`                | Login |
| `GET  /auth/me`                   | Vérifie le token courant |

### Routes nécessitant `requireAuth`
```
GET  /api/cameras/discover         (scan réseau)
GET  /api/cameras/scan             (scan MediaMTX)
POST /api/cameras/:id/start
POST /api/cameras/:id/stop
POST /api/cameras/:id/pause
POST /api/cameras/:id/resume
POST /api/cameras/:id/stream/heartbeat
GET  /api/cameras/:id/history
GET  /api/cameras/archives
GET  /api/camera-nodes/
GET  /api/camera-nodes/:id/motion-history
```

### Routes nécessitant `requireAuth` + `requireAdmin`
```
POST   /api/cameras/                    (ajouter une caméra)
PATCH  /api/cameras/:id                 (renommer)
DELETE /api/cameras/:id                 (supprimer)
DELETE /api/cameras/:id/history         (vider l'historique)
DELETE /api/cameras/:id/history/:file   (supprimer un enregistrement)
DELETE /api/cameras/archives/:id        (purger archives)
POST   /api/camera-nodes/:id/connect    (connecter un nœud Pi)
PATCH  /api/camera-nodes/:id/config     (configurer un nœud Pi)
DELETE /api/camera-nodes/:id            (supprimer un nœud)
GET    /api/audit-logs                  (journaux d'audit)
GET    /api/system/reset                (réinitialisation)
```

---

## Variables d'environnement requises

Créer un fichier `server/.env` :

```env
# Obligatoire en production
JWT_SECRET=une_chaine_aleatoire_longue_et_unique

# Optionnel
JWT_EXPIRES_IN=1h
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sentys
DB_USER=postgres
DB_PASSWORD=mot_de_passe
PORT=4000
NODE_ENV=production

# Tailscale (si le serveur est accessible via 100.x.x.x)
# Aucune config requise côté app — Tailscale gère le réseau
```

Générer un `JWT_SECRET` solide :
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Pi Zero 2W — sécurité

### Authentification
Le Pi n'utilise pas de token JWT. Il s'authentifie implicitement via :
- Son appartenance au réseau LAN / Tailscale
- Son `DEVICE_ID` unique défini dans `~/device.conf`

### Fichier de configuration Pi (`~/device.conf`)
```ini
DEVICE_ID=pi-salon
DEVICE_NAME=Caméra Salon
DEVICE_LOCATION=Salon
```

### Flux offline sécurisé
```
[Coupure réseau/courant]
        │
        ▼
Pi détecte mouvement → enregistre /home/picam/offline_recordings/{timestamp}.mp4
        │
        ▼ (reconnexion réseau)
        │
Pi détecte server_reachable() == True
        │
        ▼
upload_pending() → POST /api/camera-nodes/{DEVICE_ID}/upload-recording
        │
        ▼
Serveur déplace le fichier → /recordings/{cameraId}/{filename}
Insère dans camera_node_motion_events (offline_recording=true)
Crée une alerte visible dans l'interface
```

### Limite de stockage offline
Configurable via l'interface admin → max 500 Mo par défaut.
Les clips les plus anciens sont supprimés en premier si la limite est atteinte.

---

## Audit

Chaque action admin est tracée dans la table `audit_logs` :

| Champ      | Valeur exemple                    |
|------------|-----------------------------------|
| username   | root                              |
| action     | LOGIN_SUCCESS                     |
| details    | Connexion réussie                 |
| ip_address | 100.64.0.1 (Tailscale IP)         |
| created_at | 2026-05-27 14:32:01               |

Consultable via **Paramètres → Journaux d'audit** (admin uniquement).

---

## Mise à jour du Pi Zero

Le fichier agent est servi par le serveur. Depuis le Pi :
```bash
curl http://192.168.0.47:4000/api/agent/sentys_agent.py -o ~/sentys_agent.py
sudo systemctl restart sentys
```

Ou via Tailscale si hors réseau local :
```bash
curl http://100.x.x.x:4000/api/agent/sentys_agent.py -o ~/sentys_agent.py
sudo systemctl restart sentys
```
