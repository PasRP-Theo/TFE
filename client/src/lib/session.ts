import { apiUrl } from './api';

// Jeton d'accès en MÉMOIRE uniquement (jamais localStorage : inaccessible après un XSS
// une fois la page fermée, et absent du disque). La session survit au rechargement
// grâce au cookie HttpOnly de rafraîchissement, illisible par le JavaScript.

export interface SessionUser {
  id: number;
  username: string;
  role: string;
}

type Listener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();
let refreshInFlight: Promise<{ token: string; user: SessionUser } | null> | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach(listener => listener(token));
}

export function onAccessTokenChange(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// renouvellement unique même si plusieurs requêtes échouent en même temps
export function refreshSession(): Promise<{ token: string; user: SessionUser } | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(apiUrl('/auth/refresh'), { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const data = await res.json() as { token: string; user: SessionUser };
      setAccessToken(data.token);
      return data;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function decodeTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
