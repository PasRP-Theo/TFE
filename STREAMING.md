# Sentys — Architecture de streaming vidéo

## Vue d'ensemble

Sentys utilise deux protocoles de streaming en parallèle selon la disponibilité :

```
Caméra RTSP
     │
     ├──► go2rtc ──► WebRTC ──► Navigateur   (latence ~200ms)
     │
     └──► FFmpeg  ──► HLS   ──► Navigateur   (latence ~3-6s, fallback)
```

Le client essaie toujours **WebRTC en premier**. Si go2rtc est indisponible ou si la négociation échoue, il bascule automatiquement sur **HLS**.

---

## 1. go2rtc + WebRTC

### Rôle
go2rtc est un proxy RTSP→WebRTC. Il reçoit le flux RTSP de la caméra et le retransmet au navigateur via WebRTC (sous-seconde de latence).

### Installation
```bash
# Linux (serveur host)
sudo curl -L https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64 \
  -o /tmp/go2rtc && sudo chmod +x /tmp/go2rtc && sudo mv /tmp/go2rtc /usr/local/bin/go2rtc
```

### Configuration (`server/go2rtc.yaml`)
```yaml
api:
  listen: :1984      # API REST go2rtc (locale uniquement)

log:
  level: warn

# Les streams sont enregistrés dynamiquement via l'API REST
# par le manager Node.js — pas besoin de les lister ici
```

### Démarrage
go2rtc est démarré automatiquement par Node.js au lancement du serveur (`pm2 start sentys`). Il n'y a pas de service systemd séparé — il tourne comme processus enfant de Node.js.

Si le binaire est absent, le serveur log :
```
[go2rtc] Binaire introuvable — WebRTC désactivé, HLS actif en fallback.
```

### Flux de négociation WebRTC

```
Navigateur                    Node.js                    go2rtc
    │                             │                          │
    │── GET /api/webrtc/status ──►│                          │
    │◄─ { available: true } ──────│                          │
    │                             │                          │
    │  createOffer() (SDP)        │                          │
    │── POST /api/webrtc/69 ─────►│                          │
    │   body: SDP offer           │── POST /api/webrtc ─────►│
    │                             │   ?src=cam69             │
    │                             │◄─ SDP answer ────────────│
    │◄─ SDP answer ───────────────│                          │
    │                             │                          │
    │  setRemoteDescription()     │                          │
    │◄════════ flux vidéo UDP ════════════════════════════════│
```

### Nommage des streams
Les streams go2rtc sont nommés `cam{id}` (ex: `cam69`).
Enregistrement automatique au démarrage du serveur pour toutes les caméras actives.
Re-enregistrement à la volée si go2rtc ne connaît pas encore le stream lors d'une négociation.

### Gestion des erreurs
| Erreur | Cause | Comportement |
|--------|-------|--------------|
| `503` sur `/api/webrtc/status` | go2rtc non démarré | Bascule HLS immédiate |
| `502` sur `/api/webrtc/:id` | RTSP source injoignable | Bascule HLS |
| `pc.connectionState === 'failed'` | Problème ICE/réseau | Bascule HLS |
| `pc.connectionState === 'disconnected'` | Déco transitoire | Attente 3s puis bascule HLS |

---

## 2. FFmpeg + HLS

### Rôle
FFmpeg lit le flux RTSP de la caméra et le segmente en fragments fMP4 (1 seconde chacun) servis statiquement via Express. C'est le mode par défaut et le fallback si WebRTC échoue.

### Pipeline FFmpeg
```
RTSP source
    │
    └──► FFmpeg
           │  -rtsp_transport tcp
           │  -c:v copy          (pas de transcodage — copie directe)
           │  -hls_time 1        (segments de 1s)
           │  -hls_list_size 3   (fenêtre glissante 3 segments = ~3s)
           │  -hls_flags delete_segments+append_list
           │  -hls_segment_type fmp4
           │
           └──► /hls/{cameraId}/index.m3u8
                /hls/{cameraId}/init_{ts}.mp4
                /hls/{cameraId}/seg_{ts}_00001.m4s
                /hls/{cameraId}/seg_{ts}_00002.m4s
                /hls/{cameraId}/seg_{ts}_00003.m4s
```

### Servi par Express
```
GET /hls/69/index.m3u8       → manifest HLS
GET /hls/69/seg_xxx_00001.m4s → segment vidéo
```
Les fichiers sont servis en statique depuis `server.js` :
```js
app.use('/hls', express.static(hlsDir));
```

