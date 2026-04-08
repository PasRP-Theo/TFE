# AUBEPINES - User Stories et Taches a Realiser

Ce document regroupe les user stories restantes du projet AUBEPINES sous un format Markdown exploitable dans le depot.

Chaque story suit le format standard :

> En tant que [role], je veux [fonctionnalite], afin de [benefice].

Les stories sont organisees par epic et priorisees selon leur importance pour le bon fonctionnement du systeme.

## Lecture rapide

- `P1` : priorite haute, indispensable pour un fonctionnement complet ou robuste.
- `P2` : priorite importante, mais non bloquante pour une premiere version exploitable.
- `Etat` : indique si la fonctionnalite est a faire, partielle, ou deja couverte en partie par le depot actuel.

---

## Epic 1 - Firmware ESP32-S3

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-01 | En tant que systeme, je veux basculer en mode autonome (SD) quand le WiFi disparait, afin de ne jamais perdre d'enregistrement. | Bascule en moins de 5 s ; ecriture SD immediate ; log `MODE_AUTONOME` sur port serie ; tentative de reconnexion toutes les 30 min. | P1 | A faire |
| US-02 | En tant que systeme, je veux creer un hotspot WiFi (mode AP) si aucun reseau n'est disponible, afin de rester accessible localement. | AP `AUBEPINES_CAMx` visible ; page HTML `/status` accessible sur `192.168.4.1`. | P1 | A faire |
| US-03 | En tant que systeme, je veux entrer en deep sleep 60 s apres le dernier mouvement detecte, afin de maximiser l'autonomie batterie. | Deep sleep apres 60 s sans PIR ; consommation inferieure a `0,02 mA` en veille ; reveil PIR en moins de 2 s. | P1 | A faire |
| US-05 | En tant que systeme, je veux synchroniser les fichiers SD vers le serveur des que le WiFi est retabli. | Detection auto de reconnexion ; upload multipart `POST /upload` ; fichiers marques comme synchronises apres succes. | P1 | A faire |
| US-07 | En tant que systeme, je veux envoyer une alerte batterie au serveur quand le niveau descend sous 15 %. | `POST /alert` envoye sous 15 % ; pas de repetition tant que le niveau ne remonte pas au-dessus de 20 %. | P2 | A faire |

### Notes d'adaptation

- Cet epic concerne principalement le firmware ESP32-S3 et n'est pas couvert aujourd'hui par le code frontend/backend principal du depot.
- Il faudra probablement un sous-projet dedie pour separer le firmware, les endpoints serveur et les tests materiels.

---

## Epic 2 - Serveur Node.js

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-08 | En tant que serveur, je veux recevoir et relayer le flux MJPEG de chaque camera. | Route `GET /streams/:camId` qui proxifie le flux ESP32 ; reconnexion automatique si la camera coupe. | P1 | Partiel |
| US-09 | En tant que serveur, je veux recevoir et stocker les fichiers video envoyes par les cameras apres une coupure WiFi. | `POST /upload` accepte fichier + metadata ; enregistrement dans `/recordings/` et en base. | P1 | A faire |
| US-10 | En tant que serveur, je veux enregistrer en continu les flux camera via ffmpeg en segments de 5 minutes. | `ffmpeg` demarre au lancement ; segments nommes avec timestamp ; redemarrage auto si le flux coupe. | P1 | Partiel |
| US-11 | En tant que serveur, je veux surveiller l'etat de chaque camera toutes les 30 secondes. | Poll `GET /status` ; alerte si camera offline, batterie < 15 %, SD < 1 Go ; push WebSocket. | P1 | Partiel |
| US-12 | En tant qu'administrateur, je veux que le serveur redemarre automatiquement en cas de crash. | PM2 configure avec restart automatique ; redemarrage en moins de 30 s. | P2 | Partiel |
| US-13 | En tant que serveur, je veux exposer une API REST pour l'historique des enregistrements. | `GET /recordings` retourne une liste paginee ; filtrage par `cam_id` et dates ; acces protege par JWT. | P2 | Partiel |

### Notes d'adaptation

- Le depot gere deja les cameras, les enregistrements, les historiques et `ffmpeg`, mais pas encore sous la forme ciblee de toutes ces stories.
- L'enregistrement existe deja, mais la granularite exacte des segments, l'upload depuis coupure WiFi et l'API paginee globale sont encore a completer.

---

