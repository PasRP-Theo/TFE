# Sentys — Base de données PostgreSQL

## Vue d'ensemble

La base de données PostgreSQL de Sentys est initialisée automatiquement au premier démarrage du serveur (`initDB()` dans `server/src/db/index.js`). Toutes les tables sont créées via `CREATE TABLE IF NOT EXISTS` — aucun script SQL manuel n'est requis.

Le schéma est conçu autour de deux principes :
- **Séparation staging / persistant** : les appareils découverts sur le réseau passent par une table temporaire avant d'être validés en données permanentes.
- **Intégrité référentielle** : les clés étrangères garantissent la cohérence même en cas de suppression (ON DELETE SET NULL ou CASCADE selon le cas).

---

## Tables

### `users`

Comptes humains ayant accès au dashboard.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PK | Identifiant auto-incrémenté |
| `username` | VARCHAR(255) | UNIQUE NOT NULL | Identifiant de connexion |
| `password` | VARCHAR(255) | NOT NULL | Hash bcrypt (coût 12) |
| `role` | VARCHAR(20) | DEFAULT `'user'` | `'admin'` ou `'user'` |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date de création |

**Rôles :**
- `admin` — accès complet : configuration, gestion des utilisateurs, acquittement des alertes, journaux d'audit
- `user` — lecture seule : flux vidéo, historique, notifications

**Hachage des mots de passe :**
Le mot de passe en clair ne touche jamais la base de données. À chaque création ou modification de compte, le serveur applique `bcrypt.hash(password, 12)` avant l'INSERT/UPDATE. À la connexion, `bcrypt.compare(password, hash)` est utilisé — la comparaison se fait sans jamais déchiffrer le hash. Le coût 12 représente 2¹² = 4096 itérations, rendant le brute-force prohibitif même en cas de fuite de la base.

**Note :** le champ s'appelle `password` (pas `password_hash`) dans le code réel. Le hash bcrypt est stocké, jamais le mot de passe en clair.

**Compte administrateur initial :**
Au premier démarrage, si la table est vide, un compte `root / root` avec le rôle `admin` est créé automatiquement. Son `id` est mémorisé dans `app_settings.bootstrap_admin_user_id`. Dès qu'un nouvel utilisateur avec le rôle `admin` est créé via le panneau de gestion, ce compte root est **supprimé automatiquement** et `default_admin_active` est remis à `false`.

---

### `app_settings`

Table singleton (une seule ligne, `id = 1`) contenant toute la configuration de l'application.

| Colonne | Type | Default | Description |
|---------|------|---------|-------------|
| `id` | SMALLINT | PK, CHECK (id=1) | Clé singleton |
| `app_name` | VARCHAR(120) | `'SENTYS'` | Nom affiché dans l'interface |
| `app_subtitle` | VARCHAR(180) | | Sous-titre |
| `system_version` | VARCHAR(40) | | Version affichée |
| `login_message` | VARCHAR(240) | | Message sur la page de connexion |
| `interface_language` | VARCHAR(10) | `'fr-FR'` | Langue de l'interface |
| `time_format` | VARCHAR(8) | `'24h'` | Format d'heure (`'24h'` ou `'12h'`) |
| `show_system_version` | BOOLEAN | `true` | Afficher la version dans le header |
| `ui_density` | VARCHAR(16) | `'standard'` | Densité d'affichage |
| `camera_card_size` | VARCHAR(16) | `'standard'` | Taille des cartes caméra |
| `show_status_panel` | BOOLEAN | `true` | Afficher le panneau d'état |
| `camera_autostart_enabled` | BOOLEAN | `true` | Démarrage auto des caméras |
| `camera_refresh_seconds` | INTEGER | `3` | Intervalle de rafraîchissement |
| `show_offline_cameras` | BOOLEAN | `true` | Afficher les caméras hors ligne |
| `default_camera_add_mode` | VARCHAR(16) | `'discover'` | Onglet par défaut d'ajout caméra |
| `camera_discovery_interval_seconds` | INTEGER | `5` | Intervalle de scan réseau |
| `alerts_realtime_enabled` | BOOLEAN | `true` | Alertes temps réel activées |
| `alerts_daily_summary_enabled` | BOOLEAN | `false` | Résumé quotidien par push |
| `alerts_sound_enabled` | BOOLEAN | `true` | Sons d'alerte activés |
| `alerts_disconnect_enabled` | BOOLEAN | `true` | Alerte sur déconnexion caméra |
| `surveillance_mode` | BOOLEAN | `true` | Mode surveillance global ON/OFF |
| `bootstrap_admin_user_id` | INTEGER | FK → `users.id` | ID du compte admin créé au démarrage |
| `default_admin_active` | BOOLEAN | `false` | Vrai si le mot de passe root par défaut est encore actif |
| `kiosk_pin` | VARCHAR(10) | `'1234'` | Code PIN du boîtier physique (4-8 chiffres) |
| `updated_at` | TIMESTAMP | NOW() | Dernière modification |

