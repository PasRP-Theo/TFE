# Pi Zero 2W — Installation complète

## Architecture

```
[GitHub] → [CI/CD] → [Serveur Host :4000]
                           │
                  sert /api/agent/sentys_agent.py
                           │
              [Pi Zero 2W] ──cron 5min──→ télécharge & redémarre si diff
                    │
              sentys-agent.service (tourne en permanence)
                    │
        ┌───────────┴───────────┐
        │                       │
  Snapshots (veille)     Wake signal reçu
  rpicam-jpeg            ou mouvement détecté
        │                       │
  Mouvement ?          MediaMTX démarre
        │                       │
       Oui              RTSP prêt (2s)
        │                       │
  MediaMTX démarre      notify_motion(True)
        │                       │
  notify_motion(True)   Serveur lance FFmpeg
        │                       │
  Serveur lance FFmpeg   HLS → Interface web
```

### Flux wake/sleep (clic utilisateur)
```
Interface [START] → serveur status=reconnecting + signal wake
  → Pi démarre MediaMTX → attend RTSP prêt → notify_motion(True)
  → serveur démarre FFmpeg → flux visible en ~4s
Interface [STOP] → serveur arrête FFmpeg + signal sleep
  → Pi arrête MediaMTX → retour snapshots
```

### Flux mouvement automatique
```
Pi détecte différence entre 2 snapshots (toutes les 1s)
  → MediaMTX démarre → notify_motion(True) → FFmpeg démarre
  → 60s sans nouveau mouvement → MediaMTX s'arrête → FFmpeg s'arrête
```

---

## Prérequis matériel

- Raspberry Pi Zero 2W
- Module caméra OV5647 (ou compatible)
- Câble nappe **15 broches 1mm des deux côtés** (spécifique Pi Zero, pas le câble Pi 3/4)

---

## Étape 1 — Brancher et activer la caméra

### Câblage
- Soulever le loquet CSI, insérer le câble nappe, refermer
- Contacts dorés **face vers le bas** côté Pi Zero, **face vers le haut** côté module

### Activer l'overlay OV5647
```bash
sudo nano /boot/firmware/config.txt
```
Vérifier que ces lignes sont présentes (les ajouter si manquantes) :
```
camera_auto_detect=1
dtoverlay=ov5647
```
```bash
sudo reboot
```

### Vérifier la détection
```bash
rpicam-hello --list-cameras
# Attendu : 0 : ov5647 [2592x1944 ...]
```

Si la commande n'existe pas :
```bash
sudo apt update && sudo apt install -y libcamera-apps
```

Si la caméra n'est pas détectée après reboot :
```bash
dmesg | grep -i -E "csi|ov5647"
# Doit afficher des lignes avec "ov5647@36"
```
Si rien → vérifier le câblage physique.

---

## Étape 2 — Installer les dépendances Python

```bash
sudo apt install -y python3-requests
```

---

## Étape 3 — Installer MediaMTX

```bash
wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.1/mediamtx_v1.9.1_linux_arm64v8.tar.gz
tar -xzf mediamtx_v1.9.1_linux_arm64v8.tar.gz
sudo mv mediamtx /usr/local/bin/
sudo mv mediamtx.yml /usr/local/etc/
rm mediamtx_v1.9.1_linux_arm64v8.tar.gz
```

### Configurer MediaMTX
```bash
sudo nano /usr/local/etc/mediamtx.yml
```

Deux choses à configurer :

**1. Activer l'API REST** (nécessaire pour que l'agent vérifie si le RTSP est prêt) :
```yaml
api: yes
```

**2. Configurer le flux caméra** — trouver la section `paths:` et remplacer par :
```yaml
paths:
  cam1:
    source: rpiCamera
    rpiCameraWidth: 1280
    rpiCameraHeight: 720
    rpiCameraFPS: 15
    rpiCameraBitrate: 500000
```

### Créer le service systemd MediaMTX

MediaMTX est géré **à la demande** par l'agent (démarré/arrêté selon le mouvement ou les clics
utilisateur). Le service systemd est créé **sans** `enable` — l'agent le contrôle via `systemctl start/stop`.

```bash
sudo nano /etc/systemd/system/mediamtx.service
```
```ini
[Unit]
Description=MediaMTX
After=network.target

[Service]
ExecStart=/usr/local/bin/mediamtx /usr/local/etc/mediamtx.yml
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
# Ne PAS faire systemctl enable — l'agent gère le démarrage
```

### Autoriser le contrôle sans mot de passe

L'agent a besoin de démarrer/arrêter MediaMTX, libérer la caméra et nettoyer `/dev/shm`.