## Epic 3 - Dashboard React

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-14 | En tant qu'utilisateur, je veux voir les flux video en direct de toutes les cameras dans une grille. | Grille commutable ; clic pour agrandir ; badge `HORS LIGNE` si offline ; statut `REC/PAUSE` visible. | P1 | Partiel avance |
| US-15 | En tant qu'utilisateur, je veux consulter l'historique des alertes filtre par type, date et niveau. | Filtres type/date/niveau ; pagination 20 items ; bouton `CONFIRMER` ; export CSV. | P1 | A faire |
| US-16 | En tant qu'utilisateur, je veux recevoir des notifications push sur mon telephone pour chaque alerte critique. | Abonnement VAPID sauvegarde ; notification recue sur telephone 4G ; actions `Voir` / `Ignorer`. | P1 | A faire |
| US-17 | En tant qu'utilisateur, je veux que le dashboard reste consultable en mode offline. | Service Worker enregistre ; assets en cache ; bandeau `MODE OFFLINE` visible. | P1 | Partiel |
| US-18 | En tant qu'utilisateur, je veux consulter l'historique video avec lecteur integre. | Liste fichiers avec date/duree ; lecteur HTML5 ; telechargement possible. | P2 | Partiel |
| US-19 | En tant qu'administrateur, je veux gerer les utilisateurs depuis le dashboard. | Formulaire d'ajout ; modification de role en un clic ; suppression avec confirmation. | P2 | Deja largement couvert |

### Notes d'adaptation

- La grille camera, l'agrandissement, les badges et l'historique video existent deja en bonne partie.
- La gestion des utilisateurs, la personnalisation et plusieurs parametres admin sont deja implantes.
- Le prochain vrai manque fonctionnel ici est surtout la gestion des alertes et les notifications push.

---

## Epic 4 - Boitier de Controle Physique

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-20 | En tant que client, je veux acceder au panneau de controle via un code PIN. | Blocage apres 3 tentatives erronees ; verrouillage auto apres 5 min d'inactivite. | P1 | A faire |
| US-21 | En tant que client, je veux activer ou desactiver le mode surveillance en un clic. | Bouton toggle ON/OFF ; confirmation visuelle ; etat synchronise avec le serveur. | P1 | A faire |
| US-22 | En tant que client, je veux voir les alertes critiques en temps reel avec bouton de confirmation. | Badge de comptage ; code couleur critique/warning/info ; mise a jour WebSocket. | P1 | A faire |
| US-23 | En tant que client, je veux voir l'etat general du systeme sur le boitier. | Barres CPU/RAM/disque ; uptime formate ; toggles par module. | P2 | Partiel conceptuel |

### Notes d'adaptation

- Cet epic demande probablement une interface dediee type kiosk ou controle tactile simplifie.
- Une partie de la vue systeme existe deja dans le dashboard, mais pas encore dans un mode boitier verrouille au PIN.

---

## Epic 5 - Securite et Infrastructure

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-26 | En tant que client, je veux acceder au dashboard depuis l'exterieur uniquement via le VPN Tailscale. | Tailscale configure ; tunnel actif depuis telephone externe ; aucun port public expose. | P2 | A faire / Infrastructure |

### Notes d'adaptation

- Cette story ne se traite pas seulement dans le code : elle depend surtout du deploiement, du reseau et de l'environnement host.
- Elle doit etre documentee dans les procedures d'installation et de maintenance.

---

## Priorisation recommandee

Si l'objectif est de terminer le projet de facon pragmatique, l'ordre conseille est :

1. Finaliser le coeur surveillance deja entame.
   - US-10
   - US-11
   - US-13
   - US-18

2. Ajouter le vrai cycle d'alertes.
   - US-15
   - US-16
   - US-22

3. Gerer la robustesse des noeuds autonomes ESP32-S3.
   - US-01
   - US-02
   - US-03
   - US-05
   - US-07

4. Terminer la couche exploitation / installation.
   - US-12
   - US-20
   - US-21
   - US-23
   - US-26

---

## Resume de l'etat actuel du depot

Fonctionnalites deja bien avancees :

- gestion des comptes et roles
- bootstrap admin `root/root`
- personnalisation application / affichage / cameras / alertes
- vue camera avec agrandissement, historique, telechargement et suppression
- decouverte de cameras et noeuds Raspberry Pi
- page systeme consultable depuis le dashboard
- enregistrements locaux et nettoyage automatique de retention

Fonctionnalites encore structurantes a faire :

- vraie pile d'alertes metier
- upload de videos depuis coupure WiFi
- notifications push
- mode boitier de controle PIN
- firmware autonome ESP32-S3 complet
- securisation d'acces externe via Tailscale

---

## Fichier source conseille pour le suivi

Tu peux utiliser ce document comme base de suivi produit / TFE, puis completer chaque story avec :

- un statut (`todo`, `en cours`, `teste`, `termine`)
- un responsable
- une estimation
- des liens vers les fichiers ou PR associes
