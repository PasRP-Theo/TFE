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
SERVER_URL        = "http://192.168.0.47:4000"
DEVICE_MODEL      = "Raspberry Pi Zero"
RECORD_DIR        = Path(f"/home/{os.getenv('USER', 'picam')}/offline_recordings")
CLIP_DURATION_SEC = 30
ANNOUNCE_INTERVAL = 30
CHECK_INTERVAL    = 10
MAX_STORAGE_MB    = 500
RTSP_PORT         = 8554
RTSP_PATH         = "cam1"

# Détection de mouvement
MOTION_SNAPSHOT_INTERVAL = 1
MOTION_THRESHOLD         = 25
MOTION_MIN_PIXELS        = 300
STREAM_IDLE_TIMEOUT      = 60
SNAPSHOT_WIDTH           = 320
SNAPSHOT_HEIGHT          = 240
SNAPSHOT_DIR             = Path('/tmp/sentys_snapshots')

# ─── Identité unique par Pi ────────────────────────────────────────────────────
_HOME      = Path(f"/home/{os.getenv('USER', 'picam')}")
_CONF_PATH = _HOME / "device.conf"

def _load_device_conf():
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
        print(f"[CONFIG] ⚠ Impossible de lire {_CONF_PATH} : {e}")
    return conf

_conf           = _load_device_conf()
DEVICE_ID       = _conf.get("DEVICE_ID") or f"pi-{socket.gethostname()}"
DEVICE_NAME     = _conf.get("DEVICE_NAME") or socket.gethostname()
DEVICE_LOCATION = _conf.get("DEVICE_LOCATION", "")
# ──────────────────────────────────────────────────────────────────────────────

RECORD_DIR.mkdir(parents=True, exist_ok=True)
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)


def fetch_remote_config():
    global DEVICE_NAME, DEVICE_LOCATION, CLIP_DURATION_SEC, MAX_STORAGE_MB
    global ANNOUNCE_INTERVAL, RTSP_PORT, RTSP_PATH
    global MOTION_SNAPSHOT_INTERVAL, MOTION_THRESHOLD, MOTION_MIN_PIXELS, STREAM_IDLE_TIMEOUT
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
            print("[CONFIG] ✅ Config chargée depuis le serveur")
    except Exception as e:
        print(f"[CONFIG] ⚠ Impossible de charger la config distante : {e}")


def enforce_storage_limit():
    files = sorted(RECORD_DIR.glob("*.mp4"), key=lambda f: f.stat().st_mtime)
    total = sum(f.stat().st_size for f in files)
    limit = MAX_STORAGE_MB * 1024 * 1024
    while total > limit and files:
        oldest = files.pop(0)
        freed  = oldest.stat().st_size
        oldest.unlink()
        total -= freed
        print(f"[STORAGE] 🗑 {oldest.name} supprimé ({freed // 1024 // 1024} Mo libérés)")


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.0.47", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def server_reachable():
    try:
        r = requests.get(f"{SERVER_URL}/api/health", timeout=3)
        return r.status_code < 500
    except Exception:
        return False


def announce(ip):
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
            print(f"[ANNOUNCE] ✅ Noeud annoncé ({ip})")
        else:
            print(f"[ANNOUNCE] ⚠ HTTP {r.status_code}")
    except Exception as e:
        print(f"[ANNOUNCE] ❌ {e}")
    try:
        requests.post(f"{SERVER_URL}/api/cameras/announce", json=payload, timeout=5)
    except Exception:
        pass


def clean_shm():
    """Supprime les répertoires temporaires MediaMTX de /dev/shm pour éviter
    'no space left on device' au prochain démarrage (tmpfs 64 Mo sur Pi)."""
    try:
        import glob
        dirs = glob.glob('/dev/shm/mediamtx-rpicamera-*')
        if dirs:
            for d in dirs:
                try:
                    subprocess.run(['sudo', 'rm', '-rf', d], timeout=5, capture_output=True)
                except Exception:
                    pass
            print(f"[SHM] 🧹 {len(dirs)} répertoire(s) MediaMTX supprimé(s) de /dev/shm")
    except Exception as e:
        print(f"[SHM] ⚠ clean_shm : {e}")


