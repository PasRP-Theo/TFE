# Analyse d'impact relative à la protection des données (AIPD simplifiée) — Sentys

> **Statut : brouillon.** Méthode inspirée du guide de l'APD et de la méthode PIA de la CNIL.
> ⚖️ Pour un particulier, l'AIPD n'est **probablement pas obligatoire** (pas de traitement à grande échelle ni de surveillance systématique d'une zone accessible au public au sens de la liste de l'APD) — **à confirmer**. Elle est réalisée volontairement : elle documente les choix de conception du TFE et devient pertinente si une caméra capte la voie publique.

## 1. Description du traitement

Système de vidéosurveillance résidentiel **local** : caméras IP, Raspberry Pi et ESP32 sur le réseau domestique ; serveur local (Node.js, PostgreSQL, ffmpeg) ; interface web servie localement et depuis Vercel (fichiers statiques uniquement) ; accès distant par Tailscale Funnel (TLS terminé sur le serveur). Détection de mouvement et classification d'objets (personne / animal / véhicule) **sans identification**.

Flux de données :

```
Caméras (VLAN IoT, sans Internet) ──RTSP──▶ Serveur local ──HTTPS (Funnel)──▶ Navigateur de l'utilisateur
                                              │                                   ▲
                                              └── notifications push chiffrées ───┘ (via service push)
Vercel ──fichiers statiques (HTML/JS/CSS)──▶ Navigateur        (aucune donnée personnelle de l'API)
```

## 2. Nécessité et proportionnalité

| Principe | Mise en œuvre |
|---|---|
| Finalité déterminée | Sécurité du domicile ; preuve d'infraction ou de dommage |
| Minimisation | Pas d'audio ; pas de reconnaissance faciale ; détection limitée à des classes d'objets ; notifications sans détail ; coordonnées météo arrondies ; pas d'analytics |
| Champ de vision | Orientation vers la propriété privée ; masques de confidentialité de la caméra sur toute zone publique ou voisine ⚖️ |
| Conservation | 30 jours maximum (plafond codé), preuves sur décision motivée et journalisée |
| Information | Pictogramme et panneau (voir `POLITIQUE-CONFIDENTIALITE.md`) ; politique de confidentialité |
| Droits | Export et suppression de compte dans l'application ; procédure de droit d'accès aux images pour les personnes filmées |
| Sous-traitants | Limités à l'interface statique (Vercel), au relais réseau chiffré (Tailscale) et aux services push |

## 3. Risques pour les personnes

Échelle : vraisemblance et gravité de 1 (négligeable) à 4 (maximale). « Avant » = audit initial ; « après » = mesures du code actuel + configuration recommandée.

| # | Risque | Source | Impact pour les personnes | Avant (V×G) | Mesures | Après (V×G) |
|---|---|---|---|---|---|---|
| R1 | Accès illégitime au flux live ou aux enregistrements | Attaquant Internet / LAN | Atteinte à la vie privée du foyer, repérage des habitudes, cambriolage | 4×4 | URLs signées liées à l'utilisateur, sessions courtes ES256, MFA, listener public séparé, en-têtes de sécurité, journal d'accès | 1×4 |
| R2 | Prise de contrôle du système (compte admin) | Mot de passe par défaut, réutilisation de mot de passe | Accès complet aux images, désactivation de la surveillance | 4×4 | Aucun compte par défaut (jeton d'installation), politique NIST, verrouillage progressif, MFA | 1×4 |
| R3 | Vol des identifiants des caméras | Fuite de la base ou de l'API | Accès direct aux caméras | 3×3 | Chiffrement AES-256-GCM (clé hors base), API sans identifiants, go2rtc local | 1×3 |
| R4 | Captation de la voie publique / des voisins | Orientation des caméras | Surveillance de tiers sans base légale | 3×3 | Orientation, masques de confidentialité, vérification ⚖️ | 1×3 (dépend de l'installation) |
| R5 | Conservation excessive | Absence de purge | Exposition prolongée | 3×2 | Purge automatique plafonnée, preuves motivées | 1×2 |
| R6 | Caméra compromise exfiltrant des images | Firmware vulnérable, « cloud » du fabricant | Fuite d'images vers des tiers | 3×4 | VLAN IoT, blocage sortant vers Internet, P2P/UPnP désactivés | 1×4 |
| R7 | Divulgation via notifications | Écran verrouillé, service push | Révélation de présence/absence | 2×2 | Contenu minimal par défaut, désabonnement à la déconnexion | 1×1 |
| R8 | Ex-utilisateur conservant un accès | Compte supprimé, appareil perdu | Accès aux images après départ | 3×3 | Révocation effective (sessions, push), suppression en cascade, réinitialisation MFA | 1×3 |
| R9 | Fuite de données par le frontend hébergé | Tiers (Vercel) | Profilage des visiteurs | 2×1 | Fichiers statiques uniquement, aucun rewrite, pas d'analytics ; IP des visiteurs vue par Vercel ⚖️ | 2×1 |
| R10 | Compromission de la chaîne logicielle | Dépendance vulnérable, runner CI | Exécution de code sur le serveur | 3×4 | npm audit en CI, Dependabot, SBOM, actions épinglées, signature de l'agent Pi, runner isolé (configuration) | 2×4 |
| R11 | Perte de données / indisponibilité | Panne disque, rançongiciel | Perte de preuves | 2×2 | Sauvegardes chiffrées et testées (configuration) | 1×2 |

## 4. Risques résiduels et plan d'action

| Risque résiduel | Action | Responsable | Échéance |
|---|---|---|---|
| R4 dépend de l'orientation réelle | Vérifier chaque champ de vision, appliquer les masques, documenter avec captures | [à compléter] | Avant mise en service |
| R6, R10, R11 dépendent de la configuration | Appliquer `docs/securite/GUIDE-RESEAU-ET-HEBERGEMENT.md` | [à compléter] | Avant ouverture du tunnel |
| R9 transfert hors UE (Vercel) | Vérifier DPA / DPF ; alternative : interface servie uniquement en local | [à compléter] | — |
| Safari et cookies tiers | Sur Safari via Vercel, reconnexion après rechargement (limitation, pas de risque accru) | — | — |

## 5. Avis et validation

| | |
|---|---|
| Avis des personnes concernées (occupants) | [à recueillir] |
| Décision | [à compléter] |
| Révision | À chaque ajout de caméra, changement de champ de vision, activation des capteurs ou de nouvelles fonctions de détection |
