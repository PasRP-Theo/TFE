#!/bin/bash
# Setup script — Nœud caméra Sentys sur Raspberry Pi 3 (picam3)
# Exécuter en SSH : bash setup_picam3.sh
set -e

DEVICE_ID="pi-picam3"
DEVICE_NAME="Cam Picam3"
DEVICE_LOCATION="salon"
SERVER_URL="http://192.168.0.47:4000"
USER_HOME="/home/picam3"
MEDIAMTX_VERSION="1.11.3"
MEDIAMTX_ARCH="arm64v8"

echo "=== [1/7] Mise à jour du système ==="
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y \
    python3 python3-pip python3-venv \
    ffmpeg \
    libcamera-apps rpicam-apps \
    curl wget git

echo "=== [2/7] Dépendances Python ==="
pip3 install --break-system-packages requests pillow numpy 2>/dev/null || \
    pip3 install requests pillow numpy

echo "=== [3/7] Installation MediaMTX ==="
MEDIAMTX_URL="https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/mediamtx_v${MEDIAMTX_VERSION}_linux_${MEDIAMTX_ARCH}.tar.gz"
cd /tmp
wget -q "$MEDIAMTX_URL" -O mediamtx.tar.gz
tar -xzf mediamtx.tar.gz
sudo mv mediamtx /usr/local/bin/mediamtx
sudo chmod +x /usr/local/bin/mediamtx
rm -f mediamtx.tar.gz mediamtx.yml

echo "=== [4/7] Configuration MediaMTX ==="
sudo mkdir -p /etc/mediamtx
sudo tee /etc/mediamtx/mediamtx.yml > /dev/null <<'MTXEOF'
logLevel: info
logDestinations: [stdout]
api: yes
apiAddress: :9997
rtspAddress: :8554
paths:
  cam1:
    source: rpiCamera
    rpiCameraWidth: 1280
    rpiCameraHeight: 720
    rpiCameraFPS: 15
    rpiCameraHFlip: false
    rpiCameraVFlip: false
MTXEOF

echo "=== [5/7] Service systemd MediaMTX ==="
sudo tee /etc/systemd/system/mediamtx.service > /dev/null <<'SVCEOF'
[Unit]
Description=MediaMTX RTSP server
After=network.target

[Service]
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
SVCEOF

echo "=== [6/7] Configuration identité du nœud ==="
mkdir -p "$USER_HOME"
cat > "$USER_HOME/device.conf" <<CONFEOF
DEVICE_ID=${DEVICE_ID}
DEVICE_NAME=${DEVICE_NAME}
DEVICE_LOCATION=${DEVICE_LOCATION}
CONFEOF

echo "=== [6b/7] Copie de sentys_agent.py ==="
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/sentys_agent.py" ]; then
    cp "$SCRIPT_DIR/sentys_agent.py" "$USER_HOME/sentys_agent.py"
else
    echo "WARN: sentys_agent.py introuvable dans $SCRIPT_DIR — copier manuellement"
fi

echo "=== [7/7] Service systemd sentys-agent ==="
sudo tee /etc/systemd/system/sentys-agent.service > /dev/null <<AGEOF
[Unit]
Description=Sentys Camera Agent
After=network.target mediamtx.service

[Service]
ExecStart=/usr/bin/python3 ${USER_HOME}/sentys_agent.py
Restart=always
RestartSec=10
User=picam3
WorkingDirectory=${USER_HOME}
Environment=SERVER_URL=${SERVER_URL}

[Install]
WantedBy=multi-user.target
AGEOF

echo "=== Activation des services ==="
sudo systemctl daemon-reload
sudo systemctl enable mediamtx sentys-agent
sudo systemctl start mediamtx

echo ""
echo "=== VÉRIFICATION ==="
echo "Caméra détectée :"
rpicam-hello --list-cameras 2>/dev/null || libcamera-hello --list-cameras 2>/dev/null || echo "  WARN: rpicam-hello non disponible"
echo ""
echo "Status MediaMTX :"
sudo systemctl status mediamtx --no-pager -l | head -20
echo ""
echo "=== SETUP TERMINÉ ==="
echo "RTSP stream : rtsp://192.168.0.80:8554/cam1"
echo "Pour démarrer l'agent : sudo systemctl start sentys-agent"
echo "Logs agent  : sudo journalctl -u sentys-agent -f"
echo "Logs MediaMTX: sudo journalctl -u mediamtx -f"
