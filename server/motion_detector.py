import cv2
import requests
import time
import os
import sys

# ── CONFIGURATION (via variables d'environnement PM2) ──
CAMERA_ID = os.getenv("CAMERA_ID", "4")
RTSP_URL = os.getenv("RTSP_URL", "rtsp://192.168.0.213:8554/cam1")

# On tape sur localhost car le script tourne sur le même PC que le serveur Node.js
WEBHOOK_URL = f"http://127.0.0.1:4000/api/cameras/{CAMERA_ID}/motion"

COOLDOWN_SECONDS = 30  # Ne déclenche un enregistrement que toutes les 30s max

print(f"🤖 IA de mouvement démarrée sur le PC Host pour la CAM {CAMERA_ID}")
print(f"🔗 Flux surveillé : {RTSP_URL}")

cap = cv2.VideoCapture(RTSP_URL)

# Initialisation de l'IA (Background Subtractor MOG2) - Optimisé pour consommer peu de CPU
fgbg = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=50, detectShadows=False)

last_trigger = 0
frame_count = 0

while True:
    ret, frame = cap.read()
    if not ret:
        print("Coupure du flux, reconnexion dans 5s...")
        time.sleep(5)
        cap = cv2.VideoCapture(RTSP_URL)
        continue

    frame_count += 1
    # OPTIMISATION : On analyse une image sur 2 (largement supporté par un PC portable)
    if frame_count % 2 != 0:
        continue

    # Redimensionnement modéré (640x360) pour une meilleure précision
    small_frame = cv2.resize(frame, (640, 360))
    
    fgmask = fgbg.apply(small_frame)
    _, thresh = cv2.threshold(fgmask, 200, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    motion_detected = False
    for contour in contours:
        # 1200 pixels carrés sur une image de 640x360 = ~0.5% de l'image (sensibilité standard)
        if cv2.contourArea(contour) > 1200:
            motion_detected = True
            break

    if motion_detected and (time.time() - last_trigger > COOLDOWN_SECONDS):
        print(f"🚨 MOUVEMENT DÉTECTÉ (CAM {CAMERA_ID}) ! Signal envoyé à SENTYS...")
        try:
            requests.post(WEBHOOK_URL, timeout=2)
        except Exception as e:
            print(f"Erreur webhook: {e}")
        last_trigger = time.time()

cap.release()