# Registre des activités de traitement — Sentys (brouillon)

> **Statut : brouillon à compléter et valider.** Base : RGPD art. 30, loi belge du 30 juillet 2018, loi caméras du 21 mars 2007.
> Les zones `[à compléter]` dépendent de l'installation réelle. Les points marqués ⚖️ sont **à confirmer** (APD, police locale, promoteur) : ce document ne constitue pas un avis juridique.

## 0. Applicabilité (⚖️ à confirmer)

- Une installation **strictement domestique** (caméras ne filmant que l'intérieur ou la propriété privée) relève en principe de l'**exemption domestique** (RGPD art. 2.2.c) : le registre n'est alors pas obligatoire.
- Dès qu'une caméra capte, même partiellement, **la voie publique ou la propriété d'un voisin**, l'exemption ne s'applique plus (CJUE, *Ryneš*, C-212/13, 11/12/2014) : le RGPD s'applique et ce registre devient pertinent.
- En tant que **produit** (TFE), Sentys applique ce registre par défaut (Privacy by Design, art. 25).

## 1. Responsable du traitement

| | |
|---|---|
| Responsable | [à compléter : nom de la personne / du ménage qui exploite l'installation] |
| Adresse | [à compléter — ne pas publier dans le dépôt] |
| Contact vie privée | [à compléter : adresse e-mail dédiée] |
| Délégué à la protection des données | Non requis (particulier, art. 37) |
| Sous-traitants | Vercel Inc. (hébergement de l'interface statique), Tailscale Inc. (relais réseau chiffré), services push des navigateurs (Google, Mozilla, Apple), Open-Meteo (météo, coordonnées approximatives) |

## 2. Traitements

### T1 — Vidéosurveillance (images et détections)

| Rubrique | Contenu |
|---|---|
| Finalités | Protection des biens et des personnes du domicile ; preuve en cas d'infraction ou de dommage ; identification d'un auteur |
| Base légale | Intérêt légitime du responsable (art. 6.1.f) ; loi caméras (lieu fermé non accessible au public) ⚖️ |
| Personnes concernées | Occupants, visiteurs, prestataires/livreurs ; passants et voisins **uniquement si** le champ de vision les inclut (à éviter) |
| Données | Images vidéo (sans son : `-an`), horodatage, identifiant de caméra, événements de mouvement, classe de détection (personne / animal / véhicule) |
| Données sensibles (art. 9) | Aucune : pas de reconnaissance faciale ni d'identification biométrique. Toute évolution en ce sens exige une nouvelle AIPD |
| Destinataires | Utilisateurs autorisés du système (comptes nominatifs) ; police / autorités judiciaires sur demande |
| Transferts hors UE | Aucun pour les images (stockées et diffusées depuis le serveur local ; le tunnel Tailscale Funnel relaie un flux chiffré de bout en bout, TLS terminé sur le serveur) |
| Conservation | **30 jours maximum**, purge automatique quotidienne (`RECORDINGS_RETENTION_DAYS`, plafonné à 30 par le code) ; enregistrements « conservés comme preuve » (`_preuves/`) : jusqu'à la fin de la procédure, motif journalisé |
| Sécurité | URLs vidéo signées (10–30 min) liées à l'utilisateur ; journal d'accès aux images ; chiffrement disque recommandé (LUKS) ; caméras isolées et bloquées vers Internet ; identifiants RTSP chiffrés AES-256-GCM |

### T2 — Comptes utilisateurs et sécurité

| Rubrique | Contenu |
|---|---|
| Finalités | Contrôle d'accès, traçabilité, détection d'abus |
| Base légale | Intérêt légitime (sécurité du système, art. 6.1.f et art. 32) |
| Personnes | Utilisateurs du système (membres du foyer) |
| Données | Identifiant, rôle, empreinte du mot de passe (HMAC poivré + bcrypt), secret TOTP chiffré, codes de récupération hachés, sessions (date, user-agent, IP), journal d'audit (action, date, IP) |
| Destinataires | Administrateurs du système |
| Transferts | Aucun |
| Conservation | Compte : jusqu'à suppression (effacement effectif, journal pseudonymisé) ; sessions révoquées/expirées : 30 j ; journal d'audit : 365 j ; codes MFA utilisés : 30 j |

### T3 — Notifications push

| Rubrique | Contenu |
|---|---|
| Finalité | Prévenir les utilisateurs d'une alerte |
| Base légale | Consentement (activation explicite dans Réglages ; ePrivacy art. 5.3 pour l'accès au terminal) |
| Données | Adresse d'abonnement (endpoint), clés de chiffrement, compte associé |
| Destinataires | Service push du navigateur (Google FCM, Mozilla Autopush, Apple) : contenu chiffré de bout en bout (RFC 8291), le service ne voit que l'émetteur et l'horodatage |
| Transferts hors UE | Possibles (métadonnées) selon le navigateur ⚖️ — garanties : DPF / clauses contractuelles du fournisseur |
| Contenu | Minimal par défaut (« Nouvelle alerte ») |
| Conservation | Jusqu'au retrait du consentement, à la déconnexion, à la suppression du compte ou à l'expiration signalée par le service |

### T4 — Hébergement de l'interface (Vercel)

| Rubrique | Contenu |
|---|---|
| Finalité | Distribuer l'application web (fichiers statiques) |
| Données | Adresse IP, user-agent, horodatage des requêtes vers les fichiers statiques |
| Destinataire | Vercel Inc. (sous-traitant) |
| Transfert hors UE | États-Unis ⚖️ — vérifier l'adhésion au Data Privacy Framework et le DPA de Vercel en vigueur |
| Mesures | Aucune donnée vidéo, de compte ou de capteur ne transite par Vercel (aucun rewrite vers l'API) ; Vercel Analytics et Speed Insights désactivés |
| Conservation | Selon la politique de Vercel (journaux) |

### T5 — Page « Maison » (liste de courses, notes, météo)

| Rubrique | Contenu |
|---|---|
| Finalité | Organisation du foyer |
| Base légale | Intérêt légitime ; usage domestique |
| Données | Textes saisis (partagés par le foyer, non rattachés à un compte) ; coordonnées **approximatives** (≈ 1 km) envoyées à Open-Meteo pour la météo |
| Transfert | Open-Meteo (Suisse — décision d'adéquation) |
| Conservation | Jusqu'à suppression par un utilisateur |

### T6 — Capteurs (non actif)

Les tables `sensors` / `sensor_readings` sont désactivées dans le code. À compléter et à réévaluer (AIPD) lors de l'activation.

## 3. Mesures techniques et organisationnelles (art. 32) — résumé

Voir `docs/securite/AUDIT-SECURITE.md` (statut des corrections) et `docs/conformite/CHECKLIST-CONFORMITE.md`.

## 4. Historique

| Date | Modification |
|---|---|
| 2026-10-03 | Création du brouillon |
