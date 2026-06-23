#!/usr/bin/env python3
"""
Sentys Agent — Pi Zero 2W (mode on-demand)
MediaMTX démarre sur signal wake (clic utilisateur) ou détection de mouvement.
S'arrête sur signal sleep ou inactivité. Mode hors-ligne : enregistrement local + sync.
"""

import os
import time
import socket
import subprocess
from pathlib import Path
from datetime import datetime

import requests

# ─── Configuration ────────────────────────────────────────────────────────────
SERVER_URL        = "http://192.168.0.47:4000"  # adresse du serveur Node.js
DEVICE_MODEL      = "Raspberry Pi Zero"
RECORD_DIR        = Path(f"/home/{os.getenv('USER', 'picam')}/offline_recordings")  # dossier clips hors-ligne
CLIP_DURATION_SEC = 30          # durée d'un clip offline en secondes
ANNOUNCE_INTERVAL = 30          # fréquence d'annonce au serveur (secondes)
CHECK_INTERVAL    = 10          # intervalle de vérification connectivité
MAX_STORAGE_MB    = 500         # stockage max des clips sur la carte SD
RTSP_PORT         = 8554        # port MediaMTX
RTSP_PATH         = "cam1"      # nom du flux RTSP

# Détection de mouvement
MOTION_SNAPSHOT_INTERVAL = 1    # une photo par seconde en mode IDLE
MOTION_THRESHOLD         = 25   # différence de pixel pour considérer un changement
MOTION_MIN_PIXELS        = 300  # nombre min de pixels changés pour déclencher
STREAM_IDLE_TIMEOUT      = 60   # arrêt auto après 60s sans mouvement
WAKE_STREAM_TIMEOUT      = 300  # arrêt auto après 5min si réveil manuel
SNAPSHOT_WIDTH           = 320  # résolution réduite pour économiser le CPU
SNAPSHOT_HEIGHT          = 240
SNAPSHOT_DIR             = Path('/tmp/sentys_snapshots')  # stockage temporaire snapshots

# Backoff exponentiel : si le serveur ne répond pas, on attend de plus en plus longtemps
SERVER_CHECK_INTERVAL_ONLINE  = 10   # vérification toutes les 10s si en ligne
SERVER_CHECK_INTERVAL_MIN     = 10
SERVER_CHECK_INTERVAL_MAX     = 120  # max 2min entre deux vérifications hors-ligne

# ─── Identité unique par Pi ────────────────────────────────────────────────────
_HOME      = Path(f"/home/{os.getenv('USER', 'picam')}")
_CONF_PATH = _HOME / "device.conf"  # fichier de config local : DEVICE_ID, DEVICE_NAME, etc.

def _load_device_conf():
    """Lit device.conf pour récupérer l'identité du Pi (DEVICE_ID, DEVICE_NAME, DEVICE_LOCATION)."""
    conf = {}
    if not _CONF_PATH.exists():
        return conf
    try:
        for line in _CONF_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if k:
                conf[k] = v
    except Exception as e:
        print(f"[CONFIG] Impossible de lire {_CONF_PATH} : {e}")
    return conf

_conf           = _load_device_conf()
DEVICE_ID       = _conf.get("DEVICE_ID") or f"pi-{socket.gethostname()}"   # ex: "pi-salon"
DEVICE_NAME     = _conf.get("DEVICE_NAME") or socket.gethostname()
DEVICE_LOCATION = _conf.get("DEVICE_LOCATION", "")

RECORD_DIR.mkdir(parents=True, exist_ok=True)
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

MIN_CLIP_SIZE = 50 * 1024  # 50 Ko minimum — clips plus petits = enregistrement raté


