# AUBEPINES Surveillance

Application de surveillance avec frontend Vite/React et backend Node.js.

Objectif du projet:
- développer sur le PC pro
- pousser sur GitHub
- déclencher automatiquement un redéploiement sur le PC host Ubuntu via GitHub Actions self-hosted runner

## Structure

- `client/`: frontend React + Vite
- `server/`: backend Node.js + fichiers statiques servis en production
- `.github/workflows/deploy.yml`: pipeline de déploiement automatique sur le host Ubuntu

## Développement local

### Frontend

```bash
cd client
npm install
npm run dev
```

### Backend

```bash
cd server
npm install
npm start
```

### Build frontend

```bash
cd client
npm run build
```

## Déploiement automatique sur le PC host Ubuntu

Le principe est le suivant:

1. le développement se fait sur le PC pro
2. un `git push origin main` déclenche GitHub Actions
3. le runner self-hosted installé sur le PC host Ubuntu exécute le workflow
4. le host met à jour `/home/theo/TFE`
5. le client est rebuild sur le host
6. `server/public` est mis à jour
7. PM2 redémarre l'application

## Prérequis sur le PC host Ubuntu

Le host doit avoir:

- Git
- Node.js
- npm
- rsync
- PM2
- un runner GitHub Actions self-hosted actif

Commandes utiles:

```bash
which git
which node
which npm
which rsync
which pm2
node -v
npm -v
pm2 -v
```

## Variable GitHub Actions à créer

Dans GitHub:

`Settings > Secrets and variables > Actions > Variables`

Créer la variable suivante:

- `DEPLOY_PATH=/home/theo/TFE`

Le workflow lit exactement `DEPLOY_PATH`.

## Workflow utilisé

Le workflow est dans:

- `.github/workflows/deploy.yml`

Comportement du workflow:

1. vérifie que `DEPLOY_PATH` existe dans les variables GitHub
2. initialise `/home/theo/TFE` comme repo Git si nécessaire
3. attache le remote GitHub
4. fait un `git fetch --prune origin`
5. fait un `git reset --hard` sur le commit du run
6. nettoie le repo sans supprimer:
   - `.env`
   - `.env.*`
   - `hls`
   - `recordings`
   - `server/recordings`
7. rebuild le frontend sur le host
8. copie `client/dist` vers `server/public`
9. écrit des marqueurs de version déployée
10. installe les dépendances serveur de production
11. redémarre PM2

## Première mise en place sur Ubuntu

### Vérifier que le dossier de déploiement existe

```bash
mkdir -p /home/theo/TFE
```

### Vérifier les droits d'écriture

```bash
touch /home/theo/TFE/.write-test && rm /home/theo/TFE/.write-test
```

### Vérifier le runner GitHub Actions

```bash
ps -ef | grep actions-runner | grep -v grep
```

## Déployer une nouvelle version

Depuis le PC pro:

```bash
git add .
git commit -m "message"
git push origin main
```

Ensuite GitHub Actions doit lancer automatiquement `Deploy AUBEPINES`.

## Vérifier sur le PC host Ubuntu

### Vérifier le commit réellement déployé

```bash
cat /home/theo/TFE/.deploy-commit
cat /home/theo/TFE/.deploy-time
```

### Vérifier le repo du host

```bash
cd /home/theo/TFE
git log -1 --oneline
```

### Vérifier PM2

```bash
pm2 list
pm2 describe aubepines
```

### Vérifier ce que l'application sert réellement

```bash
curl -s http://localhost:4000/deploy-info.json
```

## Commande de diagnostic rapide sur Ubuntu

```bash
cd /home/theo/TFE && echo "repo: $(git log -1 --oneline 2>/dev/null || echo no-git)" && echo "deploy: $(cat .deploy-commit 2>/dev/null || echo no-deploy-marker)" && echo "time: $(cat .deploy-time 2>/dev/null || echo no-deploy-time)" && pm2 describe aubepines | sed -n '1,40p'
```

## Dépannage

### Le workflow se lance mais le code ne semble pas mis à jour

Vérifier:

```bash
cat /home/theo/TFE/.deploy-commit
curl -s http://localhost:4000/deploy-info.json
```

Ne pas se fier uniquement à un ancien état local si un déploiement précédent avait utilisé une autre méthode.

### Le workflow échoue sur un import qui fonctionne sous Windows

Le host Ubuntu est sensible à la casse des noms de fichiers. Exemple:

- `LoginPage.tsx` est différent de `Loginpage.tsx`

Toujours faire correspondre exactement le nom du fichier et l'import.

### PM2 ne redémarre pas correctement

Vérifier:

```bash
pm2 describe aubepines
pm2 logs aubepines --lines 100
```

### Le runner ne prend pas les jobs

Vérifier que le runner self-hosted est bien actif sur le host Ubuntu et qu'il possède les labels Linux attendus.

## Fichiers importants

- `.github/workflows/deploy.yml`
- `client/src/App.tsx`
- `server/server.js`
- `server/package.json`
- `client/package.json`

## Résumé ultra court

Pour déployer automatiquement:

1. installer et laisser tourner le runner GitHub Actions sur Ubuntu
2. définir `DEPLOY_PATH=/home/theo/TFE` dans les variables GitHub Actions
3. s'assurer que PM2 lance l'app `aubepines`
4. pousser sur `main`
5. vérifier `/home/theo/TFE/.deploy-commit`
