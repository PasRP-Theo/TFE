import warnings
warnings.filterwarnings('ignore', category=UserWarning, module='torch')
import os
os.environ.setdefault('CUDA_VISIBLE_DEVICES', '')

import cv2
import requests
import time
import sys
import json
import threading

# ── PARAMÈTRES GLOBAUX ──────────────────────────────────────────────────────
COOLDOWN_SECONDS = 30
CONFIRM_FRAMES   = 2
MIN_CONTOUR_AREA = 1800

CONF_PERSON  = 0.45
CONF_ANIMAL  = 0.50
CONF_VEHICLE = 0.52

SERVER_HOST  = os.getenv("SERVER_HOST", "127.0.0.1")
SERVER_PORT  = os.getenv("SERVER_PORT", "4000")

# ── CHARGEMENT YOLO (optionnel) ──────────────────────────────────────────────
USE_YOLO = False
model    = None
_yolo_lock = threading.Lock()   # YOLO n'est pas thread-safe sans verrou

try:
    from ultralytics import YOLO
    model    = YOLO("yolov8n.pt")
    USE_YOLO = True
    print("✅ YOLOv8n chargé — classification activée")
except Exception as e:
    print(f"⚠️  YOLOv8 non disponible ({e}) — détection par mouvement uniquement")

# Classes YOLO → (type_en, label_fr, seuil_conf)
YOLO_LABELS = {
    0:  ("person",     "Humain détecté",   CONF_PERSON),
    15: ("cat",        "Chat détecté",     CONF_ANIMAL),
    16: ("dog",        "Chien détecté",    CONF_ANIMAL),
    14: ("bird",       "Oiseau détecté",   CONF_ANIMAL),
    17: ("horse",      "Animal détecté",   CONF_ANIMAL),
    18: ("sheep",      "Animal détecté",   CONF_ANIMAL),
    19: ("cow",        "Animal détecté",   CONF_ANIMAL),
    2:  ("car",        "Véhicule détecté", CONF_VEHICLE),
    3:  ("motorcycle", "Véhicule détecté", CONF_VEHICLE),
    5:  ("bus",        "Véhicule détecté", CONF_VEHICLE),
    7:  ("truck",      "Véhicule détecté", CONF_VEHICLE),
}
PRIORITY = [0, 15, 16, 14, 17, 18, 19, 2, 3, 5, 7]

# Noyaux morphologiques (partagés, lecture seule)
_KERNEL_OPEN  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
_KERNEL_CLOSE = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))


# ── FONCTIONS DE TRAITEMENT ──────────────────────────────────────────────────

def process_mask(fgmask):
    _, thresh = cv2.threshold(fgmask, 200, 255, cv2.THRESH_BINARY)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN,  _KERNEL_OPEN)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, _KERNEL_CLOSE)
    return thresh


def is_valid_contour(c) -> bool:
    area = cv2.contourArea(c)
    if area < MIN_CONTOUR_AREA:
        return False
    hull_area = cv2.contourArea(cv2.convexHull(c))
    if hull_area < 1:
        return False
    if area / hull_area < 0.18:
        return False
    _, _, w, h = cv2.boundingRect(c)
    if h == 0:
        return False
    aspect = w / h
    if aspect > 8.0 or aspect < 0.12:
        return False
    return True


def classify_frame(frame):
    if not USE_YOLO or model is None:
        return "unknown", None, 0.0
    with _yolo_lock:
        results = model(frame, verbose=False, conf=0.35, imgsz=416)[0]
    for cls_id in PRIORITY:
        _, _, required_conf = YOLO_LABELS[cls_id]
        matches = [b for b in results.boxes if int(b.cls) == cls_id and float(b.conf) >= required_conf]
        if matches:
            conf = float(max(b.conf for b in matches))
            type_en, label_fr, _ = YOLO_LABELS[cls_id]
            return type_en, label_fr, conf
    return "unknown", None, 0.0


# ── BOUCLE DE DÉTECTION POUR UNE CAMÉRA ─────────────────────────────────────