def fetch_remote_config():
    """Récupère la config depuis le serveur (durée clip, port RTSP, seuils mouvement...).
    Permet de modifier les paramètres du Pi depuis l'interface web sans SSH."""
    global DEVICE_NAME, DEVICE_LOCATION, CLIP_DURATION_SEC, MAX_STORAGE_MB
    global ANNOUNCE_INTERVAL, RTSP_PORT, RTSP_PATH
    global MOTION_SNAPSHOT_INTERVAL, MOTION_THRESHOLD, MOTION_MIN_PIXELS, STREAM_IDLE_TIMEOUT, WAKE_STREAM_TIMEOUT
    try:
        r = requests.get(f"{SERVER_URL}/api/camera-nodes/{DEVICE_ID}/config", timeout=5)
        if r.status_code == 200:
            cfg = r.json()
            DEVICE_NAME              = cfg.get("name",             DEVICE_NAME)
            DEVICE_LOCATION          = cfg.get("location",         DEVICE_LOCATION)
            CLIP_DURATION_SEC        = int(cfg.get("clipDuration", CLIP_DURATION_SEC))
            MAX_STORAGE_MB           = int(cfg.get("maxStorageMb", MAX_STORAGE_MB))
            ANNOUNCE_INTERVAL        = int(cfg.get("announceInterval", ANNOUNCE_INTERVAL))
            RTSP_PORT                = int(cfg.get("rtspPort",     RTSP_PORT))
            RTSP_PATH                = cfg.get("rtspPath",         RTSP_PATH)
            MOTION_SNAPSHOT_INTERVAL = int(cfg.get("motionSnapshotInterval", MOTION_SNAPSHOT_INTERVAL))
            MOTION_THRESHOLD         = int(cfg.get("motionThreshold",        MOTION_THRESHOLD))
            MOTION_MIN_PIXELS        = int(cfg.get("motionMinPixels",        MOTION_MIN_PIXELS))
            STREAM_IDLE_TIMEOUT      = int(cfg.get("streamIdleTimeout",      STREAM_IDLE_TIMEOUT))
            WAKE_STREAM_TIMEOUT      = int(cfg.get("wakeStreamTimeout",      WAKE_STREAM_TIMEOUT))
            print("[CONFIG] Config chargée depuis le serveur")
    except Exception as e:
        print(f"[CONFIG] Impossible de charger la config distante : {e}")


def enforce_storage_limit():
    """Supprime les clips les plus anciens si le stockage dépasse MAX_STORAGE_MB.
    Evite de remplir la carte SD du Pi."""
    try:
        files = sorted(RECORD_DIR.glob("*.mp4"), key=lambda f: f.stat().st_mtime)
    except Exception:
        return
    total = sum(f.stat().st_size for f in files if f.exists())
    limit = MAX_STORAGE_MB * 1024 * 1024
    while total > limit and files:
        oldest = files.pop(0)
        try:
            freed = oldest.stat().st_size
            oldest.unlink()
            total -= freed
            print(f"[STORAGE] {oldest.name} supprimé ({freed // 1024 // 1024} Mo libérés)")
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"[STORAGE] {oldest.name} : {e}")


