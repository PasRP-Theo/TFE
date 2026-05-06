# SENTYS - User Stories et Taches a Realiser

Ce document regroupe les user stories restantes du projet SENTYS sous un format Markdown exploitable dans le depot.

Chaque story suit le format standard :

> En tant que [role], je veux [fonctionnalite], afin de [benefice].

Les stories sont organisees par epic et priorisees selon leur importance pour le bon fonctionnement du systeme.

## Lecture rapide

- `P1` : priorite haute, indispensable pour un fonctionnement complet ou robuste.
- `P2` : priorite importante, mais non bloquante pour une premiere version exploitable.
- `Etat` : indique si la fonctionnalite est a faire, partielle, ou deja couverte en partie par le depot actuel.

---

## Epic 2 - Serveur Node.js

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-08 | En tant que serveur, je veux recevoir et relayer le flux MJPEG/H264 de chaque camera. | Route qui proxifie le flux de la caméra ; reconnexion automatique si la camera coupe. | P1 | Partiel |
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
| US-24 | En tant que client, je veux un diagnostic visuel instantané sur l'écran de contrôle sans avoir à lire de logs. | Code couleur simple : Indicateur visuel intégré au site (Vert : OK, Orange : Connexion instable, Rouge : Alerte/Panne). | P1 | Terminé |

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

## Epic 6 - Centre d'Alertes

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-27 | En tant qu'utilisateur, je veux consulter un centre d'alertes unifie, afin de voir rapidement tous les incidents du systeme. | Liste centralisee des alertes cameras/systeme ; tri par date ; filtre par criticite et statut ; acces protege JWT. | P1 | A faire |
| US-28 | En tant qu'utilisateur, je veux accuser reception d'une alerte, afin de distinguer les alertes vues des alertes en attente. | Bouton `Confirmer` par alerte ; statut `nouvelle`, `vue`, `confirmee` ; persistance en base ; mise a jour immediate dans l'UI. | P1 | A faire |
| US-29 | En tant qu'utilisateur, je veux exporter l'historique des alertes, afin de faire un suivi ou un rapport. | Export CSV ; filtres conserves dans l'export ; colonnes date/type/niveau/source/statut. | P2 | A faire |
| US-30 | En tant qu'utilisateur, je veux recevoir les alertes critiques en temps reel, afin de reagir sans rafraichir l'interface. | Push temps reel via WebSocket ou SSE ; badge de compteur ; notification visuelle dans le dashboard. | P1 | A faire |
| US-31 | En tant qu'administrateur, je veux configurer les canaux d'alerte, afin d'adapter la notification au contexte d'installation. | Activation/desactivation par canal ; support local UI, son, email ou webhook ; test d'envoi depuis les parametres. | P2 | A faire |

### Notes d'adaptation

- Cet epic est le prolongement naturel des reglages d'alertes deja presents dans l'application.
- Il manque aujourd'hui la vraie couche metier : stockage, consultation, acquittement et diffusion multi-canaux.

---

## Epic 7 - Intelligence Legere et Analyse

| ID | User story | Criteres d'acceptation | Prio | Etat |
| --- | --- | --- | --- | --- |
| US-32 | En tant qu'utilisateur, je veux voir les cameras les plus actives, afin d'identifier rapidement les zones sensibles. | Classement par nombre d'evenements de mouvement sur 24 h / 7 jours ; affichage top 5 ; mise a jour automatique. | P2 | A faire |
| US-33 | En tant qu'utilisateur, je veux recevoir un resume quotidien du systeme, afin d'avoir une vue synthese sans ouvrir chaque ecran. | Resume du nombre d'alertes, mouvements, cameras offline et enregistrements ; affichage dashboard et export texte/CSV. | P2 | A faire |
| US-34 | En tant qu'utilisateur, je veux visualiser les plages horaires les plus actives, afin de comprendre les habitudes de mouvement. | Histogramme ou vue par tranche horaire ; filtre par camera et periode ; donnees calculees depuis l'historique mouvement. | P2 | A faire |
| US-35 | En tant qu'utilisateur, je veux detecter les anomalies simples, afin d'etre alerte quand un comportement sort de l'ordinaire. | Regle simple sur camera anormalement silencieuse ou anormalement active ; seuil configurable ; generation d'alerte associee. | P2 | A faire |
| US-36 | En tant qu'administrateur, je veux activer ou desactiver les rapports d'analyse, afin de garder un systeme leger sur les petites installations. | Toggle de module dans les parametres ; calcul des statistiques desactive si option OFF ; impact visible dans l'interface. | P2 | A faire |

### Notes d'adaptation

- Cet epic reste volontairement leger : pas de modele IA lourd, seulement des statistiques et des regles simples exploitables dans le TFE.
- Il s'appuie sur les donnees deja presentes ou prevues : mouvements, etat des cameras, historique des alertes et enregistrements.

---

## Priorisation recommandee

Si l'objectif est de terminer le projet de facon pragmatique, l'ordre conseille est :

1. **Finaliser le coeur surveillance deja entame.**
   - US-10
   - US-11
   - US-13
   - US-18

2. **Ajouter le vrai cycle d'alertes.**
   - US-15
   - US-16
   - US-22
   - US-27
   - US-28
   - US-30
   - US-31

3. **Terminer la couche exploitation / installation.**
   - US-12
   - US-20
   - US-21
   - US-23
   - US-26

4. **Ajouter une couche d'analyse simple et exploitable.**
   - US-32
   - US-33
   - US-34
   - US-35
   - US-36

---

## Resume de l'etat actuel du depot

Fonctionnalites deja bien avancees :

- gestion des comptes et roles
- compte administrateur initial créé au premier démarrage
- personnalisation application / affichage / cameras / alertes
- vue camera avec agrandissement, historique, telechargement et suppression
- decouverte de cameras et noeuds Raspberry Pi
- page systeme consultable depuis le dashboard
- enregistrements locaux et nettoyage automatique de retention

Fonctionnalites encore structurantes a faire :

- vraie pile d'alertes metier
- centre d'alertes avec acquittement et export
- upload de videos depuis coupure WiFi
- notifications push
- resumes et statistiques d'activite
- detection d'anomalies simples
- mode boitier de controle PIN (Epic 4)
- securisation d'acces externe via Tailscale

---

## Fichier source conseille pour le suivi

Tu peux utiliser ce document comme base de suivi produit / TFE, puis completer chaque story avec :

- un statut (`todo`, `en cours`, `teste`, `termine`)
- un responsable
- une estimation
- des liens vers les fichiers ou PR associes
