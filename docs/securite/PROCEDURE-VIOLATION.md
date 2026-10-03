# Procédure de réponse à une violation de données — Sentys

Référentiels : RGPD art. 33 (notification à l'autorité sous 72 h), art. 34 (communication aux personnes), art. 33.5 (documentation) ; recommandations du CCB (Safeonweb / CERT.be).

> ⚖️ L'obligation de notifier l'APD ne s'applique que si le RGPD s'applique au traitement (voir `REGISTRE-TRAITEMENTS.md` §0). La documentation interne (étape 6) est faite **dans tous les cas**.

## 0. Qu'est-ce qu'une violation ?

Toute atteinte à la **confidentialité** (accès non autorisé aux images, fuite de la base), à l'**intégrité** (modification ou injection d'alertes, agent Pi modifié) ou à la **disponibilité** (perte ou chiffrement des enregistrements par un rançongiciel).

**Signaux dans Sentys** (Réglages → Journal, ou `SELECT * FROM audit_logs ORDER BY created_at DESC`) :

| Événement | Signification possible |
|---|---|
| `TOKEN_REUSE_DETECTED` | Jeton de session volé et rejoué |
| Rafale de `LOGIN_FAILED` / `LOGIN_LOCKED` / `MFA_FAILED` | Attaque par force brute |
| `VIDEO_LIVE_VIEW` / `RECORDING_VIEW` inattendus (heure, compte, IP) | Accès illégitime aux images |
| `DEVICE_TOKEN_ISSUED` / `MFA_RESET` / `USER_CREATE` non initiés | Compte administrateur compromis |
| `[UPDATE] Signature invalide` (journal du Pi) | Tentative de mise à jour malveillante |
| Alerte gitleaks / GitHub *secret scanning* | Secret publié dans le dépôt |

## 1. Contenir (immédiatement, < 1 h)

```bash
# couper l'accès Internet (le LAN reste fonctionnel)
sudo tailscale funnel --https=443 off
# fermer toutes les sessions de tous les comptes
psql -d sentys -c "UPDATE users SET token_version = token_version + 1; UPDATE refresh_tokens SET revoked_at = NOW() WHERE revoked_at IS NULL;"
# révoquer les jetons d'appareils si un appareil est suspect (puis réappairer)
psql -d sentys -c "UPDATE device_tokens SET revoked_at = NOW() WHERE revoked_at IS NULL;"
```

- **Préserver les preuves avant toute remise à zéro** : copier `audit_logs`, `~/.pm2/logs/`, journaux nginx et Tailscale (`pg_dump -t audit_logs`).
- Isoler un appareil compromis (débrancher, ou bloquer son IP au routeur).

## 2. Éradiquer et rétablir

1. Changer les mots de passe concernés ; réinitialiser la MFA des comptes touchés.
2. Rotation des secrets selon `POLITIQUE-SECRETS.md` : clé ES256 (supprimer `~/.sentys/jwt-es256.pem`), `DATA_ENCRYPTION_KEY` (`npm run rotate-data-key`), identifiants des caméras (à changer **dans la caméra** puis dans Sentys), mots de passe PostgreSQL, clés VAPID.
3. Corriger la cause (mise à jour, correctif) ; vérifier l'intégrité (`git status` sur le serveur, signature de l'agent sur les Pi).
4. Restaurer depuis une sauvegarde saine si nécessaire, puis rouvrir le tunnel.

## 3. Évaluer le risque pour les personnes (< 24 h)

| Question | Exemples |
|---|---|
| Quelles données ? | Images (vie privée du foyer, visiteurs), comptes, journaux |
| Combien de personnes et qui ? | Occupants, visiteurs, passants |
| Données lisibles ? | Base volée mais secrets hors base → identifiants caméras et MFA illisibles |
| Conséquences ? | Repérage d'habitudes, cambriolage, atteinte à la réputation |

- **Aucun risque** probable → documenter uniquement (étape 6).
- **Risque** → notifier l'APD (étape 4).
- **Risque élevé** → notifier l'APD **et** informer les personnes (étape 5).

## 4. Notifier l'APD — au plus tard 72 h après en avoir pris connaissance (art. 33)

- Formulaire en ligne : www.autoriteprotectiondonnees.be (rubrique « Fuite de données »).
- Contenu : nature de la violation, catégories et nombre approximatif de personnes et d'enregistrements, contact, conséquences probables, mesures prises ou envisagées.
- Une notification incomplète dans les délais vaut mieux qu'une notification tardive : la compléter ensuite.

## 5. Informer les personnes concernées (art. 34) — si risque élevé

Message clair, sans délai excessif : ce qui s'est passé, les conséquences possibles, les mesures prises, ce que la personne peut faire, le contact. Modèle :

> Le [date], un accès non autorisé au système de vidéosurveillance de [adresse / foyer] a été détecté. Des images enregistrées entre le [date] et le [date] ont pu être consultées. Nous avons coupé l'accès distant, révoqué toutes les sessions et changé l'ensemble des secrets. [Recommandation éventuelle.] Contact : [e-mail].

En cas d'infraction (intrusion, vol), **porter plainte** auprès de la police. Signalement facultatif au CCB : www.safeonweb.be / incident@ccb.belgium.be.

## 6. Documenter (art. 33.5) — toujours

| Champ | Contenu |
|---|---|
| Date et heure de détection | |
| Date et heure de la violation (estimée) | |
| Description | |
| Données et personnes concernées | |
| Évaluation du risque | aucun / risque / élevé |
| Mesures de confinement et de correction | |
| Notification APD (date, référence) ou justification de l'absence | |
| Information des personnes (date, moyen) | |
| Leçons apprises / actions préventives | |

Conserver ce registre des violations avec la documentation de conformité (hors dépôt public).