def get_local_ip():
    """Récupère l'IP locale du Pi en ouvrant une socket UDP vers le serveur.
    Astuce : pas besoin d'envoyer de données, connect() suffit pour connaître l'IP source."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.0.47", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def server_reachable():
    """Vérifie si le serveur Node.js répond sur /api/health (timeout 3s)."""
    try:
        r = requests.get(f"{SERVER_URL}/api/health", timeout=3)
        return r.status_code < 500
    except Exception:
        return False


def announce(ip):
    """Annonce la présence du Pi au serveur toutes les 30s.
    Envoie deviceId, host, streamUrl → insère dans camera_nodes et camera_discoveries."""
    payload = {
        "deviceId":  DEVICE_ID,
        "name":      DEVICE_NAME,
        "host":      ip,
        "streamUrl": f"rtsp://{ip}:{RTSP_PORT}/{RTSP_PATH}",
        "model":     DEVICE_MODEL,
        "location":  DEVICE_LOCATION,
        "source":    "pi-node",
    }
    try:
        r = requests.post(f"{SERVER_URL}/api/camera-nodes/announce", json=payload, timeout=5)
        if r.status_code == 200:
            print(f"[ANNOUNCE] Noeud annoncé ({ip})")
        else:
            print(f"[ANNOUNCE] HTTP {r.status_code}")
    except Exception as e:
        print(f"[ANNOUNCE] {e}")
    try:
        # Double annonce aussi dans camera_discoveries (table de staging)
        requests.post(f"{SERVER_URL}/api/cameras/announce", json=payload, timeout=5)
    except Exception:
        pass


def clean_shm():
    """Supprime les fichiers temporaires de MediaMTX dans /dev/shm.
    Nécessaire pour éviter les conflits lors du redémarrage de MediaMTX."""
    try:
        import glob
        dirs = glob.glob('/dev/shm/mediamtx-rpicamera-*')
        if dirs:
            for d in dirs:
                try:
                    subprocess.run(['sudo', 'rm', '-rf', d], timeout=5, capture_output=True)
                except Exception:
                    pass
            print(f"[SHM] {len(dirs)} répertoire(s) MediaMTX supprimé(s) de /dev/shm")
    except Exception as e:
        print(f"[SHM] clean_shm : {e}")


def release_camera(kill_rpicam_jpeg: bool = True):
    """Libère le module caméra en tuant tous les processus qui l'utilisent.
    La caméra CSI ne peut être utilisée que par un seul processus à la fois."""
    # Tue les processus MediaMTX et rpicam
    patterns = ['mtxrpicam', 'rpicam-vid']
    if kill_rpicam_jpeg:
        patterns.append('rpicam-jpeg')
    for pattern in patterns:
        try:
            subprocess.run(['sudo', 'pkill', '-9', '-f', pattern],
                           capture_output=True, timeout=3)
        except Exception:
            pass

    # Force la libération des devices vidéo (/dev/video0, /dev/media0...)
    devices = ['/dev/media0', '/dev/media1', '/dev/media2', '/dev/video0']
    existing = [d for d in devices if Path(d).exists()]
    if existing:
        try:
            result = subprocess.run(
                ['sudo', 'fuser'] + existing,
                capture_output=True, text=True, timeout=5,
            )
            pids = result.stdout.split() + result.stderr.split()
            pids = list({p.strip() for p in pids if p.strip().isdigit()})
            for pid in pids:
                try:
                    subprocess.run(['sudo', 'kill', '-9', pid], timeout=3)
                    print(f"[CAM] Processus {pid} tué (caméra libérée)")
                except Exception:
                    pass
        except Exception as e:
            print(f"[CAM] release_camera fuser : {e}")

    clean_shm()
    time.sleep(0.5)


def set_mediamtx(active: bool):
    """Démarre ou arrête le service MediaMTX via systemctl.
    MediaMTX = serveur RTSP qui publie le flux de la caméra sur le réseau."""
    action = 'start' if active else 'stop'
    try:
        subprocess.run(['sudo', 'systemctl', action, 'mediamtx'], check=True, timeout=10)
        print(f"[MEDIAMTX] MediaMTX {action}")
    except Exception as e:
        print(f"[MEDIAMTX] Impossible de {action} MediaMTX : {e}")


def wait_for_rtsp_path(max_wait: int = 20) -> bool:
    """Attend que le flux RTSP soit prêt dans MediaMTX (max 20s).
    Interroge l'API REST locale de MediaMTX sur le port 9997."""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            r = requests.get(
                f"http://localhost:9997/v3/paths/get/{RTSP_PATH}",
                timeout=2,
            )
            if r.status_code == 200 and r.json().get("ready") is True:
                elapsed = round(time.time() - (deadline - max_wait), 1)
                print(f"[MEDIAMTX] Path /{RTSP_PATH} prêt ({elapsed}s)")
                return True
        except Exception:
            pass
        time.sleep(0.5)
    print(f"[MEDIAMTX] Path /{RTSP_PATH} non ready après {max_wait}s")
    return False


def start_stream():
    """Démarre le streaming complet : libère la caméra → démarre MediaMTX → attend que le flux soit prêt."""
    release_camera()
    set_mediamtx(True)
    return wait_for_rtsp_path()


def stop_stream():
    """Arrête MediaMTX et nettoie les ressources."""
    set_mediamtx(False)
    try:
        subprocess.run(['sudo', 'pkill', '-9', '-f', 'mtxrpicam'], capture_output=True, timeout=3)
    except Exception:
        pass
    clean_shm()


def notify_motion(active: bool):
    """Notifie le serveur qu'un mouvement a été détecté (ou terminé).
    Le serveur met à jour camera_nodes.last_motion_at et affiche le badge dans le dashboard."""
    try:
        r = requests.post(
            f"{SERVER_URL}/api/camera-nodes/motion",
            json={"deviceId": DEVICE_ID, "motion": active},
            timeout=5,
        )
        if r.status_code == 200:
            print(f"[MOTION] Serveur notifié ({'actif' if active else 'inactif'})")
        else:
            print(f"[MOTION] HTTP {r.status_code}")
    except Exception as e:
        print(f"[MOTION] Impossible de notifier le serveur : {e}")


