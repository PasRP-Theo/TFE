# Guide réseau et hébergement — Sentys

Configuration hors code nécessaire pour atteindre le niveau de sécurité visé (ETSI EN 303 645, OWASP ASVS niveau 2, recommandations CCB/ENISA). Chaque section indique comment **vérifier**.

## 1. Architecture cible

```
                         Internet
                            │
         ┌──────────────────┼────────────────────┐
   Vercel (statique)   Tailscale Funnel (TLS terminé sur le serveur)
         │                  │ https://sentys.<tailnet>.ts.net
         ▼                  ▼
   Navigateur ───────▶ 127.0.0.1:4001 (listener PUBLIC : utilisateurs uniquement)
                            │
   ┌─────────────── Serveur Sentys (192.168.0.47) ───────────────┐
   │ nginx :443 ──▶ :4000 (listener LAN : interface + appareils)  │
   │ PostgreSQL 127.0.0.1:5432 · go2rtc API 127.0.0.1:1984        │
   │ WebRTC :8555 (LAN / tailnet uniquement)                      │
   └──────────────────────────────┬───────────────────────────────┘
                                  │ RTSP (serveur → caméras uniquement)
   ┌──────────────── VLAN IoT (pas d'accès Internet) ─────────────┐
   │ Caméras IP · Pi Zero 2W (MediaMTX) · ESP32-CAM · Pi 2B panneau│
   └───────────────────────────────────────────────────────────────┘
```

## 2. Réseau domestique

### 2.1 Segmentation (VLAN ou réseau invité isolé)

| Réseau | Exemple | Contenu |
|---|---|---|
| LAN principal | 192.168.0.0/24 | Serveur, ordinateurs, téléphones |
| IoT | 192.168.10.0/24 | Caméras, Pi, ESP32, panneau |

Sans VLAN (box opérateur) : utiliser au minimum le **réseau invité avec isolation des clients** pour les caméras, ou un routeur OpenWrt derrière la box.

### 2.2 Règles de pare-feu (ordre d'évaluation)