**Contrainte CHECK sur `kiosk_pin` :** `^[0-9]{4,8}$` — chiffres uniquement, entre 4 et 8 caractères.

**Pourquoi un singleton ?** La configuration globale n'a pas vocation à avoir plusieurs lignes. Le `CHECK (id = 1)` empêche toute insertion parasite. La mise à jour se fait toujours par `UPDATE app_settings SET ... WHERE id = 1`.

---

### `cameras`

Caméras fixes configurées dans le système (IP cameras, RTSP fixe).

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PK | Identifiant |
| `name` | VARCHAR(100) | NOT NULL | Nom affiché |
| `rtsp_url` | VARCHAR(500) | NOT NULL | URL du flux RTSP |
| `location` | VARCHAR(100) | DEFAULT `''` | Emplacement physique |
| `active` | BOOLEAN | DEFAULT `true` | Caméra active ou désactivée |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date d'ajout |

**Note :** le statut temps réel de la caméra (running, paused, stopped, reconnecting) est géré **en mémoire** par le manager Node.js (`cameraManager`), pas en base. La base ne stocke que la configuration persistante.

---

### `camera_discoveries`

**Table de staging temporaire.** Contient les appareils qui se sont annoncés sur le réseau local mais n'ont pas encore été validés par l'administrateur.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PK | Identifiant |
| `device_id` | VARCHAR(120) | UNIQUE NOT NULL | Identifiant unique de l'appareil |
| `name` | VARCHAR(120) | NOT NULL | Nom déclaré par l'appareil |
| `host` | VARCHAR(120) | NOT NULL | Adresse IP |
| `stream_url` | VARCHAR(500) | NOT NULL | URL du flux RTSP annoncé |
| `location` | VARCHAR(120) | DEFAULT `''` | Emplacement déclaré |
| `model` | VARCHAR(120) | DEFAULT `''` | Modèle matériel |
| `source` | VARCHAR(30) | DEFAULT `'announce'` | Origine de la découverte |
| `last_seen_at` | TIMESTAMP | DEFAULT NOW() | Dernière annonce reçue |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Première découverte |

**Valeurs de `source` autorisées :** `announce`, `mdns`, `manual`, `pi-node`, `probe`

**Durée de vie (TTL) :** une tâche planifiée (`scheduleDiscoveryCleanup`) purge automatiquement les entrées dont `last_seen_at` est plus ancien que 10 minutes. Si un appareil cesse de s'annoncer, il disparaît de la liste sans intervention manuelle.

**Flux complet :**
```
Pi démarre → POST /api/camera-nodes/announce
                    ↓
         UPSERT dans camera_discoveries
         (mise à jour de last_seen_at si device_id déjà connu)
                    ↓
         Visible dans l'interface "Annonces réseau"
                    ↓
         Admin clique "Connecter"
                    ↓
         INSERT dans camera_nodes (permanent)
         + DELETE de camera_discoveries
```

Cette séparation garantit que `camera_nodes` ne contient que des appareils explicitement validés.

---

### `camera_nodes`