```bash
sudo visudo
```
Ajouter à la fin (**remplacer `picam2` par le nom d'utilisateur réel**) :
```
picam2 ALL=(ALL) NOPASSWD: /bin/systemctl start mediamtx
picam2 ALL=(ALL) NOPASSWD: /bin/systemctl stop mediamtx
picam2 ALL=(ALL) NOPASSWD: /bin/systemctl restart mediamtx
picam2 ALL=(ALL) NOPASSWD: /usr/bin/pkill
picam2 ALL=(ALL) NOPASSWD: /bin/kill
picam2 ALL=(ALL) NOPASSWD: /usr/bin/fuser
picam2 ALL=(ALL) NOPASSWD: /bin/rm
```

> `pkill`, `fuser` et `rm` sont utilisés pour libérer la caméra et nettoyer `/dev/shm/mediamtx-rpicamera-*`
> avant chaque démarrage MediaMTX (évite "no space left on device").

---

## Étape 4 — Créer le fichier d'identité

Ce fichier n'est **jamais** écrasé par les mises à jour automatiques :
```bash
cat > ~/device.conf << 'EOF'
DEVICE_ID=pi-zero-02
DEVICE_NAME=Pi Zero 2W - Cam2
DEVICE_LOCATION=Entrée
EOF
```

> Chaque Pi doit avoir un `DEVICE_ID` unique (`pi-zero-01`, `pi-zero-02`, etc.).

---

## Étape 5 — Installer l'agent et le script de mise à jour

```bash
# Télécharger l'agent depuis le serveur
curl http://192.168.0.47:4000/api/agent/sentys_agent.py -o ~/sentys_agent.py

# Copier le script de mise à jour (depuis le PC, ou via scp)
scp pi/auto_update.sh picam2@<IP_PI>:~/auto_update.sh
chmod +x ~/auto_update.sh
```

---

## Étape 6 — Créer le service sentys-agent

```bash
sudo nano /etc/systemd/system/sentys-agent.service
```
```ini
[Unit]
Description=Sentys Camera Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=picam2
WorkingDirectory=/home/picam2
ExecStart=/usr/bin/python3 /home/picam2/sentys_agent.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable sentys-agent
sudo systemctl start sentys-agent

# Vérifier
sudo systemctl status sentys-agent
```

---

## Étape 7 — Ajouter le cron de mise à jour automatique

```bash
crontab -e
```
Ajouter à la fin :
```
*/5 * * * * /home/picam2/auto_update.sh >> /home/picam2/update.log 2>&1
```

> Toutes les 5 minutes, le Pi télécharge la dernière version de `sentys_agent.py` depuis le serveur.
> Si le fichier a changé (checksum différent), il remplace l'ancien et redémarre le service.
> Le fichier `device.conf` n'est jamais touché.

---

## Étape 8 — Ajouter la caméra dans l'interface

Dans l'interface Sentys, ajouter une caméra avec l'URL RTSP :
```
rtsp://<IP_PI>:8554/cam1
```

Le Pi annonce automatiquement son existence au serveur toutes les 30 secondes — la caméra
apparaît aussi dans la liste de découverte réseau.

---

## Noms d'utilisateur selon le Pi

| Pi | Utilisateur | Home |
|---|---|---|
| Pi Zero 2W #1 | `picam` | `/home/picam` |
| Pi Zero 2W #2 | `picam2` | `/home/picam2` |

Adapter **tous les chemins**, le `User=` dans les services systemd, et les lignes visudo.

---

## Flux de déploiement après installation

```
1. Modifier sentys_agent.py sur le PC
2. git push → pipeline CI/CD déploie sur le serveur host
3. Dans les 5 minutes, chaque Pi télécharge la nouvelle version automatiquement
4. Le service sentys-agent redémarre si le fichier a changé
```

Aucune intervention manuelle sur les Pi nécessaire après l'installation initiale.

---

## Dépannage

### Commandes utiles
```bash
# Logs de l'agent en direct
sudo journalctl -u sentys-agent -f

# Logs MediaMTX en direct
sudo journalctl -u mediamtx -f

# Logs serveur (depuis le serveur host)
pm2 logs sentys --lines 0

# Statut des services
sudo systemctl status sentys-agent
sudo systemctl status mediamtx

# Vérifier que le RTSP est prêt (quand MediaMTX tourne)
curl -s http://localhost:9997/v3/paths/get/cam1 | python3 -m json.tool | grep ready

# Vérifier l'espace /dev/shm
df -h /dev/shm
ls /dev/shm/

# Nettoyer /dev/shm manuellement
sudo rm -rf /dev/shm/mediamtx-rpicamera-*

# Vérifier la caméra
rpicam-hello --list-cameras

# Logs des mises à jour automatiques
cat ~/update.log

# Forcer une mise à jour immédiate de l'agent
~/auto_update.sh
```

---

### Caméra non détectée (`No cameras available!`)
1. Vérifier le câblage (loquet bien fermé des deux côtés, contacts dans le bon sens)
2. Vérifier que `dtoverlay=ov5647` est dans `/boot/firmware/config.txt`
3. Rebooter et relancer `dmesg | grep -i ov5647`

---

### Stream en reconnexion permanente (`404 Not Found` dans les logs serveur)

MediaMTX ne publie pas le flux. Vérifier :
```bash
sudo systemctl status mediamtx
sudo journalctl -u mediamtx -n 50
```

Causes fréquentes :

**`no space left on device`** sur `/dev/shm` → MediaMTX ne peut pas extraire `libcamera.so` :
```bash
df -h /dev/shm        # si > 90% → nettoyer
sudo rm -rf /dev/shm/mediamtx-rpicamera-*
sudo systemctl restart mediamtx
```
L'agent nettoie automatiquement `/dev/shm` avant chaque démarrage MediaMTX depuis la version actuelle.

**`api: no`** dans mediamtx.yml → l'agent ne peut pas vérifier si le RTSP est prêt :
```bash
sudo sed -i 's/^api: no/api: yes/' /usr/local/etc/mediamtx.yml
sudo systemctl restart mediamtx
```

**Caméra déjà utilisée par un autre processus** :
```bash
sudo fuser /dev/media0 /dev/media1 /dev/video0
sudo pkill -9 -f rpicam
sudo systemctl restart sentys-agent
```

---

### `sudo: a terminal is required` dans les logs sentys-agent

Les lignes visudo sont manquantes ou incorrectes. Vérifier via `sudo visudo` que toutes les lignes
`NOPASSWD` pour `pkill`, `kill`, `fuser` et `rm` sont présentes (voir Étape 3).

---

### MediaMTX path jamais ready (`⚠ Path /cam1 non ready après 20s`)

1. Vérifier que `api: yes` est dans mediamtx.yml
2. Vérifier `/dev/shm` (voir ci-dessus)
3. Tester manuellement :
```bash
sudo systemctl start mediamtx
sleep 3
curl -s http://localhost:9997/v3/paths/get/cam1
# "ready": true attendu
```

---

### `sudo: a terminal is required` au restart du service

Ajouter dans visudo la permission pour `systemctl restart sentys-agent` :
```
picam2 ALL=(ALL) NOPASSWD: /bin/systemctl restart sentys-agent
```

---

## Variables de configuration (sentys_agent.py)

| Variable | Défaut | Description |
|---|---|---|
| `SERVER_URL` | `http://192.168.0.47:4000` | IP du serveur host |
| `RTSP_PORT` | `8554` | Port MediaMTX |
| `RTSP_PATH` | `cam1` | Chemin du flux RTSP |
| `ANNOUNCE_INTERVAL` | `30` | Secondes entre chaque annonce au serveur |
| `MOTION_SNAPSHOT_INTERVAL` | `1` | Secondes entre chaque snapshot en veille |
| `MOTION_THRESHOLD` | `25` | Différence par pixel pour détecter un changement |
| `MOTION_MIN_PIXELS` | `300` | Pixels différents minimum pour déclencher |
| `STREAM_IDLE_TIMEOUT` | `60` | Secondes sans mouvement avant d'arrêter MediaMTX |
| `CLIP_DURATION_SEC` | `30` | Durée d'un clip hors-ligne |
| `MAX_STORAGE_MB` | `500` | Stockage max clips hors-ligne |

> `DEVICE_ID`, `DEVICE_NAME` et `DEVICE_LOCATION` sont lus depuis `device.conf`
> et ne sont **jamais** écrasés par les mises à jour automatiques.
> Ces valeurs peuvent aussi être overridées depuis l'interface serveur (config distante).

---

## Optimisations autonomie (batterie 18650)

### /boot/firmware/config.txt
```ini
arm_freq=800         # CPU limité à 800MHz
#arm_boost=1         # boost CPU désactivé
dtoverlay=disable-bt # Bluetooth désactivé
```

### Services inutiles à désactiver
```bash
sudo systemctl disable avahi-daemon avahi-daemon.socket
sudo systemctl disable serial-getty@ttyAMA0
```

### mediamtx.yml — qualité réduite
```yaml
paths:
  cam1:
    source: rpiCamera
    rpiCameraWidth: 1280
    rpiCameraHeight: 720
    rpiCameraFPS: 15
    rpiCameraBitrate: 500000
```

### À NE PAS FAIRE — gpu_mem=16 casse la caméra
Ne jamais ajouter `gpu_mem=16` dans `/boot/firmware/config.txt` — libcamera nécessite
minimum 64MB de mémoire GPU. Symptôme : `camera_create(): selected camera is not available`.

### Gains estimés
| Optimisation | Gain |
|---|---|
| CPU 800MHz + arm_boost off | ~150mA |
| Bluetooth désactivé | ~10mA |
| Stream 720p15 au lieu de 1080p30 | ~100mA |
| MediaMTX on-demand (pas 24/7) | ~200mA en veille |
| **Autonomie estimée (2000mAh)** | **~4h en streaming, >12h en veille** |