| # | Source | Destination | Port | Action | Raison |
|---|---|---|---|---|---|
| 1 | IoT | serveur | TCP 4000 | ACCEPT | Annonces, mouvements, uploads des appareils |
| 2 | serveur | IoT | TCP 554, 8554 | ACCEPT | Lecture RTSP par le serveur |
| 3 | IoT | routeur | UDP 123, 53 | ACCEPT | NTP et DNS locaux |
| 4 | IoT | **Internet** | * | **DROP** | Pas de « cloud » fabricant, pas d'exfiltration |
| 5 | IoT | LAN | * | DROP | Une caméra compromise ne voit pas le reste du réseau |
| 6 | Internet | * | * | DROP | Aucun port ouvert / redirigé sur la box (pas d'UPnP) |

Exemple OpenWrt (`/etc/config/firewall`) :

```
config zone
    option name 'iot'
    option network 'iot'
    option input 'REJECT'
    option output 'ACCEPT'
    option forward 'REJECT'

# pas de forwarding iot → wan : blocage sortant vers Internet
config rule
    option name 'iot-to-sentys'
    option src 'iot'
    option dest 'lan'
    option dest_ip '192.168.0.47'
    option dest_port '4000'
    option proto 'tcp'
    option target 'ACCEPT'

config rule
    option name 'iot-dns-ntp'
    option src 'iot'
    option dest_port '53 123'
    option proto 'udp'
    option target 'ACCEPT'
```

**Vérification** : depuis un Pi du VLAN IoT, `curl -m 5 https://example.com` doit échouer ; `curl http://192.168.0.47:4000/health` doit répondre. Dans les journaux du routeur : aucune connexion sortante des caméras.

### 2.3 Durcissement des caméras IP (ETSI EN 303 645 §5.1, 5.3, 5.6)

- [ ] Mot de passe par défaut changé (≥ 15 caractères, unique par caméra) ; compte dédié en lecture seule pour le flux RTSP si la caméra le permet
- [ ] P2P / UID / « cloud » du fabricant **désactivés** ; UPnP désactivé ; e-mail / FTP / Telnet désactivés
- [ ] Accès d'administration HTTP limité au LAN ; ONVIF désactivé s'il n'est pas utilisé
- [ ] NTP pointé vers le routeur (horodatage fiable des preuves)
- [ ] Firmware à jour, téléchargé sur le site officiel, empreinte vérifiée ; date de mise à jour notée
- [ ] Champ de vision limité à la propriété ; **masques de confidentialité** sur la voie publique et chez les voisins
- [ ] Audio désactivé dans la caméra (Sentys ne l'enregistre pas : `-an`)

### 2.4 Pi et ESP32

- [ ] `DEVICE_TOKEN` dans `~/device.conf` (Réglages → Appareils), droits `600`
- [ ] Clé publique de l'agent dans `/etc/sentys/agent_pub.pem` (voir `pi/sign_agent.sh`)
- [ ] sudoers restreint : `picam ALL=(root) NOPASSWD: /usr/bin/systemctl restart sentys-agent, /usr/bin/systemctl start mediamtx, /usr/bin/systemctl stop mediamtx`
- [ ] SSH par clé uniquement (`PasswordAuthentication no`), mot de passe `pi` par défaut changé
- [ ] MediaMTX : API (9997) limitée à `127.0.0.1`, identifiants RTSP si le Pi est hors VLAN isolé
- [ ] Panneau Pi 2B : compte dédié de rôle `user` (le mode kiosk sans mot de passe a été supprimé), verrouillage de l'écran par l'OS

## 3. Serveur

### 3.1 Pare-feu de l'hôte (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/24 to any port 443 proto tcp      # interface LAN (nginx)
sudo ufw allow from 192.168.10.0/24 to any port 4000 proto tcp    # appareils IoT
# tant que les appareils sont encore sur le LAN principal : les autoriser un par un
# sudo ufw allow from 192.168.0.101 to any port 4000 proto tcp
sudo ufw allow from 192.168.0.0/24 to any port 8555               # WebRTC LAN
sudo ufw allow in on tailscale0                                    # tailnet (SSH, WebRTC)
sudo ufw enable
```

- PostgreSQL : `listen_addresses = 'localhost'` ; `pg_hba.conf` en `scram-sha-256` ; rôles de `server/sql/roles.sql`.
- go2rtc : API sur `127.0.0.1:1984` (`server/go2rtc.yaml`).
- SSH : clés uniquement, accessible via le tailnet seulement.

**Vérification** : depuis un autre poste, `nmap -p- 192.168.0.47` → seuls 443 (et 4000 depuis le VLAN IoT) ouverts.

### 3.2 Exposition Internet : Tailscale Funnel

```bash
# dans server/.env : PUBLIC_PORT=4001 et ALLOWED_ORIGINS=https://<projet>.vercel.app,https://192.168.0.47
sudo tailscale funnel --bg --https=443 http://127.0.0.1:4001
tailscale funnel status
```

- Seul le listener **public** est exposé : les routes des appareils y répondent 404, l'agent Pi n'y est pas téléchargeable.
- TLS est terminé sur le serveur (certificat Let's Encrypt géré par Tailscale) : Tailscale ne voit pas le contenu.
- Activer la **MFA** du fournisseur d'identité du tailnet ; ACL Tailscale limitant les appareils autorisés.
- ⚠️ **À vérifier** : la présence de l'en-tête `X-Forwarded-For` ajouté par Funnel. S'il est absent, toutes les requêtes Internet partagent l'adresse `127.0.0.1` pour la limitation de débit (le verrouillage par compte reste effectif). Contrôle : se connecter depuis le téléphone en 4G puis `SELECT ip_address FROM audit_logs ORDER BY created_at DESC LIMIT 1`.

**Vérification TLS** : `testssl.sh https://sentys.<tailnet>.ts.net` → TLS 1.2/1.3 uniquement, pas de suite faible.
**Vérification d'exposition** : `curl -i https://sentys.<tailnet>.ts.net/api/camera-nodes/announce` → 404 ; `curl -i https://sentys.<tailnet>.ts.net/hls/1/index.m3u8` → 401.

### 3.3 Interface LAN : nginx

Configuration fournie : `deploy/nginx/sentys-lan.conf` (TLS 1.2/1.3, journaux sans chaîne de requête, WebSocket). Préférer une **CA locale** (`mkcert`) installée sur les appareils plutôt qu'un certificat auto-signé.

### 3.4 Chiffrement au repos et sauvegardes (RGPD art. 32.1.a et 32.1.c)

- **Disque** : données (`recordings/`, `hls/`, PostgreSQL, `~/.sentys/`) sur une partition **LUKS** (`cryptsetup luksFormat`), déverrouillée au démarrage (clé sur support amovible ou saisie). Protège les images en cas de vol du serveur.
- **Sauvegarde quotidienne chiffrée** (`age`, clé publique sur le serveur, clé privée hors ligne) :

```bash
pg_dump -Fc sentys | age -r "$(cat ~/.sentys/backup.pub)" > /mnt/backup/sentys-$(date +%F).dump.age
tar -C ~ -cz .sentys | age -r "$(cat ~/.sentys/backup.pub)" > /mnt/backup/sentys-secrets-$(date +%F).tgz.age
find /mnt/backup -name 'sentys-*' -mtime +30 -delete      # même durée que les images
```

- Les enregistrements vidéo ne sont pas sauvegardés hors site (minimisation) ; les preuves (`recordings/_preuves/`) sont copiées manuellement.
- **Tester une restauration** chaque trimestre.

### 3.5 CI/CD et runner self-hosted

- Runner GitHub sous un utilisateur dédié (`gha-runner`) **sans** accès à `~/.sentys`, `.env`, PostgreSQL ni aux enregistrements ; le déploiement passe par un script autorisé en `sudo -u sentys` limité.
- Ne jamais déclencher de workflow `pull_request` sur le runner self-hosted (dépôt public).
- GitHub → Settings → Code security : activer *Dependabot alerts*, *Secret scanning*, *Push protection* ; *branch protection* sur `main` (tests obligatoires).

## 4. Vercel (frontend)

1. Nouveau projet → dépôt `PasRP-Theo/TFE` → **Root Directory : `client`** (framework Vite détecté, `client/vercel.json` appliqué).
2. *Environment Variables* (Production) : `VITE_API_URL=https://sentys.<tailnet>.ts.net`.
3. **Désactiver** Vercel Analytics, Speed Insights et le *Vercel Toolbar* sur les déploiements de prévisualisation.
4. Les déploiements de prévisualisation n'ont pas accès à l'API (origine absente de `ALLOWED_ORIGINS`) : comportement voulu.
5. *Ignored Build Step* : `git diff --quiet HEAD^ HEAD -- .` (rebuild uniquement si `client/` change).

**Vérification** : DevTools → Réseau sur l'URL Vercel : seuls les fichiers statiques viennent de `vercel.app` ; toutes les requêtes `/api`, `/auth`, `/hls`, `/recordings` partent vers `*.ts.net`. Aucun appel à `fonts.googleapis.com`.
**En-têtes** : https://observatory.mozilla.org sur l'URL Vercel.

Limitation connue : Safari bloque les cookies tiers ; depuis Vercel, la session Safari ne survit pas au rechargement de la page (nouvelle connexion). L'interface LAN (même origine) n'est pas concernée.