Nœuds caméras Pi Zero 2W validés et actifs dans le système.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PK | Identifiant |
| `device_id` | VARCHAR(120) | UNIQUE NOT NULL | Identifiant unique (ex: `pi-salon`) |
| `name` | VARCHAR(120) | NOT NULL | Nom affiché |
| `host` | VARCHAR(120) | NOT NULL | Adresse IP du Pi |
| `stream_url` | VARCHAR(500) | NOT NULL | URL RTSP (ex: `rtsp://192.168.0.x:8554/cam1`) |
| `location` | VARCHAR(120) | DEFAULT `''` | Emplacement physique |
| `model` | VARCHAR(120) | DEFAULT `''` | Modèle matériel |
| `source` | VARCHAR(30) | DEFAULT `'pi-node'` | Origine de l'enregistrement |
| `motion_detected` | BOOLEAN | DEFAULT `false` | Mouvement détecté en ce moment |
| `last_motion_at` | TIMESTAMP | | Dernier mouvement détecté |
| `last_seen_at` | TIMESTAMP | DEFAULT NOW() | Dernière annonce reçue |
| `cfg_clip_duration` | INTEGER | DEFAULT `30` | Durée des clips hors ligne (secondes) |
| `cfg_max_storage_mb` | INTEGER | DEFAULT `500` | Limite stockage offline (Mo) |
| `cfg_announce_interval` | INTEGER | DEFAULT `30` | Intervalle d'annonce du Pi (secondes) |
| `cfg_rtsp_port` | INTEGER | DEFAULT `8554` | Port RTSP de MediaMTX |
| `cfg_rtsp_path` | VARCHAR(60) | DEFAULT `'cam1'` | Chemin RTSP de MediaMTX |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date de connexion initiale |

**Valeurs de `source` autorisées :** `pi-node`, `announce`, `manual`, `mediamtx`, `ia_detector`

**Colonnes `cfg_*` :** ces paramètres sont lus par le Pi via `GET /api/camera-nodes/:id/config` et appliqués dynamiquement à l'agent de supervision. Modifier ces valeurs dans l'interface admin met à jour le comportement du Pi sans redéploiement.

**Index :**
- `idx_camera_nodes_last_seen` sur `last_seen_at DESC` — détection rapide des nœuds hors ligne
- `idx_camera_nodes_host` sur `host` — résolution rapide par IP

---

### `camera_node_motion_events`

Événements de mouvement détectés par les nœuds Pi, incluant les enregistrements hors ligne.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PK | Identifiant |
| `device_id` | VARCHAR(120) | NOT NULL, FK → `camera_nodes.device_id` | Nœud ayant détecté le mouvement |
| `motion` | BOOLEAN | DEFAULT `true` | `true` = mouvement, `false` = fin de mouvement |
| `offline_recording` | BOOLEAN | NOT NULL, DEFAULT `false` | `true` si le clip a été enregistré hors ligne |
| `recording_path` | VARCHAR(255) | | URL du clip MP4 (`/recordings/{cameraId}/...`) |
| `detected_at` | TIMESTAMP | DEFAULT NOW() | Horodatage de la détection |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Insertion en base |

**Flux hors ligne :**

Quand le Pi perd la connexion au serveur, il enregistre des clips MP4 localement. Au retour de la connexion :
1. Le Pi uploade chaque clip via `POST /api/camera-nodes/:id/upload-recording`
2. Le serveur déplace le fichier vers `/recordings/{cameraId}/`
3. Une ligne est insérée avec `offline_recording = true` et le chemin final dans `recording_path`
4. Le clip apparaît dans l'historique avec le badge **HORS LIGNE**

**Index :** `idx_camera_node_motion_events_device_time` sur `(device_id, detected_at DESC)` — accès rapide à l'historique d'un nœud.

---

### `alerts`

Historique centralisé de tous les événements de sécurité du système avec déduplication.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PK | Identifiant |
| `source_type` | VARCHAR(40) | NOT NULL | Type de source (`camera`, `camera_node`, `system`) |
| `source_id` | VARCHAR(120) | | Identifiant de la source (device_id, etc.) |
| `camera_id` | INTEGER | FK → `cameras.id` ON DELETE SET NULL | Caméra liée (si applicable) |
| `alert_type` | VARCHAR(60) | NOT NULL | Type d'alerte (`CAMERA_OFFLINE`, `MOTION_DETECTED`, `BATTERY_LOW`, ...) |
| `level` | VARCHAR(20) | NOT NULL, DEFAULT `'info'` | Criticité |
| `title` | VARCHAR(180) | NOT NULL | Titre affiché |
| `message` | TEXT | NOT NULL | Description détaillée |
| `metadata` | JSONB | NOT NULL, DEFAULT `'{}'` | Données variables selon le type |
| `dedupe_key` | VARCHAR(160) | Index unique partiel | Clé de déduplication |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT `'new'` | État de traitement |
| `acknowledged_by` | INTEGER | FK → `users.id` ON DELETE SET NULL | Admin ayant acquitté |
| `acknowledged_at` | TIMESTAMP | | Date d'acquittement |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Date de création |

