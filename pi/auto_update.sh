#!/bin/bash
# Auto-update sentys_agent.py depuis le serveur Sentys

SERVER_URL="http://192.168.0.47:4000"
AGENT_PATH="/home/picam/sentys_agent.py"
TMP_PATH="/tmp/sentys_agent_new.py"

# Télécharger la dernière version
if ! curl -sf "$SERVER_URL/api/agent/sentys_agent.py" -o "$TMP_PATH"; then
    echo "[UPDATE] Serveur inaccessible — mise à jour ignorée"
    exit 0
fi

# Comparer avec la version actuelle
if diff -q "$TMP_PATH" "$AGENT_PATH" > /dev/null 2>&1; then
    rm -f "$TMP_PATH"
    exit 0
fi

# Mise à jour détectée — remplacer et redémarrer
echo "[UPDATE] Nouvelle version détectée — mise à jour en cours"
cp "$TMP_PATH" "$AGENT_PATH"
rm -f "$TMP_PATH"
sudo systemctl restart sentys-agent
echo "[UPDATE] Agent redémarré avec succès"
