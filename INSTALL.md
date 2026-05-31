# SENTYS — Installation locale (Rapporteur)

Système de surveillance résidentiel résilient — TFE EPHEC 2025-2026  
**Théo Mertens** | Rapporteur : M. Dewulf

---

## Prérequis

Installer les logiciels suivants avant de commencer :

| Logiciel | Version minimale | Lien |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| PostgreSQL | 12+ | https://www.postgresql.org |
| FFmpeg | 4.2+ | https://ffmpeg.org/download.html |
| Git | — | https://git-scm.com |

---

## 1. Cloner le projet

```bash
git clone https://github.com/PasRP-Theo/TFE.git
cd TFE
```

---

## 2. Base de données PostgreSQL

Ouvrir pgAdmin ou un terminal PostgreSQL et créer la base :

```sql
CREATE DATABASE sentys;
```

Les tables sont créées **automatiquement** au premier démarrage du serveur.

---

## 3. Configuration du serveur

```bash
cd server
```

Créer le fichier `.env` dans le dossier `server/` :

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sentys
DB_USER=postgres
DB_PASSWORD=votre_mot_de_passe_postgres

PORT=4000
JWT_SECRET=une_chaine_aleatoire_longue
NODE_ENV=development

RECORDINGS_DIR=../recordings
HLS_DIR=../hls
RECORDINGS_RETENTION_DAYS=30
```

---

## 4. Lancer le serveur

```bash
cd server
npm install
npm run dev
```

Le serveur démarre sur **http://localhost:4000**

Au premier démarrage, un compte administrateur est créé automatiquement :
- **Identifiant :** `root`
- **Mot de passe :** `root`

> Ce compte est supprimé automatiquement dès qu'un nouvel administrateur est créé.

---

## 5. Lancer le client (interface web)

Ouvrir un **nouveau terminal** :

```bash
cd client
npm install
npm run dev
```

L'interface est accessible sur **http://localhost:5173**

---

## 6. Se connecter

Ouvrir http://localhost:5173 dans un navigateur et se connecter avec :

```
Identifiant : root
Mot de passe : root
```

---

## Fonctionnalités accessibles sans caméra physique

Même sans Raspberry Pi ni caméra branchée, il est possible de :

- Naviguer dans le dashboard et l'interface complète
- Créer des utilisateurs et tester le système de rôles (admin / user)
- Consulter le panneau d'alertes et l'historique
- Tester les notifications push (après abonnement depuis le navigateur)
- Accéder aux paramètres système
- Ajouter une caméra RTSP manuellement (si une caméra IP est disponible sur le réseau)

---

## Structure du projet

```
TFE/
├── client/          → Interface React (frontend)
├── server/          → API Node.js + Express (backend)
├── pi/              → Agent Python pour Raspberry Pi Zero 2W
├── recordings/      → Clips vidéo enregistrés
└── hls/             → Segments HLS (streaming live)
```

---

## En cas de problème

**Port 4000 déjà utilisé**
```bash
# Windows
netstat -ano | findstr :4000
# Linux/Mac
lsof -i :4000
```

**Erreur PostgreSQL "permission denied"**
```sql
GRANT ALL ON SCHEMA public TO postgres;
```

**FFmpeg non trouvé**  
Vérifier que FFmpeg est bien dans le PATH système :
```bash
ffmpeg -version
```
