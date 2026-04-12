export const configuredBaseUrl = String(import.meta.env.VITE_API_URL || '').trim();
const configuredApiPort = String(import.meta.env.VITE_API_PORT || '4000').trim();

function getDefaultApiBaseUrl() {
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