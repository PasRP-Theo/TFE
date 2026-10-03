# Checklist de conformité finale — Sentys

Légende : ✅ fait dans le code (vérifié par tests ou commande) · ⚙️ configuration à réaliser sur l'installation · ⚖️ à confirmer (APD, police, promoteur) · ⏳ reste à faire

## Sécurité applicative (OWASP ASVS niveau 2 / Top 10)

| | Exigence | Statut | Preuve |
|---|---|---|---|
| A01 | Toutes les routes utilisateur authentifiées ; vidéo via URL signée | ✅ | `media.test.js`, `fb42c01`, `1c6e982` |
| A01 | Routes des appareils authentifiées (jeton) et invisibles depuis Internet | ✅ | `deviceAuth.test.js`, `networkZone.test.js` |
| A02 | Secrets hors dépôt, valeurs faibles refusées, identifiants caméras et MFA chiffrés | ✅ | `secrets.test.js`, `dataCrypto.test.js`, `credentials.test.js` |
| A03 | Requêtes SQL paramétrées | ✅ | revue de code (audit) |
| A05 | En-têtes de sécurité, CSP stricte, CORS en liste blanche | ✅ | `httpHeaders.test.js` |
| A06 | 0 vulnérabilité élevée en production, audit en CI, Dependabot, SBOM | ✅ | job « dépendances » |
| A07 | Politique de mots de passe, anti-énumération, verrouillage, MFA, sessions révocables | ✅ | `passwordPolicy`, `passwords`, `totp`, `auth.test.js` |
| A08 | Mise à jour de l'agent signée, actions CI épinglées | ✅ / ⚙️ | `f66a4e2` — **signer l'agent** (`pi/sign_agent.sh`) |
| A09 | Journal d'audit (connexions, accès vidéo, configuration), sans secret, purgé | ✅ | `audit_logs`, `retention/` |
| — | Aucun compte ni PIN par défaut | ✅ | `setup.test.js`, `pin.test.js` |

## Exposition et réseau (ETSI EN 303 645 §5.5, 5.6 ; CCB)

| Exigence | Statut |
|---|---|
| Tunnel limité au listener public (127.0.0.1:4001) | ✅ code / ⚙️ `tailscale funnel` |
| TLS 1.2+ (Funnel, nginx LAN) | ⚙️ vérifier avec `testssl.sh` |
| go2rtc API locale, RTSP de re-diffusion désactivé | ✅ |
| Caméras en VLAN IoT, sortie Internet bloquée | ⚙️ guide §2 |
| Mots de passe des caméras changés, P2P/UPnP/cloud désactivés, firmware à jour | ⚙️ guide §2.3 |
| Pare-feu hôte, PostgreSQL local | ⚙️ guide §3.1 |
| `X-Forwarded-For` transmis par Funnel (limitation par IP) | ⏳ à vérifier |

## Secrets (§5.4)

| Exigence | Statut |
|---|---|
| Scan gitleaks en CI ; *secret scanning* + *push protection* GitHub | ✅ CI / ⚙️ réglages GitHub |
| Rotation si les valeurs de l'ancien README sont en production | ⚙️ `POLITIQUE-SECRETS.md` §3 |
| Rôles SQL dédiés (pas `postgres`) | ⚙️ `server/sql/roles.sql` |
| Sauvegarde chiffrée de `~/.sentys/` (poivre, clés) | ⚙️ guide §3.4 |

## Données personnelles (RGPD)

| Article | Exigence | Statut |
|---|---|---|
| 5.1.c | Minimisation : pas d'audio, pas de reconnaissance faciale, notifications discrètes, polices locales, coordonnées arrondies, pas d'analytics | ✅ |
| 5.1.e | Conservation : images 30 j (plafonnées), alertes 90 j, mouvements 30 j, audit 365 j, purge automatique | ✅ |
| 5.1.f / 32 | Intégrité et confidentialité (voir sécurité) | ✅ / ⚙️ |
| 5.1.f / 32 | Chiffrement au repos des enregistrements (LUKS) | ⚙️ |
| 5.2 | Journal d'accès aux images | ✅ |
| 13-14 | Information : politique de confidentialité, panneau | ✅ brouillon / ⚖️ |
| 15, 20 | Export des données du compte | ✅ |
| 15 | Droit d'accès aux images des personnes filmées | ✅ procédure (`POLITIQUE-CONFIDENTIALITE.md` §7) |
| 17 | Suppression effective du compte (cascade, pseudonymisation) | ✅ |
| 25 | Protection des données dès la conception et par défaut | ✅ |
| 30 | Registre des traitements | ✅ brouillon / ⚖️ applicabilité |
| 33-34 | Procédure de violation | ✅ `PROCEDURE-VIOLATION.md` |
| 35 | AIPD | ✅ brouillon (volontaire) / ⚖️ obligation |
| 44+ | Transferts hors UE (Vercel, services push) | ⚖️ vérifier DPA / DPF |

## Loi caméras du 21 mars 2007 (⚖️ à confirmer)

| Exigence | Statut |
|---|---|
| Déclaration sur declarationcamera.be (selon intérieur / extérieur) | ⚖️ |
| Pictogramme conforme au modèle officiel | ⚖️ texte proposé |
| Pas de caméra dirigée vers la voie publique ou chez les voisins ; masques | ⚙️ / ⚖️ |
| Conservation 1 mois maximum, sauf preuve | ✅ (plafond codé, preuves motivées et journalisées) |
| Accès aux images restreint et tracé | ✅ |

## ePrivacy

| Exigence | Statut |
|---|---|
| Notifications push sur consentement explicite, retrait possible | ✅ |
| Stockage local strictement nécessaire uniquement (préférences, cookie de session HttpOnly) | ✅ |

## CRA (bonne pratique de conception)

| Exigence | Statut |
|---|---|
| Gestion des vulnérabilités (audit CI, Dependabot) | ✅ |
| SBOM CycloneDX à chaque build | ✅ |
| Mises à jour de sécurité authentifiées (agent Pi) | ✅ / ⚙️ signer |
| Politique de divulgation des vulnérabilités (`SECURITY.md`) | ⏳ recommandé |
