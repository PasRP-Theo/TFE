# Pi Zero 2W — Sentys Agent

## Architecture générale

```
[GitHub] --push--> [Pipeline CI/CD] --déploie--> [Serveur Host]
                                                       |
                                              sert /api/agent/sentys_agent.py
                                                       |
                                              [Pi Zero 2W] --cron toutes 5min--> télécharge & redémarre
```

Le Pi se met à jour **tout seul** : il télécharge la dernière version du script depuis le serveur host, compare avec sa version locale, et redémarre le service si une différence est détectée.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `sentys_agent.py` | Script principal — tourne en continu sur le Pi |
| `auto_update.sh` | Script de mise à jour automatique — lancé par cron |

---

## sentys_agent.py

Script unifié qui gère trois choses :

### 1. Annonce réseau
Toutes les 30 secondes, le Pi envoie son IP et son URL RTSP au serveur pour apparaître dans l'onglet **Annonces réseau** de l'interface.

### 2. Mode hors ligne
Quand le serveur est inaccessible :
- MediaMTX est arrêté (libère la caméra)
- Des clips de 30 secondes sont enregistrés localement dans `/home/picam/offline_recordings/`
- Le stockage est limité à 500 Mo (les plus anciens clips sont supprimés en premier)

### 3. Synchronisation au retour en ligne
Dès que le serveur est de nouveau accessible :
- MediaMTX est redémarré (flux RTSP disponible)
- Tous les clips en attente sont uploadés vers le serveur
- Ils apparaissent dans l'historique avec le badge **HORS LIGNE**
- Les clips vides ou corrompus (< 50 Ko) sont ignorés et supprimés

### Variables de configuration

Modifier en haut du fichier `sentys_agent.py` :

```python
SERVER_URL        = "http://192.168.0.47:4000"   # IP du serveur host
DEVICE_ID         = "pi-zero-01"                  # Identifiant unique du Pi
DEVICE_NAME       = "Pi Zero 2W"                  # Nom affiché dans l'interface
DEVICE_LOCATION   = "Entrée"                      # Zone (optionnel)
RTSP_PORT         = 8554
RTSP_PATH         = "cam1"
CLIP_DURATION_SEC = 30                            # Durée d'un clip hors ligne
ANNOUNCE_INTERVAL = 30                            # Secondes entre chaque annonce
MAX_STORAGE_MB    = 500                           # Stockage max clips hors ligne
```

---

## auto_update.sh

Script lancé automatiquement par cron toutes les **5 minutes**.

### Ce qu'il fait :
1. Télécharge `sentys_agent.py` depuis `http://192.168.0.47:4000/api/agent/sentys_agent.py`
2. Compare avec la version locale
3. Si différent → remplace le fichier et redémarre le service `sentys-agent`
4. Si identique → ne fait rien
5. Si serveur inaccessible → ignore silencieusement

### Log :
```bash
cat /home/picam/update.log
```

---

## Installation sur un nouveau Pi

### 1. Copier les fichiers (depuis ton PC)
```bash
scp pi/sentys_agent.py picam@<IP_PI>:/home/picam/sentys_agent.py
scp pi/auto_update.sh picam@<IP_PI>:/home/picam/auto_update.sh
```

### 2. Sur le Pi
```bash
chmod +x /home/picam/auto_update.sh
```

### 3. Créer le service systemd
```bash
sudo nano /etc/systemd/system/sentys-agent.service
```
Contenu :
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

### 4. Ajouter le cron de mise à jour
```bash
crontab -e
```
Ajouter :
```
*/5 * * * * /home/picam/auto_update.sh >> /home/picam/update.log 2>&1
```

---

## Flux de déploiement complet

```
1. Tu modifies sentys_agent.py sur ton PC
2. git push → pipeline GitHub déploie sur le serveur host
3. Dans les 5 minutes, le Pi télécharge la nouvelle version
4. Le service sentys-agent redémarre automatiquement
```

Aucune intervention manuelle sur le Pi nécessaire après l'installation initiale.

---

## Dépannage

```bash
# Voir les logs du service
sudo journalctl -u sentys-agent -f

# Voir les logs de mise à jour
cat /home/picam/update.log

# Forcer une mise à jour immédiate
/home/picam/auto_update.sh

# Redémarrer manuellement
sudo systemctl restart sentys-agent
```
