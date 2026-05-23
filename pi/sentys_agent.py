#!/usr/bin/env python3
"""
Sentys Agent — Pi Zero 2W (mode 24/7)
MediaMTX tourne en permanence via systemd — RTSP toujours disponible.
L'agent annonce le nœud, détecte le mouvement et gère les enregistrements hors-ligne.
"""

import os
import time
import socket
import subprocess
from pathlib import Path
from datetime import datetime

import requests

# ─── Configuration ────────────────────────────────────────────────────────────
SERVER_URL    = "http://192.168.0.47:4000"
DEVICE_MODEL  = "Raspberry Pi Zero"
RECORD_DIR    = Path(f"/home/{os.getenv('USER', 'picam')}/offline_recordings")
CLIP_DURATION_SEC  = 30
ANNOUNCE_INTERVAL  = 30
MAX_STORAGE_MB     = 500
RTSP_PORT          = 8554
RTSP_PATH          = "cam1"

# Détection de mouvement (frames tirées du flux RTSP local)
MOTION_CHECK_INTERVAL = 2      # secondes entre chaque analyse
MOTION_THRESHOLD      = 25     # diff par pixel (0-255)
MOTION_MIN_PIXELS     = 300    # pixels différents pour déclarer un mouvement
SNAPSHOT_WIDTH        = 320
SNAPSHOT_HEIGHT       = 240
SNAPSHOT_DIR          = Path('/tmp/sentys_snapshots')

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
    global MOTION_CHECK_INTERVAL, MOTION_THRESHOLD, MOTION_MIN_PIXELS
    try:
        r = requests.get(f"{SERVER_URL}/api/camera-nodes/{DEVICE_ID}/config", timeout=5)
        if r.status_code == 200:
            cfg = r.json()
            DEVICE_NAME           = cfg.get("name",             DEVICE_NAME)
            DEVICE_LOCATION       = cfg.get("location",         DEVICE_LOCATION)
            CLIP_DURATION_SEC     = int(cfg.get("clipDuration", CLIP_DURATION_SEC))
            MAX_STORAGE_MB        = int(cfg.get("maxStorageMb", MAX_STORAGE_MB))
            ANNOUNCE_INTERVAL     = int(cfg.get("announceInterval", ANNOUNCE_INTERVAL))
            RTSP_PORT             = int(cfg.get("rtspPort",     RTSP_PORT))
            RTSP_PATH             = cfg.get("rtspPath",         RTSP_PATH)
            MOTION_CHECK_INTERVAL = int(cfg.get("motionSnapshotInterval", MOTION_CHECK_INTERVAL))
            MOTION_THRESHOLD      = int(cfg.get("motionThreshold",        MOTION_THRESHOLD))
            MOTION_MIN_PIXELS     = int(cfg.get("motionMinPixels",        MOTION_MIN_PIXELS))
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


# ─── Détection de mouvement via le flux RTSP local ───────────────────────────

def _ffmpeg_bin():
    """Retourne le chemin de ffmpeg si disponible, None sinon."""
    for candidate in ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']:
        try:
            r = subprocess.run([candidate, '-version'], capture_output=True, timeout=3)
            if r.returncode == 0:
                return candidate
        except Exception:
            pass
    return None

_FFMPEG = _ffmpeg_bin()

def capture_frame_from_rtsp(out_path: Path) -> bool:
    """Tire un frame du flux RTSP local via ffmpeg. Retourne True si réussi."""
    if not _FFMPEG:
        return False
    try:
        subprocess.run([
            _FFMPEG, '-y',
            '-rtsp_transport', 'tcp',
            '-i', f'rtsp://localhost:{RTSP_PORT}/{RTSP_PATH}',
            '-vframes', '1',
            '-vf', f'scale={SNAPSHOT_WIDTH}:{SNAPSHOT_HEIGHT}',
            '-q:v', '5',
            str(out_path),
        ], check=True, timeout=6, capture_output=True)
        return True
    except Exception:
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


def notify_motion(active: bool):
    try:
        r = requests.post(
            f"{SERVER_URL}/api/camera-nodes/motion",
            json={"deviceId": DEVICE_ID, "motion": active},
            timeout=5,
        )
        if r.status_code == 200:
            print(f"[MOTION] ✅ Serveur notifié ({'actif' if active else 'inactif'})")
    except Exception as e:
        print(f"[MOTION] ❌ {e}")


def record_clip_from_rtsp() -> Path | None:
    """Enregistre un clip depuis le flux RTSP local (hors-ligne)."""
    if not _FFMPEG:
        return None
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = RECORD_DIR / f"{ts}.mp4"
    try:
        subprocess.run([
            _FFMPEG, '-y',
            '-rtsp_transport', 'tcp',
            '-i', f'rtsp://localhost:{RTSP_PORT}/{RTSP_PATH}',
            '-t', str(CLIP_DURATION_SEC),
            '-c', 'copy',
            str(out),
        ], check=True, timeout=CLIP_DURATION_SEC + 15, capture_output=True)
        return out
    except Exception as e:
        print(f"[MOTION] ❌ Enregistrement hors-ligne : {e}")
        return None


# ─── Boucle principale ─────────────────────────────────────────────────────────

def main():
    print(f"[SENTYS] Démarré (mode 24/7) | serveur={SERVER_URL} | device={DEVICE_ID}")
    if not _FFMPEG:
        print("[SENTYS] ⚠ ffmpeg introuvable — détection mouvement et enregistrements hors-ligne désactivés")

    was_offline   = False
    last_announce = 0.0
    motion_active = False

    snap_a      = SNAPSHOT_DIR / 'snap_a.jpg'
    snap_b      = SNAPSHOT_DIR / 'snap_b.jpg'
    snap_toggle = False
    prev_snap   = None
    last_motion = 0.0

    if server_reachable():
        fetch_remote_config()

    if list(RECORD_DIR.glob("*.mp4")) and server_reachable():
        print("[SENTYS] Clips en attente au démarrage — synchronisation")
        upload_pending()

    while True:
        ip     = get_local_ip()
        online = server_reachable()
        now    = time.time()

        # ── Gestion reconnexion ────────────────────────────────────────────────
        if online and was_offline:
            print("[SENTYS] Connexion rétablie")
            fetch_remote_config()
            upload_pending()
            was_offline = False

        if not online:
            was_offline = True

        # ── Annonce périodique ─────────────────────────────────────────────────
        if online and ip and now - last_announce >= ANNOUNCE_INTERVAL:
            announce(ip)
            last_announce = now

        # ── Détection de mouvement ─────────────────────────────────────────────
        if _FFMPEG:
            cur_snap    = snap_b if snap_toggle else snap_a
            snap_toggle = not snap_toggle

            if capture_frame_from_rtsp(cur_snap):
                if prev_snap is not None and prev_snap.exists():
                    moved = images_differ(prev_snap, cur_snap)
                    if moved:
                        last_motion = now
                        if not motion_active:
                            motion_active = True
                            if online:
                                notify_motion(True)
                            else:
                                # Hors-ligne : enregistrement local
                                print("[MOTION] Mode hors-ligne — enregistrement local")
                                enforce_storage_limit()
                                out = record_clip_from_rtsp()
                                if out:
                                    print(f"[MOTION] 📼 Clip : {out.name}")
                    else:
                        # Mouvement retombé depuis > 10s → notifier fin
                        if motion_active and now - last_motion > 10:
                            motion_active = False
                            if online:
                                notify_motion(False)

                prev_snap = cur_snap

        time.sleep(MOTION_CHECK_INTERVAL)


if __name__ == "__main__":
    main()