def run_detector(camera_id: str, rtsp_url: str):
    webhook_url = f"http://{SERVER_HOST}:{SERVER_PORT}/api/cameras/{camera_id}/motion"
    print(f"[CAM {camera_id}] 🤖 Démarrage — {rtsp_url}")

    cap  = cv2.VideoCapture(rtsp_url)
    fgbg = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=50, detectShadows=False)

    last_trigger     = 0
    frame_count      = 0
    pending_count    = 0
    pending_classify = []

    while True:
        ret, frame = cap.read()
        if not ret:
            print(f"[CAM {camera_id}] Coupure du flux, reconnexion dans 5s...")
            pending_count    = 0
            pending_classify = []
            cap.release()
            time.sleep(5)
            cap = cv2.VideoCapture(rtsp_url)
            continue

        frame_count += 1
        if frame_count % 2 != 0:
            continue

        small  = cv2.resize(frame, (640, 360))
        fgmask = fgbg.apply(small)
        thresh = process_mask(fgmask)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        valid_contours = [c for c in contours if is_valid_contour(c)]

        if not valid_contours:
            if pending_count > 0:
                pending_count    = 0
                pending_classify = []
            continue

        if time.time() - last_trigger <= COOLDOWN_SECONDS:
            continue

        type_en, label_fr, conf = classify_frame(small)

        if USE_YOLO and type_en == "unknown":
            print(f"[CAM {camera_id}] ⚪ Mouvement ignoré — aucun objet reconnu par YOLO")
            pending_count = 0
            pending_classify = []
            continue

        pending_classify.append((type_en, label_fr, conf))
        pending_count += 1

        if pending_count < CONFIRM_FRAMES:
            print(f"[CAM {camera_id}] ⏳ Confirmation ({pending_count}/{CONFIRM_FRAMES})")
            continue

        if USE_YOLO:
            final_type, final_label, final_conf = max(pending_classify, key=lambda x: x[2])
        else:
            final_type  = "motion"
            final_label = "Mouvement détecté"
            final_conf  = 0.0

        conf_pct = f" ({final_conf:.0%})" if final_conf > 0 else ""
        print(f"[CAM {camera_id}] 🚨 {final_label}{conf_pct} — {pending_count} frames confirmées")

        try:
            requests.post(webhook_url, json={
                "type":       final_type,
                "label":      final_label,
                "confidence": round(final_conf, 2),
            }, timeout=2)
        except Exception as e:
            print(f"[CAM {camera_id}] Erreur webhook: {e}")

        last_trigger     = time.time()
        pending_count    = 0
        pending_classify = []


# ── POINT D'ENTRÉE ───────────────────────────────────────────────────────────

def get_cameras_from_db():
    """
    Interroge la base de données pour récupérer toutes les caméras actives.
    Utilise les mêmes variables d'environnement que le serveur Node.js.
    """
    try:
        import psycopg2
    except ImportError:
        print("⚠️  psycopg2 non installé — impossible d'interroger la DB (pip install psycopg2-binary)")
        return []

    try:
        required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]
        missing = [k for k in required if not os.getenv(k)]
        if missing:
            print(f"⚠️  Variables manquantes : {', '.join(missing)}")
            return []
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST"),
            port=int(os.getenv("DB_PORT")),
            dbname=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
        )
        cur = conn.cursor()
        cur.execute("SELECT id, rtsp_url FROM cameras WHERE active = true")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [(str(row[0]), row[1]) for row in rows]
    except Exception as e:
        print(f"⚠️  Erreur connexion DB : {e}")
        return []


def analyze_snapshot(rtsp_url: str, max_attempts: int = 10) -> dict:
    """
    Mode one-shot : ouvre le flux, prend la première frame utilisable,
    exécute YOLO dessus et retourne un dict JSON.
    Utilisé par cameraNodes.js quand un Pi node signale un mouvement.
    """
    cap = cv2.VideoCapture(rtsp_url)
    result = {"type": "motion", "label": "Mouvement détecté", "confidence": 0.0}

    for _ in range(max_attempts):
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.3)
            continue
        small = cv2.resize(frame, (640, 360))
        type_en, label_fr, conf = classify_frame(small)
        if type_en != "unknown" and label_fr:
            result = {"type": type_en, "label": label_fr, "confidence": round(conf, 2)}
            break

    cap.release()
    return result


camera_id_env = os.getenv("CAMERA_ID", "").strip()
rtsp_url_env  = os.getenv("RTSP_URL",  "").strip()

if "--analyze" in sys.argv:
    # Mode snapshot one-shot — lancé par cameraNodes.js pour classifier un événement PIR
    if not rtsp_url_env:
        print(json.dumps({"error": "RTSP_URL manquant"}))
        sys.exit(1)
    output = analyze_snapshot(rtsp_url_env)
    print(json.dumps(output))
    sys.exit(0)
elif camera_id_env and rtsp_url_env:
    # Mode caméra unique — lancé par le manager Node.js
    run_detector(camera_id_env, rtsp_url_env)
else:
    # Mode autonome — interroge la DB et lance un thread par caméra active
    print("🔍 Aucune caméra spécifiée via env — interrogation de la base de données...")
    cameras = get_cameras_from_db()

    if not cameras:
        print("❌ Aucune caméra active trouvée en base. Vérifiez la DB et les variables d'environnement.")
    elif len(cameras) == 1:
        cam_id, rtsp_url = cameras[0]
        run_detector(cam_id, rtsp_url)
    else:
        print(f"📷 {len(cameras)} caméra(s) active(s) trouvée(s) — lancement des threads...")
        threads = []
        for cam_id, rtsp_url in cameras:
            t = threading.Thread(target=run_detector, args=(cam_id, rtsp_url), daemon=True, name=f"cam-{cam_id}")
            t.start()
            threads.append(t)
            print(f"  ▶ Thread CAM {cam_id} démarré")

        for t in threads:
            t.join()