def check_wake_signal() -> bool:
    """Vérifie si l'interface web a demandé le réveil du Pi (clic sur Start).
    Le serveur maintient un flag en mémoire par device_id."""
    try:
        r = requests.get(
            f"{SERVER_URL}/api/camera-nodes/{DEVICE_ID}/wake",
            timeout=3,
        )
        if r.status_code == 200:
            return r.json().get("wake", False)
    except Exception:
        pass
    return False


def check_sleep_signal() -> bool:
    """Vérifie si l'interface web a demandé l'arrêt du stream (clic sur Stop)."""
    try:
        r = requests.get(
            f"{SERVER_URL}/api/camera-nodes/{DEVICE_ID}/sleep",
            timeout=3,
        )
        if r.status_code == 200:
            return r.json().get("sleep", False)
    except Exception:
        pass
    return False


def capture_snapshot(out_path: Path) -> bool:
    """Prend une photo 320x240 avec rpicam-jpeg en 300ms.
    Résolution réduite intentionnellement pour économiser le CPU du Pi Zero 2W."""
    try:
        subprocess.run(
            ['rpicam-jpeg', '-t', '300', '--nopreview',
             '--width', str(SNAPSHOT_WIDTH), '--height', str(SNAPSHOT_HEIGHT),
             '-o', str(out_path)],
            check=True, timeout=4,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return True
    except Exception as e:
        print(f"[SNAPSHOT] Échec capture : {e}")
        return False


def images_differ(path_a: Path, path_b: Path) -> bool:
    """Compare deux snapshots pixel par pixel en niveaux de gris.
    Retourne True si plus de MOTION_MIN_PIXELS pixels ont changé de plus de MOTION_THRESHOLD.
    Niveaux de gris = 3x moins de données à traiter (1 canal au lieu de RGB)."""
    try:
        from PIL import Image
        import numpy as np
        # Conversion en niveaux de gris pour réduire la charge CPU
        img_a = np.array(Image.open(path_a).convert('L'), dtype=np.int16)
        img_b = np.array(Image.open(path_b).convert('L'), dtype=np.int16)
        # Compte les pixels dont la différence dépasse le seuil
        changed = int(np.sum(np.abs(img_a - img_b) > MOTION_THRESHOLD))
        return changed > MOTION_MIN_PIXELS
    except ImportError:
        # Fallback si PIL/numpy non installé : compare juste la taille des fichiers
        try:
            return abs(path_a.stat().st_size - path_b.stat().st_size) > 3000
        except Exception:
            return False
    except Exception:
        return False


def record_offline_clip(out: Path) -> bool:
    """Enregistre un clip H.264 brut avec rpicam-vid puis le remuxe en MP4 via ffmpeg.
    +faststart = les métadonnées MP4 au début du fichier pour lecture immédiate."""
    h264_out = out.with_suffix('.h264')
    try:
        # Enregistrement H.264 brut (encodage hardware sur le chip Pi)
        subprocess.run(
            ['rpicam-vid', '-t', str(CLIP_DURATION_SEC * 1000),
             '--codec', 'h264', '--width', '1280', '--height', '720',
             '--inline', '-o', str(h264_out)],
            check=True, timeout=CLIP_DURATION_SEC + 10,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        print(f"[MOTION] Échec rpicam-vid : {e}")
        try: h264_out.unlink()
        except: pass
        return False

    try:
        # Remuxage en MP4 valide sans réencodage (-c:v copy)
        subprocess.run(
            ['ffmpeg', '-y', '-f', 'h264', '-i', str(h264_out),
             '-c:v', 'copy', '-movflags', '+faststart', str(out)],
            check=True, timeout=30,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        print(f"[MOTION] Échec ffmpeg remux : {e}")
        try: out.unlink()
        except: pass
        return False
    finally:
        try: h264_out.unlink()  # supprime le H.264 brut intermédiaire
        except: pass

    # Vérifie que le fichier existe et est assez grand (> 50 Ko)
    return out.exists() and out.stat().st_size >= MIN_CLIP_SIZE


def upload_pending():
    """Envoie tous les clips MP4 en attente au serveur après reconnexion.
    Supprime chaque clip après upload réussi. S'arrête à la première erreur réseau."""
    files = sorted(RECORD_DIR.glob("*.mp4"))
    if not files:
        return

    # Filtre les clips trop petits (enregistrements ratés)
    valid = []
    for f in files:
        try:
            size = f.stat().st_size
        except FileNotFoundError:
            continue
        if size < MIN_CLIP_SIZE:
            print(f"[SYNC] {f.name} trop petit ({size} o) — supprimé")
            try: f.unlink()
            except: pass
        else:
            valid.append(f)

    if not valid:
        return

    print(f"[SYNC] {len(valid)} fichier(s) à envoyer au serveur")
    for f in valid:
        # Extrait la date depuis le nom de fichier (format YYYYMMDD_HHMMSS)
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
                print(f"[SYNC] {f.name} -> serveur (URL: {r.json().get('url', '?')})")
                try: f.unlink()  # supprime le clip local après upload réussi
                except: pass
            else:
                print(f"[SYNC] {f.name} — HTTP {r.status_code}: {r.text[:200]}")
                break  # arrêt si le serveur refuse (évite de spammer)
        except Exception as e:
            print(f"[SYNC] {f.name} — {e}")
            break  # arrêt si erreur réseau


# ─── Boucle principale ─────────────────────────────────────────────────────────

def main():
    print(f"[SENTYS] Démarré | serveur={SERVER_URL} | device={DEVICE_ID}")
    # Nettoyage au démarrage : s'assure que MediaMTX est arrêté
    set_mediamtx(False)
    release_camera()

    was_offline        = False   # True si le serveur était injoignable au dernier check
    last_announce      = 0.0     # timestamp de la dernière annonce
    server_loss_streak = 0       # compteur de checks consécutifs sans serveur

    last_server_check      = 0.0
    server_check_interval  = SERVER_CHECK_INTERVAL_ONLINE
    online                 = False

    stream_state       = 'IDLE'  # état courant : 'IDLE' ou 'STREAMING'
    last_motion_time   = 0.0     # timestamp du dernier mouvement détecté
    stream_start_time  = 0.0     # timestamp du démarrage du stream (pour timeout wake)
    snap_a             = SNAPSHOT_DIR / 'snap_a.jpg'
    snap_b             = SNAPSHOT_DIR / 'snap_b.jpg'
    snap_toggle        = False   # alterne entre snap_a et snap_b pour comparer
    prev_snap          = None    # snapshot précédent pour comparaison
    last_wake_check    = 0.0
    WAKE_CHECK_INTERVAL   = 0.5  # vérifie le signal wake toutes les 500ms
    SERVER_LOSS_TOLERANCE = 3    # attend 3 échecs consécutifs avant d'arrêter le stream
    wake_mode = False            # True si démarré manuellement depuis le dashboard

    # Vérification initiale de connectivité
    online = server_reachable()
    last_server_check = time.time()

    if online:
        fetch_remote_config()  # charge la config distante au démarrage
        server_check_interval = SERVER_CHECK_INTERVAL_ONLINE

    # Synchronise les clips en attente si présents au démarrage
    if list(RECORD_DIR.glob("*.mp4")) and online:
        print("[SENTYS] Clips en attente au démarrage — synchronisation")
        upload_pending()

    while True:
        ip  = get_local_ip()
        now = time.time()

        # ── Vérification connectivité avec backoff exponentiel ────────────────
        # Si hors-ligne, double l'intervalle à chaque échec (10s → 20s → 40s → max 120s)
        if now - last_server_check >= server_check_interval:
            online = server_reachable()
            last_server_check = now
            if online:
                server_check_interval = SERVER_CHECK_INTERVAL_ONLINE
            else:
                server_check_interval = min(server_check_interval * 2, SERVER_CHECK_INTERVAL_MAX)

        # ── Reconnexion serveur ────────────────────────────────────────────────
        if online and was_offline:
            print("[SENTYS] Connexion rétablie — synchronisation des clips hors-ligne")
            fetch_remote_config()
            server_loss_streak    = 0
            server_check_interval = SERVER_CHECK_INTERVAL_ONLINE
            if stream_state != 'STREAMING':
                upload_pending()  # envoie les clips enregistrés pendant la coupure
            was_offline = False

        if not online:
            if not was_offline:
                print("[SENTYS] Serveur injoignable — passage en mode hors-ligne")
            was_offline = True

            # Si on streamait, attend SERVER_LOSS_TOLERANCE échecs avant d'arrêter
            # Evite d'arrêter le stream pour une micro-coupure réseau
            if stream_state == 'STREAMING':
                server_loss_streak += 1
                if server_loss_streak < SERVER_LOSS_TOLERANCE:
                    print(f"[SENTYS] Serveur injoignable ({server_loss_streak}/{SERVER_LOSS_TOLERANCE}) — on attend")
                    time.sleep(CHECK_INTERVAL)
                    continue
                print("[SENTYS] Serveur perdu — arrêt MediaMTX")
                stop_stream()
                server_loss_streak = 0
                stream_state = 'IDLE'
                wake_mode    = False
                prev_snap    = None
                time.sleep(3)
                continue

        # ── Annonce périodique ─────────────────────────────────────────────────
        if online and ip and now - last_announce >= ANNOUNCE_INTERVAL:
            announce(ip)
            last_announce = now

        # ── État IDLE : snapshots + écoute wake ───────────────────────────────
        if stream_state == 'IDLE':

            # Vérifie toutes les 500ms si l'utilisateur a cliqué Start dans le dashboard
            if online and now - last_wake_check >= WAKE_CHECK_INTERVAL:
                last_wake_check = now
                if check_wake_signal():
                    print("[WAKE] Démarrage demandé par l'interface web")
                    ready = start_stream()
                    if ready:
                        notify_motion(True)
                        stream_state      = 'STREAMING'
                        wake_mode         = True   # démarrage manuel → timeout de 5min
                        last_motion_time  = now
                        stream_start_time = now
                    else:
                        print("[WAKE] MediaMTX non prêt — retour en veille")
                        stop_stream()
                    continue

            # Alterne entre snap_a et snap_b pour toujours avoir deux snapshots à comparer
            cur_snap    = snap_b if snap_toggle else snap_a
            snap_toggle = not snap_toggle

            if capture_snapshot(cur_snap):
                if prev_snap is not None and prev_snap.exists():
                    if images_differ(prev_snap, cur_snap):
                        print("[MOTION] Mouvement détecté !")
                        last_motion_time = now

                        if online:
                            # En ligne : démarre le stream pour que le serveur analyse le flux
                            ready = start_stream()
                            notify_motion(True)
                            stream_state = 'STREAMING'
                            wake_mode    = False
                        else:
                            # Hors-ligne : enregistre directement sur la carte SD
                            print("[MOTION] Mode hors-ligne — enregistrement local")
                            enforce_storage_limit()
                            ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
                            out = RECORD_DIR / f"{ts}.mp4"
                            if record_offline_clip(out):
                                print(f"[MOTION] Clip enregistré : {out.name}")
                            else:
                                print(f"[MOTION] Échec enregistrement")
                                try:
                                    if out.exists(): out.unlink()
                                except Exception:
                                    pass
                            prev_snap = None
                            continue

                prev_snap = cur_snap
            else:
                release_camera(kill_rpicam_jpeg=False)
                continue

            time.sleep(MOTION_SNAPSHOT_INTERVAL)  # attend 1s avant le prochain snapshot

        # ── État STREAMING ─────────────────────────────────────────────────────
        elif stream_state == 'STREAMING':

            # Vérifie si l'utilisateur a cliqué Stop dans le dashboard
            if online and check_sleep_signal():
                print("[SLEEP] Arrêt demandé par l'interface web")
                stop_stream()
                notify_motion(False)
                stream_state = 'IDLE'
                wake_mode    = False
                prev_snap    = None
                snap_toggle  = False
                if list(RECORD_DIR.glob("*.mp4")):
                    upload_pending()
                time.sleep(3)
                continue

            if wake_mode:
                # Démarrage manuel : arrêt automatique après WAKE_STREAM_TIMEOUT (5min)
                if now - stream_start_time > WAKE_STREAM_TIMEOUT:
                    print(f"[WAKE] {WAKE_STREAM_TIMEOUT}s écoulés — arrêt automatique")
                    stop_stream()
                    if online:
                        notify_motion(False)
                    stream_state = 'IDLE'
                    wake_mode    = False
                    prev_snap    = None
                    snap_toggle  = False
                    time.sleep(3)
                else:
                    time.sleep(2)
            else:
                # Démarrage sur mouvement : arrêt si plus aucun mouvement depuis 60s
                if now - last_motion_time > STREAM_IDLE_TIMEOUT:
                    print(f"[MOTION] {STREAM_IDLE_TIMEOUT}s sans mouvement — arrêt MediaMTX")
                    stop_stream()
                    if online:
                        notify_motion(False)
                    stream_state = 'IDLE'
                    prev_snap    = None
                    snap_toggle  = False
                    if online and list(RECORD_DIR.glob("*.mp4")):
                        upload_pending()
                    time.sleep(3)
                else:
                    time.sleep(2)


if __name__ == "__main__":
    main()