def release_camera():
    """Tue tous les processus qui tiennent la caméra et nettoie /dev/shm."""
    for pattern in ['mtxrpicam', 'rpicam-jpeg', 'rpicam-vid']:
        try:
            subprocess.run(['sudo', 'pkill', '-9', '-f', pattern],
                           capture_output=True, timeout=3)
        except Exception:
            pass

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
            print(f"[CAM] ⚠ release_camera fuser : {e}")

    clean_shm()
    time.sleep(2)


def set_mediamtx(active: bool):
    action = 'start' if active else 'stop'
    try:
        subprocess.run(['sudo', 'systemctl', action, 'mediamtx'], check=True, timeout=10)
        print(f"[MEDIAMTX] {'▶' if active else '⏹'} MediaMTX {action}")
    except Exception as e:
        print(f"[MEDIAMTX] ❌ Impossible de {action} MediaMTX : {e}")


def wait_for_rtsp_path(max_wait: int = 20) -> bool:
    """Attend que MediaMTX signale le path RTSP comme ready:true."""
    for i in range(max_wait):
        try:
            r = requests.get(
                f"http://localhost:9997/v3/paths/get/{RTSP_PATH}",
                timeout=2,
            )
            if r.status_code == 200 and r.json().get("ready") is True:
                print(f"[MEDIAMTX] ✅ Path /{RTSP_PATH} prêt ({i+1}s)")
                return True
        except Exception:
            pass
        time.sleep(1)
    print(f"[MEDIAMTX] ⚠ Path /{RTSP_PATH} non ready après {max_wait}s")
    return False


def start_stream():
    """Démarre MediaMTX et attend que le path soit prêt. Retourne True si OK."""
    release_camera()
    set_mediamtx(True)
    return wait_for_rtsp_path()


def stop_stream():
    """Arrête MediaMTX et libère la caméra."""
    set_mediamtx(False)
    release_camera()


def notify_motion(active: bool):
    """Notifie le serveur d'un changement d'état de mouvement.
    Quand active=True après un wake, le serveur déclenche FFmpeg côté serveur."""
    try:
        r = requests.post(
            f"{SERVER_URL}/api/camera-nodes/motion",
            json={"deviceId": DEVICE_ID, "motion": active},
            timeout=5,
        )
        if r.status_code == 200:
            print(f"[MOTION] ✅ Serveur notifié ({'actif' if active else 'inactif'})")
        else:
            print(f"[MOTION] ⚠ HTTP {r.status_code}")
    except Exception as e:
        print(f"[MOTION] ❌ Impossible de notifier le serveur : {e}")


def check_wake_signal() -> bool:
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
        print(f"[SNAPSHOT] ⚠ Échec capture : {e}")
        return False


def images_differ(path_a: Path, path_b: Path) -> bool:
    try:
        from PIL import Image
        import numpy as np
        img_a = np.array(Image.open(path_a).convert('L'), dtype=np.int16)
        img_b = np.array(Image.open(path_b).convert('L'), dtype=np.int16)
        changed = int(np.sum(np.abs(img_a - img_b) > MOTION_THRESHOLD))
        return changed > MOTION_MIN_PIXELS
    except ImportError:
        try:
            return abs(path_a.stat().st_size - path_b.stat().st_size) > 3000
        except Exception:
            return False
    except Exception:
        return False


MIN_CLIP_SIZE = 50 * 1024

def upload_pending():
    files = sorted(RECORD_DIR.glob("*.mp4"))
    if not files:
        return
    valid = []
    for f in files:
        size = f.stat().st_size
        if size < MIN_CLIP_SIZE:
            print(f"[SYNC] ⚠ {f.name} trop petit ({size} o) — supprimé")
            try: f.unlink()
            except: pass
        else:
            valid.append(f)
    if not valid:
        return
    print(f"[SYNC] {len(valid)} fichier(s) à envoyer")
    for f in valid:
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
                try: f.unlink()
                except: pass
            else:
                print(f"[SYNC] ❌ {f.name} — HTTP {r.status_code}")
                break
        except Exception as e:
            print(f"[SYNC] ❌ {f.name} — {e}")
            break


# ─── Boucle principale ─────────────────────────────────────────────────────────

