# 🛡️ SENTYS - Système de Surveillance Intelligent

**SENTYS** est une solution de vidéosurveillance "Full On-Premise" combinant un serveur Node.js, une interface React et des nœuds de captation distribués (Raspberry Pi/ESP32). Ce document détaille le backlog complet trié par Epic.

-----

## 📑 Sommaire

1.  [Epic 1 : Gestion des Caméras (Cœur)](https://github.com/users/PasRP-Theo/projects/9/views/1?reload=1)
2.  [Epic 2 : Sécurité & Maintenance Serveur](https://github.com/users/PasRP-Theo/projects/9/views/1?reload=1)
3.  [Epic 3 : Dashboard React & UX](https://github.com/users/PasRP-Theo/projects/9/views/1?reload=1)
4.  [Epic 4 : Boîtier de Contrôle (Kiosque Pi)](https://github.com/users/PasRP-Theo/projects/9/views/1?reload=1)
5.  [Epic 5 : Déploiement Continu (CI/CD)](https://github.com/users/PasRP-Theo/projects/9/views/1?reload=1)
6.  [Spécifications Techniques & RGPD](https://github.com/users/PasRP-Theo/projects/9/views/1?reload=1)

-----

\<a name="epic-1"\>\</a\>

## 🎥 Epic 1 - Gestion des Caméras (Cœur du Système)

| ID | User Story | Priorité | État |
| :--- | :--- | :--- | :--- |
| **US-01** | Ajout manuel de caméras via URL (RTSP/HTTP) | P1 | Terminé |
| **US-02** | Conversion de flux en direct via FFmpeg (HLS) | P1 | Terminé |
| **US-03** | Contrôle manuel des flux (Play/Stop) | P1 | Terminé |
| **US-04** | Configuration de l'Autostart au démarrage | P2 | Terminé |
| **US-05** | Nettoyage des processus FFmpeg (anti-zombie) | P1 | Terminé |

> **Focus technique :** Utilisation de FFmpeg pour la segmentation HLS (`.m3u8`) afin de garantir une lecture universelle sur navigateurs.

-----

\<a name="epic-2"\>\</a\>

## 🔐 Epic 2 - Serveur Node.js (Sécurité & Maintenance)

| ID | User Story | Priorité | État |
| :--- | :--- | :--- | :--- |
| **US-11** | Rate Limiting (5 échecs / 15 min) | P1 | À faire |
| **US-12** | Détection mDNS/UDP des nœuds ESP32/Pi | P1 | À faire |
| **US-13** | Rotation des logs (10 Mo / 7 jours) | P2 | À faire |
| **US-14** | Heartbeat WebSockets (Ping/Pong) | P2 | À faire |
| **US-15** | Backup de la base SQLite/JSON via API | P2 | À faire |

-----

\<a name="epic-3"\>\</a\>

## 📊 Epic 3 - Dashboard React (Interface & UX)

| ID | User Story | Priorité | État |
| :--- | :--- | :--- | :--- |
| **US-31** | Message d'erreur clair pour Rate Limiting (429) | P2 | Terminé |
| **US-32** | Monitoring de l'état de santé des caméras | P1 | Terminé |
| **US-33** | Historique détaillé des événements (Logs UI) | P1 | Terminé |
| **US-34** | Grille vidéo interactive et mode Fullscreen | P1 | Terminé |
| **US-35** | Mode Sombre/Clair & Couleurs d'accentuation | P2 | Terminé |
| **US-36** | Accessibilité tactile (Cibles cliquables larges) | P2 | Terminé |
| **US-37** | Panel d'administration des utilisateurs (CRUD) | P1 | Terminé |
| **US-38** | Notifications Push via Web Push API (VAPID) | P1 | À faire |

-----

\<a name="epic-4"\>\</a\>

## 🖥️ Epic 4 - Boîtier de Contrôle (Configuration OS)

| ID | User Story | Priorité | État |
| :--- | :--- | :--- | :--- |
| **US-41** | Lancement automatique Chromium Kiosque | P1 | Terminé |
| **US-42** | Gestion de l'énergie de l'écran (DPMS) | P1 | Terminé |
| **US-43** | Clavier virtuel système (Onboard) | P2 | Terminé |
| **US-44** | Masquage du curseur de souris (Unclutter) | P2 | Terminé |
| **US-45** | Désactivation accélération GPU (Stabilité Pi 2B) | P1 | Terminé |
| **US-46** | Verrouillage par code PIN (AC 3 tentatives) | P1 | À faire |

-----

\<a name="epic-5"\>\</a\>

## 🚀 Epic 5 - Déploiement Continu (CI/CD)

| ID | User Story | Priorité | État |
| :--- | :--- | :--- | :--- |
| **US-50** | Runner GitHub Actions (Self-hosted) | P1 | Terminé |
| **US-51** | Gestion des processus via PM2 | P1 | Terminé |
| **US-52** | Route de diagnostic `/deploy-info.json` | P2 | Terminé |
| **US-53** | Pipeline de tests automatisés (Jest) | P1 | Terminé |

-----

\<a name="specs"\>\</a\>

## 🛡️ Spécifications Techniques & Sécurité

### Architecture des Données (PostgreSQL)

  * **Users** : Rôles RBAC et mots de passe hachés (Bcrypt).
  * **Alerts** : Stockage JSONB pour la flexibilité des métadonnées de détection.
  * **Push** : Gestion des abonnements Service Workers.

### Conformité RGPD

  * **Minimisation** : Captation restreinte à la propriété privée.
  * **Conservation** : Purge automatique des vidéos à **30 jours** et logs à **90 jours**.
  * **Souveraineté** : Hébergement 100% local, aucun flux vidéo ne transite par un cloud tiers.

### Sécurité Réseau

  * **VPN** : Accès distant via **Tailscale (WireGuard)**.
  * **Auth** : Tokens **JWT** (JSON Web Tokens) pour toutes les requêtes API.
  * **Isolation** : Serveur Node.js protégé par un reverse proxy et rate limiting local.

-----

Ce projet suit une méthodologie Agile. Les User Stories marquées **⏳ WIP** ou **À faire** sont les prochaines priorités du cycle de développement.