import { getAccessToken, refreshSession } from './session';

// URL du backend (tunnel HTTPS) pour le frontend hébergé sur Vercel.
// Vide = même origine (interface servie par le serveur local sur le LAN).
export const configuredBaseUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const configuredApiPort = String(import.meta.env.VITE_API_PORT || '4000').trim();

function getDefaultApiBaseUrl() {
  if (configuredBaseUrl) return configuredBaseUrl;
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:${configuredApiPort}`;
  }
  return '';
}

export const API_BASE_URL = getDefaultApiBaseUrl();

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

// requête authentifiée : jeton d'accès en mémoire ; sur 401, renouvellement puis nouvel essai
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const send = () => {
    const headers = new Headers(options.headers as HeadersInit | undefined);
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
    return fetch(url, { ...options, headers });
  };

  const response = await send();
  if (response.status !== 401) return response;
  const renewed = await refreshSession();
  return renewed ? send() : response;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text();

  if (!contentType.includes('application/json')) {
    const preview = rawText.trim().slice(0, 120) || 'réponse vide';
    throw new Error(`Réponse API invalide (${response.status}) : ${preview}`);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error('Réponse JSON invalide renvoyée par le serveur');
  }
}
