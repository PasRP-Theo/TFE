# Politique de confidentialité et information des personnes filmées — Sentys (brouillon)

> ⚖️ **Brouillon à faire valider.** Le modèle officiel du pictogramme est fixé par l'arrêté royal du 10 février 2008 (modifié). Téléchargez le modèle à jour depuis le site du SPF Intérieur ou de la police et vérifiez les mentions obligatoires avant impression. Les textes ci-dessous sont des propositions.

---

## Partie A — Pictogramme (à l'entrée de la zone filmée)

Format : modèle officiel belge « Surveillance par caméra », à placer **avant** l'entrée dans le champ de vision, lisible et visible.

```
┌─────────────────────────────────────────────┐
│        [ICÔNE CAMÉRA — modèle officiel]       │
│                                             │
│        SURVEILLANCE PAR CAMÉRA               │
│        Loi du 21 mars 2007                   │
│                                             │
│  Responsable : [Nom du responsable]          │
│  Contact     : [adresse e-mail dédiée]       │
│                                             │
│  Plus d'informations : [URL ou QR code vers  │
│  la notice d'information ci-dessous]         │
└─────────────────────────────────────────────┘
```

## Partie B — Panneau d'information complémentaire (RGPD art. 13, premier niveau)

> **Ce domicile est équipé d'un système de vidéosurveillance.**
>
> **Responsable** : [Nom], [contact e-mail].
> **Finalité** : protection des biens et des personnes ; preuve en cas d'infraction ou de dommage.
> **Base légale** : intérêt légitime du responsable.
> **Conservation** : 30 jours maximum, sauf si les images sont nécessaires pour prouver une infraction ou un dommage, ou identifier un auteur.
> **Pas d'enregistrement du son. Pas de reconnaissance faciale.** Les images restent sur un serveur au domicile ; elles ne sont transmises qu'aux autorités sur demande.
> **Vos droits** : accès aux images vous concernant, effacement, limitation, opposition, réclamation auprès de l'Autorité de protection des données (www.autoriteprotectiondonnees.be).
> Notice complète : [URL / QR code].

## Partie C — Notice d'information complète (deuxième niveau)

### 1. Qui traite vos données ?
[Nom], [adresse — à fournir sur demande, ne pas publier], [e-mail]. Pas de délégué à la protection des données (non obligatoire pour un particulier).

### 2. Quelles données ?
- **Personnes filmées** : images vidéo (sans son), date et heure, détection d'un mouvement et sa catégorie (personne, animal, véhicule). Aucune identification automatique des personnes.
- **Utilisateurs de l'application** : identifiant, empreinte du mot de passe, paramètres de double authentification (chiffrés), sessions (date, navigateur, adresse IP), journal de sécurité, abonnements aux notifications (si activées).

### 3. Pourquoi ?
Sécurité du domicile et de ses occupants ; constitution de preuves en cas d'infraction ou de dommage ; sécurité du système lui-même (journal d'accès).

### 4. Sur quelle base ?
Intérêt légitime du responsable (RGPD art. 6.1.f) ; consentement pour les notifications push (activables et désactivables à tout moment).

### 5. Qui y a accès ?
Les seuls utilisateurs autorisés du système (comptes nominatifs, double authentification recommandée). Chaque consultation d'image est journalisée. Les autorités policières et judiciaires peuvent obtenir les images dans le cadre légal.

**Prestataires techniques** (aucun n'accède aux images) :
- **Vercel Inc.** (États-Unis) héberge les fichiers de l'interface web : il voit l'adresse IP et le navigateur des personnes qui ouvrent l'application, pas les images ni les comptes ⚖️ (transfert encadré par le Data Privacy Framework — à vérifier).
- **Tailscale Inc.** relaie la connexion chiffrée entre votre appareil et le domicile ; le chiffrement se termine au domicile.
- **Services de notification** de votre navigateur (Google, Mozilla, Apple) : ils transmettent une notification chiffrée dont ils ne peuvent pas lire le contenu.
- **Open-Meteo** (Suisse) reçoit une position approximative (≈ 1 km) pour la météo.

### 6. Combien de temps ?
Images : 30 jours maximum, effacement automatique. Images conservées comme preuve : jusqu'à la fin de la procédure (décision motivée et journalisée). Journal de sécurité : 1 an. Comptes : jusqu'à leur suppression.

### 7. Vos droits
- **Personnes filmées** : demande d'accès aux images vous concernant, motivée (date, heure, lieu approximatif), à [e-mail]. Réponse sous un mois (art. 12.3). Les autres personnes visibles seront floutées. Droit d'opposition et d'effacement, sauf si les images doivent être conservées comme preuve.
- **Utilisateurs** : export de vos données et suppression de votre compte directement dans *Réglages → Mon compte* ; rectification auprès d'un administrateur.
- **Réclamation** : Autorité de protection des données, rue de la Presse 35, 1000 Bruxelles — www.autoriteprotectiondonnees.be.

### 8. Stockage dans votre navigateur
L'application conserve vos préférences d'affichage (stockage local) et un cookie de session `HttpOnly` strictement nécessaire à la connexion. Aucun cookie de mesure d'audience ni de publicité. Ces éléments étant strictement nécessaires au service demandé, aucun consentement n'est requis (ePrivacy art. 5.3) ; les notifications push nécessitent votre accord explicite.

### 9. Sécurité
Chiffrement des communications (TLS), sessions courtes, double authentification, mots de passe conformes aux recommandations NIST, identifiants des caméras chiffrés, caméras isolées d'Internet, journal des accès. Détail : `docs/securite/`.

---

## Partie D — Déclaration des caméras (⚖️ à confirmer)

- **Plateforme** : www.declarationcamera.be (SPF Intérieur), à faire **avant** la mise en service, à mettre à jour à chaque modification, à confirmer chaque année.
- **Cas d'une habitation privée** : la loi prévoit une exception pour les caméras installées par une personne physique, **à l'intérieur** de son habitation, à des fins personnelles et domestiques. Le cas des **caméras extérieures** filmant uniquement la propriété (allée, porte d'entrée) et celui d'une caméra captant une partie de la voie publique sont **à confirmer** auprès de la police locale.
- **Registre des activités de traitement d'images** (loi caméras, art. 6 §2 / 7 §2) ⚖️ : à tenir si la déclaration est obligatoire — le registre `REGISTRE-TRAITEMENTS.md` (T1) peut servir de base.
