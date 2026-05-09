# Pi Zero 2W — Installation complète

## Architecture

```
[GitHub] → [CI/CD] → [Serveur Host :4000]
                           │
                  sert /api/agent/sentys_agent.py
                           │
              [Pi Zero 2W] ──cron 5min──→ télécharge & redémarre
                    │
              MediaMTX → flux RTSP → Serveur → HLS/WebRTC → Interface
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
Vérifier que ces deux lignes sont présentes (les ajouter si manquantes) :
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

### Configurer le flux caméra
```bash
sudo nano /usr/local/etc/mediamtx.yml
```
Trouver la section `paths:` et remplacer son contenu par :
```yaml
paths:
  cam1:
    source: rpiCamera
```

### Créer le service systemd MediaMTX
```bash
sudo nano /etc/systemd/system/mediamtx.service
```
```ini
[Unit]
Description=MediaMTX
After=network.target

[Service]
ExecStart=/usr/local/bin/mediamtx /usr/local/etc/mediamtx.yml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable mediamtx
sudo systemctl start mediamtx
```

### Autoriser le contrôle de MediaMTX sans mot de passe
```bash
sudo visudo
```
Ajouter à la fin (**remplacer `picam` par le nom d'utilisateur réel**) :
```
picam ALL=(ALL) NOPASSWD: /bin/systemctl start mediamtx, /bin/systemctl stop mediamtx, /bin/systemctl restart mediamtx
```

---

## Étape 4 — Copier les fichiers de l'agent

Depuis ton **PC Windows** (pas depuis le Pi) :
```bash
scp pi/sentys_agent.py picam@<IP_PI>:/home/picam/sentys_agent.py
scp pi/auto_update.sh picam@<IP_PI>:/home/picam/auto_update.sh
```
```bash
# Sur le Pi
chmod +x /home/picam/auto_update.sh
```

---

## Étape 5 — Créer le fichier d'identité

Sur le Pi — ce fichier n'est **jamais** écrasé par les mises à jour automatiques :
```bash
cat > /home/picam/device.conf << 'EOF'
DEVICE_ID=pi-zero-01
DEVICE_NAME=Pi Zero 2W - Cam1
DEVICE_LOCATION=Entrée
EOF
```

> Chaque Pi doit avoir un `DEVICE_ID` unique (`pi-zero-01`, `pi-zero-02`, etc.).

---

## Étape 6 — Créer le service sentys-agent

```bash
sudo nano /etc/systemd/system/sentys-agent.service
```
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
```

---

## Étape 7 — Ajouter le cron de mise à jour automatique

```bash
crontab -e
```
Ajouter à la fin :
```
*/5 * * * * /home/picam/auto_update.sh >> /home/picam/update.log 2>&1
```

> Le Pi télécharge la dernière version de `sentys_agent.py` depuis le serveur toutes les 5 minutes et redémarre le service si une différence est détectée.

---

## Étape 8 — Ajouter la caméra dans l'interface

Dans l'interface Sentys, ajouter une caméra avec l'URL RTSP :
```
rtsp://<IP_PI>:8554/cam1
```

Puis enregistrer le stream dans go2rtc depuis le serveur host :
```bash
curl -X POST http://192.168.0.47:4000/api/webrtc/<ID_CAMERA>/register
```
L'ID caméra est visible dans l'URL de l'interface ou dans la base de données.

> **Note** : À partir du prochain redémarrage du serveur, l'enregistrement go2rtc est automatique.

---

## Noms d'utilisateur selon le Pi

| Pi | Utilisateur | Home |
|---|---|---|
| Pi Zero 2W #1 | `picam` | `/home/picam` |
| Pi Zero 2W #2 | `picam2` | `/home/picam2` |

Adapter **tous les chemins**, le `User=` dans le service systemd, et la ligne visudo en conséquence.

---

## Flux de déploiement après installation

```
1. Modifier sentys_agent.py sur le PC
2. git push → pipeline CI/CD déploie sur le serveur host
3. Dans les 5 minutes, chaque Pi télécharge la nouvelle version
4. Le service sentys-agent redémarre automatiquement
```

Aucune intervention manuelle sur les Pi nécessaire.

---

## Dépannage

### Commandes utiles
```bash
# Logs du service agent
sudo journalctl -u sentys-agent -f

# Logs MediaMTX
sudo journalctl -u mediamtx -f

# Statut des services
sudo systemctl status sentys-agent
sudo systemctl status mediamtx

# Logs des mises à jour automatiques
cat /home/picam/update.log

# Vérifier la caméra
rpicam-hello --list-cameras

# Vérifier que la caméra est vue par le kernel
dmesg | grep -i -E "csi|ov5647|camera"

# Forcer une mise à jour immédiate de l'agent
/home/picam/auto_update.sh

# Redémarrer manuellement
sudo systemctl restart sentys-agent
sudo systemctl restart mediamtx
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
sudo journalctl -u mediamtx -f
```
Causes fréquentes :
- **`no space left on device`** sur `/dev/shm` → nettoyer et redémarrer :
  ```bash
  sudo rm -rf /dev/shm/mediamtx-*
  sudo systemctl restart mediamtx
  ```
- **`write queue is full`** → trop de clients connectés simultanément. S'assurer qu'une seule entrée caméra dans l'interface pointe vers ce Pi.

---

### Erreur WebRTC 502 dans l'interface
go2rtc n'a pas le stream enregistré. Depuis le serveur host :
```bash
curl -X POST http://192.168.0.47:4000/api/webrtc/<ID_CAMERA>/register
```

---

### `sudo: a terminal is required` dans les logs sentys-agent
La ligne visudo est manquante. Ajouter via `sudo visudo` :
```
picam ALL=(ALL) NOPASSWD: /bin/systemctl start mediamtx, /bin/systemctl stop mediamtx, /bin/systemctl restart mediamtx
```

---

### `NameError: name 'RTSP_PORT' is not defined`
L'agent sur le Pi est une ancienne version. Recopier depuis le PC :
```bash
scp pi/sentys_agent.py picam@<IP_PI>:/home/picam/sentys_agent.py
```
Puis redémarrer :
```bash
sudo systemctl restart sentys-agent
```

---

## Variables de configuration (sentys_agent.py)

| Variable | Défaut | Description |
|---|---|---|
| `SERVER_URL` | `http://192.168.0.47:4000` | IP du serveur host |
| `RTSP_PORT` | `8554` | Port MediaMTX |
| `RTSP_PATH` | `cam1` | Chemin du flux RTSP |
| `CLIP_DURATION_SEC` | `30` | Durée d'un clip hors ligne |
| `ANNOUNCE_INTERVAL` | `30` | Secondes entre chaque annonce |
| `MAX_STORAGE_MB` | `500` | Stockage max clips hors ligne |

> `DEVICE_ID`, `DEVICE_NAME` et `DEVICE_LOCATION` sont lus depuis `device.conf` et ne sont **jamais** écrasés par les mises à jour automatiques.