### États d'une caméra
| État | Description |
|------|-------------|
| `watching` | FFmpeg démarré, en attente du premier segment |
| `running` | Manifeste HLS prêt, flux visible |
| `reconnecting` | FFmpeg a planté, tentative de reconnexion (max 4) |
| `paused` | FFmpeg stoppé manuellement |
| `stopped` | En veille, aucun processus FFmpeg |

### Reconnexion automatique
Si FFmpeg plante, le manager tente 4 reconnexions (délai croissant : 5s, 5s, 10s, 20s).
Au-delà, la caméra passe en `reconnecting` et attend un redémarrage manuel.

### Timeout d'inactivité
Si aucun heartbeat client n'est reçu pendant 5 minutes (`STREAM_INACTIVE_TIMEOUT_MS`), FFmpeg est arrêté automatiquement pour économiser les ressources.

Le client envoie un heartbeat toutes les 60s :
```
POST /api/cameras/:id/stream/heartbeat
```

### Enregistrement sur mouvement
Quand un mouvement est détecté (par le Pi ou l'IA), un clip MP4 de 30s est enregistré :
```
/recordings/{cameraId}/rec_{timestamp}.mp4
```
Rétention configurable (défaut : 30 jours). Nettoyage automatique quotidien.

---

## 3. Logique de sélection côté client

### Priorité
```
1. WebRTC (WebRTCPlayer.tsx)
      │ échoue ?
      ▼
2. HLS  (hls.js dans CameraFeed.tsx)
```

### Code simplifié
```tsx
// CameraFeed.tsx
{useWebRTC ? (
  <WebRTCPlayer
    cameraId={camera.id}
    onError={() => setUseWebRTC(false)}   // bascule HLS si échec
  />
) : (
  <video ref={videoRef} />   // hls.js attaché ici
)}
```

### Quand WebRTC ne fonctionne pas
- go2rtc non installé → `GET /api/webrtc/status` retourne `{ available: false }`
- Caméra Pi en veille → RTSP refusé → `502` → bascule HLS
- Réseau NAT strict (hors LAN/Tailscale) → ICE gathering timeout → bascule HLS

---

## 4. Flux complet Pi Zero 2W

```
[Utilisateur clique START]
         │
         ▼
POST /api/cameras/69/start
         │
         ├─ Pi détecté ? ──► requestPiWake(deviceId)
         │                        │
         │                   Pi poll /wake → démarre MediaMTX
         │                        │
         │                   MediaMTX prêt (RTSP :8554/cam1)
         │                        │
         │                   POST /api/camera-nodes/motion {motion: true}
         │                        │
         ▼                        ▼
startHlsStream(camera)    go2rtc enregistre le stream
         │                        │
         ▼                        ▼
FFmpeg lit rtsp://Pi:8554/cam1   WebRTC disponible
         │                        │
         └────────────────────────┘
                    │
         Client essaie WebRTC → succès → latence ~200ms
         Client échoue WebRTC → HLS → latence ~3-6s
```

---

## 5. Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `GO2RTC_BIN` | `go2rtc` | Chemin du binaire go2rtc |
| `GO2RTC_URL` | `http://127.0.0.1:1984` | URL API REST go2rtc |
| `HLS_DIR` | `../hls` | Dossier des segments HLS |
| `RECORDINGS_DIR` | `../recordings` | Dossier des enregistrements |
| `FFMPEG_PATH` | ffmpeg-static | Binaire FFmpeg (npm package si absent) |
| `RTSP_TRANSPORT` | `tcp` | Transport RTSP (tcp ou udp) |
| `STREAM_INACTIVE_TIMEOUT_MS` | `300000` | Timeout inactivité stream (5 min) |

---

## 6. Dépannage

### WebRTC : `502 Bad Gateway`
go2rtc tourne mais ne peut pas atteindre la source RTSP.
- Caméra Pi → normal si en veille, clique Start pour la réveiller
- Caméra fixe → vérifier que l'URL RTSP est correcte et joignable

### WebRTC : `fetch failed` au démarrage
go2rtc vient d'être installé mais n'était pas encore prêt lors de la tentative.
```bash
pm2 restart sentys
```

### HLS : manifeste jamais prêt (`watching` permanent)
FFmpeg ne peut pas lire le flux RTSP.
```bash
pm2 logs sentys --lines 50 | grep "CAM 69"
# Chercher : Connection refused, 401 Unauthorized, Invalid data
```

### go2rtc : vérifier qu'il tourne
```bash
curl http://localhost:1984/api/streams
# Doit retourner un JSON avec les streams enregistrés
```

### Vérifier les segments HLS générés
```bash
ls -la ~/hls/69/
# Doit montrer index.m3u8 + fichiers .m4s récents
```
