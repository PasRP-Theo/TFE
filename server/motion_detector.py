import cv2
import requests
import time
import os
import sys

# ── CONFIGURATION (via variables d'environnement PM2) ──
CAMERA_ID    = os.getenv("CAMERA_ID", "4")
RTSP_URL     = os.getenv("RTSP_URL", "rtsp://192.168.0.213:8554/cam1")
WEBHOOK_URL  = f"http://127.0.0.1:4000/api/cameras/{CAMERA_ID}/motion"
COOLDOWN_SECONDS = 30

# ── CHARGEMENT YOLO (optionnel — fallback MOG2 seul si absent) ──
USE_YOLO = False
model    = None
try:
    from ultralytics import YOLO
    model    = YOLO("yolov8n.pt")   # ~6 Mo, téléchargé automatiquement
    USE_YOLO = True
    print("✅ YOLOv8n chargé — classification activée")
except Exception as e:
    print(f"⚠️  YOLOv8 non disponible ({e}) — détection par mouvement uniquement")

# Classes YOLO → libellé FR
YOLO_LABELS = {
    0:  ("person",   "Humain détecté"),
    14: ("bird",     "Oiseau détecté"),
    15: ("cat",      "Chat détecté"),
    16: ("dog",      "Chien détecté"),
    17: ("horse",    "Animal détecté"),
    18: ("sheep",    "Animal détecté"),
    19: ("cow",      "Animal détecté"),
    2:  ("car",      "Véhicule détecté"),
    3:  ("motorcycle","Véhicule détecté"),
    5:  ("bus",      "Véhicule détecté"),
    7:  ("truck",    "Véhicule détecté"),
}
PRIORITY = [0, 15, 16, 14, 17, 18, 19, 2, 3, 5, 7]  # Humain > chat/chien > ...


def classify_frame(frame):
    """Retourne (type_en, label_fr, confidence) ou (None, None, 0)."""
    if not USE_YOLO or model is None:
        return None, None, 0.0

    results = model(frame, verbose=False, conf=0.35, imgsz=416)[0]

    best_cls  = None
    best_conf = 0.0

    for cls_id in PRIORITY:
        matches = [b for b in results.boxes if int(b.cls) == cls_id]
        if matches:
            conf = float(max(b.conf for b in matches))
            best_cls  = cls_id
            best_conf = conf
            break

    if best_cls is not None:
        type_en, label_fr = YOLO_LABELS[best_cls]
        return type_en, label_fr, best_conf

    return "unknown", "Mouvement détecté", 0.0


print(f"🤖 IA démarrée — CAM {CAMERA_ID}")
print(f"🔗 Flux : {RTSP_URL}")

cap = cv2.VideoCapture(RTSP_URL)
fgbg = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=50, detectShadows=False)

last_trigger = 0
frame_count  = 0

while True:
    ret, frame = cap.read()
    if not ret:
        print("Coupure du flux, reconnexion dans 5s...")
        time.sleep(5)
        cap = cv2.VideoCapture(RTSP_URL)
        continue

    frame_count += 1
    if frame_count % 2 != 0:
        continue

    small = cv2.resize(frame, (640, 360))
    fgmask = fgbg.apply(small)
    _, thresh = cv2.threshold(fgmask, 200, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    motion_detected = any(cv2.contourArea(c) > 1200 for c in contours)

    if motion_detected and (time.time() - last_trigger > COOLDOWN_SECONDS):
        type_en, label_fr, conf = classify_frame(small)

        if USE_YOLO and type_en == "unknown":
            # YOLO n'a rien reconnu → fausse alarme probable (poussière, lumière)
            print(f"⚪ Mouvement ignoré — aucun objet reconnu par YOLO (CAM {CAMERA_ID})")
            last_trigger = time.time()
            continue

        conf_pct = f" ({conf:.0%})" if conf > 0 else ""
        print(f"🚨 {label_fr}{conf_pct} (CAM {CAMERA_ID}) → signal envoyé à SENTYS...")

        try:
            requests.post(WEBHOOK_URL, json={
                "type":       type_en,
                "label":      label_fr,
                "confidence": round(conf, 2),
            }, timeout=2)
        except Exception as e:
            print(f"Erreur webhook: {e}")

        last_trigger = time.time()

cap.release()