def main():
    print(f"[SENTYS] Démarré | serveur={SERVER_URL} | device={DEVICE_ID}")
    set_mediamtx(False)
    time.sleep(2)
    release_camera()
    time.sleep(2)

    was_offline        = False
    last_announce      = 0.0
    server_loss_streak = 0

    # États : IDLE — caméra off, snapshots périodiques
    #         STREAMING — MediaMTX actif
    stream_state       = 'IDLE'
    last_motion_time   = 0.0
    snap_a             = SNAPSHOT_DIR / 'snap_a.jpg'
    snap_b             = SNAPSHOT_DIR / 'snap_b.jpg'
    snap_toggle        = False
    prev_snap          = None
    last_wake_check    = 0.0
    WAKE_CHECK_INTERVAL   = 2
    SERVER_LOSS_TOLERANCE = 3
    # True = démarré par clic utilisateur → pas de timeout mouvement, attend SLEEP
    wake_mode = False

    if server_reachable():
        fetch_remote_config()

    if list(RECORD_DIR.glob("*.mp4")) and server_reachable():
        print("[SENTYS] Clips en attente au démarrage — synchronisation")
        upload_pending()

    while True:
        ip     = get_local_ip()
        online = server_reachable()
        now    = time.time()

        # ── Reconnexion serveur ────────────────────────────────────────────────
        if online and was_offline:
            print("[SENTYS] Connexion rétablie")
            fetch_remote_config()
            server_loss_streak = 0
            if stream_state != 'STREAMING':
                upload_pending()
            was_offline = False

        if not online:
            was_offline = True
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

            # Signal wake (clic START dans l'interface) — vérifié toutes les 2s
            if online and now - last_wake_check >= WAKE_CHECK_INTERVAL:
                last_wake_check = now
                if check_wake_signal():
                    print("[WAKE] 🔔 Démarrage demandé par l'interface web")
                    ready = start_stream()
                    # notify_motion(True) déclenche FFmpeg côté serveur
                    notify_motion(True)
                    if not ready:
                        # Path non prêt — le serveur réessaiera via le reconnect
                        print("[WAKE] ⚠ MediaMTX non prêt, le serveur va réessayer")
                    stream_state     = 'STREAMING'
                    wake_mode        = True
                    last_motion_time = now
                    continue

            # Snapshot pour détection mouvement
            cur_snap    = snap_b if snap_toggle else snap_a
            snap_toggle = not snap_toggle

            if capture_snapshot(cur_snap):
                if prev_snap is not None and prev_snap.exists():
                    if images_differ(prev_snap, cur_snap):
                        print("[MOTION] 🔴 Mouvement détecté !")
                        last_motion_time = now

                        if online:
                            ready = start_stream()
                            notify_motion(True)
                            stream_state = 'STREAMING'
                            wake_mode    = False
                        else:
                            print("[MOTION] Mode hors-ligne — enregistrement local")
                            enforce_storage_limit()
                            try:
                                ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
                                out = RECORD_DIR / f"{ts}.mp4"
                                subprocess.run(
                                    ['rpicam-vid', '-t', str(CLIP_DURATION_SEC * 1000),
                                     '--codec', 'h264', '--width', '1280', '--height', '720',
                                     '-o', str(out)],
                                    check=True, timeout=CLIP_DURATION_SEC + 10,
                                )
                                print(f"[MOTION] 📼 Clip : {out.name}")
                            except Exception as e:
                                print(f"[MOTION] ❌ Recording : {e}")
                            prev_snap = None

                prev_snap = cur_snap
            else:
                release_camera()
                time.sleep(2)
                continue

            time.sleep(MOTION_SNAPSHOT_INTERVAL)

        # ── État STREAMING ─────────────────────────────────────────────────────
        elif stream_state == 'STREAMING':

            # Signal STOP (clic Stop dans l'interface) — priorité absolue
            if online and check_sleep_signal():
                print("[SLEEP] 💤 Arrêt demandé par l'interface web")
                stop_stream()
                notify_motion(False)
                stream_state = 'IDLE'
                wake_mode    = False
                prev_snap    = None
                snap_toggle  = False
                time.sleep(3)
                continue

            if wake_mode:
                # Mode utilisateur : stream permanent jusqu'au STOP
                time.sleep(2)
            else:
                # Mode mouvement : arrêt automatique après STREAM_IDLE_TIMEOUT sans détection
                if now - last_motion_time > STREAM_IDLE_TIMEOUT:
                    print(f"[MOTION] ⏹ {STREAM_IDLE_TIMEOUT}s sans mouvement — arrêt MediaMTX")
                    stop_stream()
                    if online:
                        notify_motion(False)
                    stream_state = 'IDLE'
                    prev_snap    = None
                    snap_toggle  = False
                    time.sleep(3)
                else:
                    time.sleep(2)


if __name__ == "__main__":
    main()
