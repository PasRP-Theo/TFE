#!/bin/bash
# Signe pi/sentys_agent.py (Ed25519) — à exécuter sur le POSTE DE L'ADMINISTRATEUR, jamais sur le serveur.
#
# Première fois :
#   openssl genpkey -algorithm ed25519 -out ~/.sentys-agent-signing.pem && chmod 600 ~/.sentys-agent-signing.pem
#   openssl pkey -in ~/.sentys-agent-signing.pem -pubout -out pi/agent_signing_pub.pem
#   (committer pi/agent_signing_pub.pem ; copier ce fichier sur chaque Pi dans /etc/sentys/agent_pub.pem)
#
# À chaque modification de l'agent :
#   ./pi/sign_agent.sh && git add pi/sentys_agent.py.sig
set -euo pipefail

KEY="${SENTYS_AGENT_SIGNING_KEY:-$HOME/.sentys-agent-signing.pem}"
DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT="$DIR/sentys_agent.py"
SIG="$DIR/sentys_agent.py.sig"
PUB="$DIR/agent_signing_pub.pem"

if [ ! -f "$KEY" ]; then
  echo "Clé privée introuvable : $KEY (voir l'en-tête de ce script)" >&2
  exit 1
fi

openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$AGENT" -out "$SIG"
openssl pkeyutl -verify -pubin -inkey "$PUB" -rawin -in "$AGENT" -sigfile "$SIG" > /dev/null
echo "Signature écrite : $SIG (sha256 agent : $(sha256sum "$AGENT" | cut -c1-16)…)"
