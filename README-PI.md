Voici une synthèse complète de ta configuration actuelle sous forme de **README.md**. C'est le document parfait à garder précieusement si tu dois réinstaller ton système un jour ou si tu veux comprendre comment tout s'imbrique.

---

# 🖥️ Projet Sentys - Configuration Kiosque (Pi 2B)

Ce document récapitule la configuration du Raspberry Pi 2B pour faire tourner une application React en mode **Kiosque** avec un **clavier virtuel flottant** et un écran tactile 7" (1024x600).

## 🛠️ Stack Matérielle & Système
* **Hardware :** Raspberry Pi 2B (Broadcom BCM2836).
* **Écran :** WIMAXIT 7 pouces (Résolution 1024x600 via HDMI).
* **OS :** Debian Trixie (version Lite/Minimal).
* **Interface Graphique :** X11 + Openbox (Gestionnaire de fenêtres ultra-léger).

---

## 🏗️ Architecture Logicielle



1.  **Serveur X (X11) :** Gère l'affichage de base.
2.  **Openbox :** Place les fenêtres et définit qui va "au-dessus" (Z-index).
3.  **Chromium :** Affiche l'application React (`--app` mode).
4.  **Onboard :** Clavier virtuel natif configuré en mode "Always on Top".
5.  **Unclutter :** Masque automatiquement le curseur de la souris.

---

## ⚙️ Fichiers de Configuration

### 1. `~/.config/openbox/autostart`
Ce script gère l'ordre de lancement au démarrage.
```bash
# Cache la souris immédiatement
unclutter -idle 0 &

# Active la mise en veille de l'écran après 5 minutes (300 secondes) d'inactivité
xset s on +dpms
xset dpms 300 300 300

# Prépare le bus de communication (Accessibilité)
export QT_ACCESSIBILITY=1
eval $(dbus-launch --sh-syntax --exit-with-session)

# Lance le clavier virtuel (Mode Phone)
onboard -l Phone --force-to-top &

# Pause pour laisser le processeur Pi 2B respirer
sleep 4

# Lance Chromium sur l'application React
chromium --app="http://192.168.0.47/controlpanel" --start-fullscreen --no-first-run --disable-gpu
```

### 2. `~/.config/openbox/rc.xml`
Définit les règles de superposition des fenêtres.
* **Onboard :** Couche `above` (flotte par-dessus tout).
* **Chromium :** Couche `normal`.
* **Décorations :** Désactivées (pas de barres de titre, pas de bordures).

### 3. `/boot/firmware/config.txt`
Paramètres pour l'écran 7" WIMAXIT.
```text
hdmi_force_hotplug=1
hdmi_group=2
hdmi_mode=87
hdmi_cvt=1024 600 60 6 0 0 0
dtoverlay=vc4-fkms-v3d
gpu_mem=128
```

---

## 🚀 Commandes Utiles

* **Redémarrer le système :** `sudo reboot`
* **Éteindre proprement :** `sudo shutdown -h now`
* **Éditer le script de démarrage :** `nano ~/.config/openbox/autostart`
* **Vérifier si le clavier tourne :** `pgrep onboard`

---

## ⚠️ Notes de Maintenance
* **Performance :** Le Pi 2B n'ayant pas de GPU puissant, l'accélération matérielle est désactivée dans Chromium (`--disable-gpu`) pour éviter les écrans noirs.
* **Souris :** Pour faire réapparaître la souris temporairement, il faut tuer le processus : `killall unclutter`.
* **Clavier :** Si le clavier ne pop pas automatiquement, utiliser l'icône flottante ou cliquer sur les champs de saisie (le `layer: above` garantit qu'il ne sera jamais caché).

---

**Ton Pi est maintenant configuré comme une borne industrielle.** Tout est automatisé pour qu'à l'allumage, ton interface React soit prête à l'emploi.

Est-ce que tu veux que je rajoute une section sur la configuration de la caméra (pour ton Pi 2) dans ce README ?