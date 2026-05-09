#!/usr/bin/env python3
"""
Sentys Agent — Pi Zero 2W
Fusionne : annonce réseau + enregistrement hors ligne + sync automatique
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
CLIP_DURATION_SEC = 30    # durée d'un clip hors ligne
ANNOUNCE_INTERVAL = 30    # secondes entre chaque annonce au serveur
CHECK_INTERVAL    = 10    # secondes entre chaque vérif de connexion
MAX_STORAGE_MB    = 500   # stockage max pour les clips hors ligne
RTSP_PORT         = 8554
RTSP_PATH         = "cam1"

# ─── Identité unique par Pi (lue depuis device.conf) ──────────────────────────
_HOME     = Path(f"/home/{os.getenv('USER', 'picam')}")
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
        print(f"[CONFIG] ⚠ Impossible de lire {_CONF_PATH} : {e} — utilisation des valeurs par défaut")
    return conf

_conf          = _load_device_conf()
DEVICE_ID      = _conf.get("DEVICE_ID") or f"pi-{socket.gethostname()}"
DEVICE_NAME    = _conf.get("DEVICE_NAME") or socket.gethostname()
DEVICE_LOCATION = _conf.get("DEVICE_LOCATION", "")
# ──────────────────────────────────────────────────────────────────────────────

RECORD_DIR.mkdir(parents=True, exist_ok=True)


def fetch_remote_config():
    """Récupère la config depuis le serveur et met à jour les variables globales."""
    global DEVICE_NAME, DEVICE_LOCATION, CLIP_DURATION_SEC, MAX_STORAGE_MB, ANNOUNCE_INTERVAL, RTSP_PORT, RTSP_PATH
    try:
        r = requests.get(f"{SERVER_URL}/api/camera-nodes/{DEVICE_ID}/config", timeout=5)
        if r.status_code == 200:
            cfg = r.json()
            DEVICE_NAME       = cfg.get("name",             DEVICE_NAME)
            DEVICE_LOCATION   = cfg.get("location",         DEVICE_LOCATION)
            CLIP_DURATION_SEC = int(cfg.get("clipDuration", CLIP_DURATION_SEC))
            MAX_STORAGE_MB    = int(cfg.get("maxStorageMb", MAX_STORAGE_MB))
            ANNOUNCE_INTERVAL = int(cfg.get("announceInterval", ANNOUNCE_INTERVAL))
            RTSP_PORT         = int(cfg.get("rtspPort",     RTSP_PORT))
            RTSP_PATH         = cfg.get("rtspPath",         RTSP_PATH)
            print(f"[CONFIG] ✅ Config chargée depuis le serveur")
    except Exception as e:
        print(f"[CONFIG] ⚠ Impossible de charger la config distante : {e}")


def enforce_storage_limit():
    files = sorted(RECORD_DIR.glob("*.mp4"), key=lambda f: f.stat().st_mtime)
    total = sum(f.stat().st_size for f in files)
    limit = MAX_STORAGE_MB * 1024 * 1024
    while total > limit and files:
        oldest = files.pop(0)
        freed = oldest.stat().st_size
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


def set_mediamtx(active: bool):
    action = 'start' if active else 'stop'
    try:
        subprocess.run(['sudo', 'systemctl', action, 'mediamtx'], check=True, timeout=10)
        print(f"[MEDIAMTX] {'▶' if active else '⏹'} MediaMTX {action}")
    except Exception as e:
        print(f"[MEDIAMTX] ❌ Impossible de {action} MediaMTX: {e}")


def record_clip():
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = RECORD_DIR / f"{ts}.mp4"
    subprocess.run(
        [
            "libcamera-vid",
            "-t",       str(CLIP_DURATION_SEC * 1000),
            "--codec",  "h264",
            "--width",  "1280",
            "--height", "720",
            "-o",       str(out),
        ],
        check=True,
        timeout=CLIP_DURATION_SEC + 10,
    )
    return out


MIN_CLIP_SIZE = 50 * 1024   # 50 Ko — en dessous = clip invalide/vide

def upload_pending():
    files = sorted(RECORD_DIR.glob("*.mp4"))
    if not files:
        return
    # Supprimer les fichiers vides ou trop petits avant upload
    valid = []
    for f in files:
        size = f.stat().st_size
        if size < MIN_CLIP_SIZE:
            print(f"[SYNC] ⚠ {f.name} trop petit ({size} octets) — supprimé")
            try: f.unlink()
            except: pass
        else:
            valid.append(f)
    files = valid
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
                try: f.unlink()
                except: pass
            else:
                print(f"[SYNC] ❌ {f.name} — HTTP {r.status_code}")
                break
        except Exception as e:
            print(f"[SYNC] ❌ {f.name} — {e}")
            break


def main():
    print(f"[SENTYS] Démarré | serveur={SERVER_URL} | device={DEVICE_ID}")

    was_offline   = False
    last_announce = 0

    if server_reachable():
        fetch_remote_config()

    if list(RECORD_DIR.glob("*.mp4")) and server_reachable():
        print("[SENTYS] Clips en attente détectés au démarrage — synchronisation")
        set_mediamtx(True)
        upload_pending()

    while True:
        ip = get_local_ip()

        if server_reachable():
            # ── Reconnexion après coupure ──────────────────────────────────
            if was_offline:
                print("[SENTYS] Connexion rétablie — synchronisation des clips")
                fetch_remote_config()
                set_mediamtx(True)
                upload_pending()
                was_offline = False

            # ── Annonce périodique ─────────────────────────────────────────
            now = time.time()
            if ip and now - last_announce >= ANNOUNCE_INTERVAL:
                announce(ip)
                last_announce = now

            time.sleep(CHECK_INTERVAL)

        else:
            # ── Mode hors ligne ────────────────────────────────────────────
            if not was_offline:
                print("[SENTYS] Serveur inaccessible — enregistrement local activé")
                set_mediamtx(False)
            was_offline = True

            try:
                enforce_storage_limit()
                out = record_clip()
                print(f"[SENTYS] Clip enregistré : {out.name}")
            except FileNotFoundError:
                print("[SENTYS] ❌ libcamera-vid introuvable — sudo apt install libcamera-apps")
                time.sleep(30)
            except Exception as e:
                print(f"[SENTYS] ❌ Erreur recording : {e}")
                time.sleep(5)


if __name__ == "__main__":
    main()
