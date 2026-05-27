# Sentys — Client API (`client/src/lib/api.ts`)

## Fonctions exportées

### `apiUrl(path)`
Construit l'URL complète d'un endpoint selon l'environnement.

| Environnement | Résultat |
|---------------|----------|
| Dev (`npm run dev`) | `http://192.168.0.47:4000/api/cameras` |
| Production (build servi par Express) | `/api/cameras` |

En production, le frontend est servi par le même serveur Express — les appels sont relatifs, pas besoin de l'IP.

```ts
apiUrl('/api/cameras')           // → '/api/cameras' (prod)
apiUrl('/api/cameras')           // → 'http://192.168.0.47:4000/api/cameras' (dev)
```

Variables d'environnement (`.env` à la racine de `client/`) :
```env
VITE_API_URL=              # URL base complète (prioritaire si défini)
VITE_API_PORT=4000         # Port dev (défaut : 4000)
```

---

### `apiFetch(url, options?)`
Wrapper autour de `fetch` qui injecte automatiquement le token JWT depuis `localStorage`.

```ts
apiFetch(apiUrl('/api/cameras/69/start'), { method: 'POST' })
```

**Comportement :**
- Lit `localStorage.getItem('token')`
- Si token présent et pas déjà d'`Authorization` dans les headers → ajoute `Authorization: Bearer {token}`
- Fusionne avec les options passées (method, body, headers supplémentaires)
- Retourne la `Promise<Response>` native

**Toujours utiliser `apiFetch` à la place de `fetch` pour les appels API.**
`fetch` nu ne joint pas le token → `401 Unauthorized`.

Exceptions où `fetch` seul est correct :
- `POST /auth/login` — pas encore de token à ce stade
- `GET /auth/me` — déjà géré manuellement dans `useAuth.tsx`

---

### `readJsonResponse<T>(response)`
Parse la réponse d'un fetch en JSON avec gestion d'erreur.

```ts
const res  = await apiFetch(apiUrl('/api/cameras'));
const data = await readJsonResponse<Camera[]>(res);
```

**Comportement :**
- Vérifie que le `Content-Type` est `application/json`
- Si non → lance une erreur avec un aperçu du corps (utile pour déboguer les pages d'erreur Express)
- Parse le JSON et retourne le résultat typé
- Si JSON invalide → erreur explicite

---

## Utilisation type

```ts
import { apiUrl, apiFetch, readJsonResponse } from '../lib/api';

// GET
const res  = await apiFetch(apiUrl('/api/cameras'));
const data = await readJsonResponse<Camera[]>(res);

// POST avec corps JSON
const res = await apiFetch(apiUrl('/api/cameras'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Salon', rtsp_url: 'rtsp://...' }),
});

// DELETE
await apiFetch(apiUrl(`/api/cameras/${id}`), { method: 'DELETE' });

// PATCH
const res = await apiFetch(apiUrl(`/api/cameras/${id}`), {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Nouveau nom' }),
});
```

---

## Gestion des 401

Si le token a expiré (durée de vie 1h), le serveur retourne `401`.
`useAuth.tsx` gère l'expiration automatiquement via un timer sur le `exp` du JWT décodé — le logout est déclenché avant même que le serveur rejette la requête.

En cas de `401` inattendu malgré un token valide : vérifier que `JWT_SECRET` est identique entre les redémarrages du serveur.
