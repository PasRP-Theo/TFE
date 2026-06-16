#!/bin/bash
# Auto-update sentys_agent.py depuis le serveur Sentys

SERVER_URL="http://192.168.0.47:4000"
AGENT_PATH="${HOME}/sentys_agent.py"
TMP_PATH="/tmp/sentys_agent_new.py"
MIN_SIZE=500  # octets minimum pour un fichier valide

rm -f "$TMP_PATH"

# Télécharger la dernière version (échec si HTTP non-2xx ou réseau KO)
if ! curl -sf --max-time 30 "$SERVER_URL/api/agent/sentys_agent.py" -o "$TMP_PATH"; then
    echo "[UPDATE] Téléchargement échoué ou serveur inaccessible — mise à jour ignorée"
    rm -f "$TMP_PATH"
    exit 0
fi

# Vérifier que le fichier téléchargé n'est pas vide ou tronqué
DOWNLOADED_SIZE=$(stat -c%s "$TMP_PATH" 2>/dev/null || echo 0)
if [ "$DOWNLOADED_SIZE" -lt "$MIN_SIZE" ]; then
    echo "[UPDATE] Fichier téléchargé trop petit (${DOWNLOADED_SIZE} octets) — probablement corrompu, abandon"
    rm -f "$TMP_PATH"
    exit 1
fi

# Vérifier que c'est du Python valide (syntaxe)
if ! python3 -m py_compile "$TMP_PATH" 2>/dev/null; then
    echo "[UPDATE] Fichier téléchargé invalide (erreur de syntaxe Python) — abandon"
    rm -f "$TMP_PATH"
    exit 1
fi

# Comparer le checksum avec la version actuelle
NEW_SUM=$(sha256sum "$TMP_PATH" | cut -d' ' -f1)
CUR_SUM=$(sha256sum "$AGENT_PATH" 2>/dev/null | cut -d' ' -f1)

if [ "$NEW_SUM" = "$CUR_SUM" ]; then
    rm -f "$TMP_PATH"
    exit 0
fi

# Mise à jour validée — sauvegarder l'ancienne version avant de remplacer
cp "$AGENT_PATH" "${AGENT_PATH}.bak"
cp "$TMP_PATH" "$AGENT_PATH"
rm -f "$TMP_PATH"

echo "[UPDATE] Nouvelle version installée (sha256: ${NEW_SUM:0:12}…)"
sudo systemctl restart sentys-agent
echo "[UPDATE] Agent redémarré avec succès"