**Niveaux (`level`) :** `info`, `warning`, `critical`

**Statuts (`status`) :** `new`, `viewed`, `acknowledged`

**Déduplication via `dedupe_key` :**
Certains événements peuvent se répéter rapidement (ex: caméra qui se déconnecte/reconnecte en boucle). Le champ `dedupe_key` permet d'éviter les doublons : avant d'insérer une alerte, le serveur vérifie si une alerte non acquittée avec la même `dedupe_key` existe déjà. Si oui, l'insertion est ignorée. L'index est **partiel** (`WHERE dedupe_key IS NOT NULL`) pour ne pas bloquer les alertes sans clé.

**Champ `metadata` (JSONB) :**
Permet de stocker des données structurées sans modifier le schéma. Exemples :
```json
{ "battery_level": 12, "device_id": "pi-salon" }
{ "clip_url": "/recordings/69/rec_1234.mp4", "duration": 30 }
```

**Index :**
- `idx_alerts_created_at` — tri chronologique
- `idx_alerts_status_level` — filtrage par statut et criticité
- `idx_alerts_type_source` — déduplication et recherche par type
- `idx_alerts_dedupe_key_unique` — contrainte d'unicité partielle
- `idx_alerts_camera_id` — jointure avec cameras (WHERE NOT NULL)
- `idx_alerts_source_id` — recherche par source

---

### `push_subscriptions`

Abonnements Web Push (protocole VAPID) des utilisateurs.

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PK | Identifiant |
| `endpoint` | TEXT | UNIQUE NOT NULL | URL de l'endpoint push (fournie par le navigateur) |
| `p256dh` | TEXT | NOT NULL | Clé publique de chiffrement |
| `auth` | TEXT | NOT NULL | Secret d'authentification |
| `user_id` | INTEGER | FK → `users.id` ON DELETE SET NULL | Utilisateur propriétaire |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date d'abonnement |

Un utilisateur peut avoir plusieurs abonnements actifs (téléphone + tablette + PC). Chaque appareil/navigateur génère un `endpoint` unique. Quand une alerte est déclenchée, le serveur envoie une notification à **tous** les endpoints actifs.

---

## Relations entre tables

```
users ──────────────────────────────────┐
  │                                     │ acknowledged_by
  │ bootstrap_admin_user_id             ↓
  └──────────────► app_settings    alerts ◄──── cameras
                                     ↑
push_subscriptions ──► users         │ source_id (logique, pas FK)
                                     │
camera_nodes ◄── camera_node_motion_events
     ▲
     │ (staging → permanent)
camera_discoveries
```

---

## Données gérées en mémoire (hors base)

Certaines données sont volontairement **hors base** pour des raisons de performance :

| Donnée | Emplacement | Raison |
|--------|-------------|--------|
| Statut temps réel des caméras (running/paused/stopped/reconnecting) | Map en mémoire dans `cameraManager` | Mis à jour plusieurs fois par seconde — écrire en base serait trop coûteux |
| Processus FFmpeg actifs | Map en mémoire | Handles OS non sérialisables |
| État de go2rtc | Détecté à la demande via HTTP | Processus externe |
| Heartbeats clients | Timer en mémoire | Données éphémères |

Au redémarrage du serveur (PM2 restart), ces états sont réinitialisés. Les caméras marquées `active = true` en base sont redémarrées automatiquement.

---

## Maintenance

### Purge automatique des découvertes réseau
```js
scheduleDiscoveryCleanup(10, 5 * 60 * 1000)
// TTL: 10 min — vérifié toutes les 5 min
```

### Purge des enregistrements vidéo
Gérée par le manager Node.js selon la durée de rétention configurée (défaut : 30 jours). Les fichiers MP4 sont supprimés du disque et les entrées `camera_node_motion_events` correspondantes sont nettoyées.

### Sauvegarde recommandée
```bash
pg_dump sentys > backup_$(date +%Y%m%d).sql
```

### Connexion directe
```bash
psql -U postgres -d sentys
```
