# SENTYS Surveillance

Application de surveillance avec frontend Vite/React et backend Node.js.

Objectif du projet:
- développer sur le PC pro
- pousser sur GitHub
- déclencher automatiquement un redéploiement sur le PC host Ubuntu via GitHub Actions self-hosted runner

## Structure

- `client/`: frontend React + Vite
- `server/`: backend Node.js + fichiers statiques servis en production
- `.github/workflows/deploy.yml`: pipeline de déploiement automatique sur le host Ubuntu
- `README-user-stories.md`: backlog fonctionnel et user stories du projet

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
pm2 describe sentys
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
