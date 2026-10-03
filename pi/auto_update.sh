#!/bin/bash
# Auto-update sentys_agent.py depuis le serveur Sentys
# Mise à jour authentifiée (ETSI EN 303 645 §5.3) : la signature Ed25519 de l'agent
# est vérifiée avec la clé publique installée sur le Pi avant tout remplacement.

SERVER_URL="${SENTYS_SERVER_URL:-http://192.168.0.47:4000}"
AGENT_PATH="${HOME}/sentys_agent.py"
TMP_PATH="/tmp/sentys_agent_new.py"
TMP_SIG="/tmp/sentys_agent_new.py.sig"
PUBKEY="${SENTYS_AGENT_PUBKEY:-/etc/sentys/agent_pub.pem}"
MIN_SIZE=500  # octets minimum pour un fichier valide

cleanup() { rm -f "$TMP_PATH" "$TMP_SIG"; }
cleanup

if [ ! -r "$PUBKEY" ]; then
    echo "[UPDATE] Clé publique absente ($PUBKEY) — mise à jour refusée (voir pi/sign_agent.sh)"
    exit 1
fi

# Télécharger l'agent et sa signature (échec si HTTP non-2xx ou réseau KO)
if ! curl -sf --max-time 30 "$SERVER_URL/api/agent/sentys_agent.py" -o "$TMP_PATH" \
   || ! curl -sf --max-time 30 "$SERVER_URL/api/agent/sentys_agent.py.sig" -o "$TMP_SIG"; then
    echo "[UPDATE] Téléchargement échoué ou serveur inaccessible — mise à jour ignorée"
    cleanup
    exit 0
fi

# Authenticité : signature Ed25519 (un attaquant sur le réseau ne peut pas fournir un agent modifié)
if ! openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin -in "$TMP_PATH" -sigfile "$TMP_SIG" > /dev/null 2>&1; then
    echo "[UPDATE] Signature invalide — agent rejeté (possible altération)"
    logger -t sentys-agent "Mise à jour rejetée : signature invalide" 2>/dev/null || true
    cleanup
    exit 1
fi

# Vérifier que le fichier téléchargé n'est pas vide ou tronqué
DOWNLOADED_SIZE=$(stat -c%s "$TMP_PATH" 2>/dev/null || echo 0)
if [ "$DOWNLOADED_SIZE" -lt "$MIN_SIZE" ]; then
    echo "[UPDATE] Fichier téléchargé trop petit (${DOWNLOADED_SIZE} octets) — probablement corrompu, abandon"
    cleanup
    exit 1
fi

# Vérifier que c'est du Python valide (syntaxe)
if ! python3 -m py_compile "$TMP_PATH" 2>/dev/null; then
    echo "[UPDATE] Fichier téléchargé invalide (erreur de syntaxe Python) — abandon"
    cleanup
    exit 1
fi

# Comparer le checksum avec la version actuelle
NEW_SUM=$(sha256sum "$TMP_PATH" | cut -d' ' -f1)
CUR_SUM=$(sha256sum "$AGENT_PATH" 2>/dev/null | cut -d' ' -f1)

if [ "$NEW_SUM" = "$CUR_SUM" ]; then
    cleanup
    exit 0
fi

# Mise à jour validée — sauvegarder l'ancienne version avant de remplacer
cp "$AGENT_PATH" "${AGENT_PATH}.bak"
cp "$TMP_PATH" "$AGENT_PATH"
cleanup

echo "[UPDATE] Nouvelle version signée installée (sha256: ${NEW_SUM:0:12}…)"
# sudoers restreint recommandé : <user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart sentys-agent
sudo systemctl restart sentys-agent
echo "[UPDATE] Agent redémarré avec succès"
