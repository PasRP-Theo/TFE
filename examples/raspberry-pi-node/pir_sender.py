#!/usr/bin/env python3
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from urllib import error, request

try:
    from gpiozero import MotionSensor
except Exception as exc:
    print(f"gpiozero introuvable: {exc}", file=sys.stderr)
    sys.exit(1)


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def post_motion_event(server_base_url, device_id, motion):
    payload = json.dumps(
        {
            "deviceId": device_id,
            "motion": motion,
            "detectedAt": utc_now_iso(),
        }
    ).encode("utf-8")

    req = request.Request(
        url=f"{server_base_url.rstrip('/')}/api/camera-nodes/motion",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(req, timeout=5) as response:
        return response.status, response.read().decode("utf-8", errors="ignore")


def main():
    parser = argparse.ArgumentParser(description="Envoie les detections PIR au serveur principal.")
    parser.add_argument("--server", required=True, help="URL de base du serveur principal, ex: http://192.168.0.10:4000")
    parser.add_argument("--device-id", default="pi-cam-01", help="Identifiant du noeud camera")
    parser.add_argument("--gpio", type=int, default=17, help="GPIO utilise pour le PIR")
    parser.add_argument("--cooldown", type=float, default=5.0, help="Delai minimum entre deux envois")
    args = parser.parse_args()

    sensor = MotionSensor(args.gpio)
    last_sent_at = 0.0

    print(f"PIR actif sur GPIO{args.gpio}, envoi vers {args.server}")

    while True:
        sensor.wait_for_motion()
        now = time.time()
        if now - last_sent_at < args.cooldown:
            continue

        try:
            status, body = post_motion_event(args.server, args.device_id, True)
            print(f"[{utc_now_iso()}] mouvement detecte, status={status}, reponse={body}")
            last_sent_at = now
        except error.URLError as exc:
            print(f"[{utc_now_iso()}] echec envoi HTTP: {exc}", file=sys.stderr)
        except Exception as exc:
            print(f"[{utc_now_iso()}] erreur inattendue: {exc}", file=sys.stderr)

        time.sleep(0.2)


if __name__ == "__main__":
    main()