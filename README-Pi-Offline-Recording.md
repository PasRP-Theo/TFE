# Pi Zero 2W — Enregistrement hors ligne

Quand le Pi Zero 2W perd la connexion au serveur, il enregistre des clips vidéo localement sur sa carte SD, puis les synchronise automatiquement dès que la connexion est rétablie.

---

## Architecture

```
Pi Zero 2W
 ├── MediaMTX          → stream RTSP vers le serveur (quand connecté)
 ├── announce.py       → s'enregistre auprès du serveur au démarrage
 └── offline_recorder.py → détecte la perte de connexion, enregistre localement, sync au retour

Serveur hôte (192.168.0.47:3001)
 └── POST /api/camera-nodes/:deviceId/upload-recording
       → reçoit les clips, crée un event "offline_recording" dans l'historique
       → génère une alerte avec le badge "HORS LIGNE"
```

---

## 1. Déploiement sur le Pi

### 1.1 Créer le script

```bash
nano /home/picam/offline_recorder.py
```

Coller le contenu suivant :

```python
#!/usr/bin/env python3
import os, time, subprocess, glob, json
from pathlib import Path
from datetime import datetime

try:
    import requests
except ImportError:
    subprocess.run(["pip3", "install", "requests"], check=True)
    import requests

SERVER_URL = os.environ.get("SERVER_URL", "http://192.168.0.47:3001")
DEVICE_ID  = os.environ.get("DEVICE_ID",  "picam")
RECORD_DIR = Path("/home/picam/offline_recordings")
RECORD_DIR.mkdir(exist_ok=True)

CLIP_DURATION_SEC = 30
CHECK_INTERVAL    = 10

def server_reachable():
    try:
        r = requests.get(f"{SERVER_URL}/api/health", timeout=3)
        return r.status_code < 500
    except Exception:
        return False

def record_clip():
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = RECORD_DIR / f"{ts}.mp4"
    subprocess.run([
        "libcamera-vid",
        "-t", str(CLIP_DURATION_SEC * 1000),
        "--codec", "h264",
        "--width",  "1280",
        "--height", "720",
        "-o", str(out),
    ], check=True, timeout=CLIP_DURATION_SEC + 10)
    return out

def upload_pending():
    files = sorted(RECORD_DIR.glob("*.mp4"))
    if not files:
        return
    print(f"[SYNC] {len(files)} fichier(s) à envoyer")
    for f in files:
        try:
            detected_at = datetime.strptime(f.stem, "%Y%m%d_%H%M%S").isoformat()
        except Exception:
            detected_at = datetime.now().isoformat()
        try:
            with open(f, "rb") as video:
                r = requests.post(
                    f"{SERVER_URL}/api/camera-nodes/{DEVICE_ID}/upload-recording",
                    files={"recording": (f.name, video, "video/mp4")},
                    data={"detectedAt": detected_at, "offlineRecording": "true"},
                    timeout=120,
                )
            if r.status_code in (200, 201):
                print(f"[SYNC] ✅ {f.name}")
                f.unlink()
            else:
                print(f"[SYNC] ❌ {f.name} — HTTP {r.status_code}")
                break
        except Exception as e:
            print(f"[SYNC] ❌ {f.name} — {e}")
            break

def main():
    print(f"[OFFLINE-REC] Démarré | serveur={SERVER_URL} | device={DEVICE_ID}")
    was_offline = False

    while True:
        if server_reachable():
            if was_offline:
                print("[OFFLINE-REC] Connexion rétablie — synchronisation")
                upload_pending()
                was_offline = False
            time.sleep(CHECK_INTERVAL)
        else:
            if not was_offline:
                print("[OFFLINE-REC] Serveur inaccessible — passage en mode local")
            was_offline = True
            try:
                out = record_clip()
                print(f"[OFFLINE-REC] Clip enregistré : {out.name}")
            except Exception as e:
                print(f"[OFFLINE-REC] Erreur recording : {e}")
                time.sleep(5)

if __name__ == "__main__":
    main()
```

### 1.2 Fichier de configuration

```bash
echo 'SERVER_URL=http://192.168.0.47:3001' > /home/picam/.env
echo 'DEVICE_ID=picam' >> /home/picam/.env
```

> Vérifie le `DEVICE_ID` exact avec : `grep -i device_id /home/picam/announce.py`

### 1.3 Service systemd

```bash
sudo nano /etc/systemd/system/offline-recorder.service
```

Contenu :

```ini
[Unit]
Description=Offline Camera Recorder
After=network.target

[Service]
User=picam
WorkingDirectory=/home/picam
EnvironmentFile=/home/picam/.env
ExecStart=/usr/bin/python3 /home/picam/offline_recorder.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 1.4 Activer et démarrer

```bash
sudo systemctl daemon-reload
sudo systemctl enable offline-recorder
sudo systemctl start offline-recorder
```

### 1.5 Vérifier les logs

```bash
journalctl -u offline-recorder -f
```

Sortie attendue au démarrage :
```
[OFFLINE-REC] Démarré | serveur=http://192.168.0.47:3001 | device=picam
```

Sortie lors d'une déconnexion :
```
[OFFLINE-REC] Serveur inaccessible — passage en mode local
[OFFLINE-REC] Clip enregistré : 20240501_143022.mp4
```

Sortie lors de la reconnexion :
```
[OFFLINE-REC] Connexion rétablie — synchronisation
[SYNC] 3 fichier(s) à envoyer
[SYNC] ✅ 20240501_143022.mp4
[SYNC] ✅ 20240501_143052.mp4
[SYNC] ✅ 20240501_143122.mp4
```

---

## 2. Côté serveur (déjà implémenté)

Ces modifications sont déjà appliquées dans le code source :

| Fichier | Modification |
|---|---|
| `server/src/routes/cameraNodes.js` | Endpoint `POST /:deviceId/upload-recording` avec multer |
| `server/src/db/index.js` | Colonnes `offline_recording` et `recording_path` sur `camera_node_motion_events` |
| `client/src/components/CameraFeed.tsx` | Badge "HORS LIGNE" dans l'historique mouvement |
| `client/src/App.css` | Style du badge et bordure orange sur les events hors ligne |

Les clips uploadés sont stockés dans `recordings/offline/` sur le serveur.

---

## 3. Dépannage

**`libcamera-vid: command not found`**
```bash
sudo apt install libcamera-apps
```

**`requests` module absent**
```bash
pip3 install requests
```

**Vérifier les clips en attente sur le Pi**
```bash
ls -lh /home/picam/offline_recordings/
```

**Forcer une synchronisation manuelle**
```bash
SERVER_URL=http://192.168.0.47:3001 DEVICE_ID=picam python3 /home/picam/offline_recorder.py
```

**Tester l'endpoint depuis le serveur**
```bash
curl -F "recording=@test.mp4" \
     -F "detectedAt=2024-05-01T14:30:00" \
     http://localhost:3001/api/camera-nodes/picam/upload-recording
```
