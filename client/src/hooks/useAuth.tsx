/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { apiUrl, readJsonResponse } from '../lib/api';
import {
  getAccessToken, setAccessToken, onAccessTokenChange, refreshSession, decodeTokenExpiry,
  type SessionUser,
} from '../lib/session';

type User = SessionUser;

interface AuthContextType {
  user:    User | null;
  token:   string | null;
  login:   (username: string, password: string) => Promise<{ mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  completeSetup: (setupToken: string, username: string, password: string) => Promise<void>;
  logout:  () => void;
  logoutAll: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// renouvelle le jeton d'accès 60 s avant son expiration
const REFRESH_MARGIN_MS = 60_000;

async function postAuth<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await readJsonResponse<T & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [token,   setToken]   = useState<string | null>(getAccessToken());
  const [loading, setLoading] = useState(true);

  // jeton mémoire → état React ; perte du jeton (refresh refusé) → déconnexion
  useEffect(() => onAccessTokenChange(next => {
    setToken(next);
    if (!next) setUser(null);
  }), []);

  // au chargement : ancien jeton localStorage supprimé, session restaurée via le cookie HttpOnly
  useEffect(() => {
    try { localStorage.removeItem('token'); } catch { /* stockage indisponible */ }
    refreshSession()
      .then(data => { if (data) setUser(data.user); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token) return;
    const expiresAt = decodeTokenExpiry(token);
    if (!expiresAt) return;
    const delay = Math.max(expiresAt - Date.now() - REFRESH_MARGIN_MS, 5_000);
    const timer = setTimeout(() => {
      refreshSession().then(data => { if (data) setUser(data.user); });
    }, delay);
    return () => clearTimeout(timer);
  }, [token]);

  const logout = useCallback(() => {
    fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {});
    setAccessToken(null);
    setUser(null);
  }, []);

  const logoutAll = useCallback(async () => {
    const current = getAccessToken();
    await fetch(apiUrl('/auth/logout-all'), {
      method: 'POST',
      credentials: 'include',
      headers: current ? { Authorization: `Bearer ${current}` } : undefined,
    }).catch(() => {});
    setAccessToken(null);
    setUser(null);
  }, []);

  // renvoie un mfaToken si un second facteur est requis
  async function login(username: string, password: string) {
    const data = await postAuth<{ token?: string; user?: User; mfaRequired?: boolean; mfaToken?: string }>('/auth/login', {
      username: username.toLowerCase().trim(),
      password,
    });
    if (data.mfaRequired && data.mfaToken) return { mfaToken: data.mfaToken };
    setAccessToken(data.token ?? null);
    setUser(data.user ?? null);
    return {};
  }

  async function verifyMfa(mfaToken: string, code: string) {
    const data = await postAuth<{ token: string; user: User }>('/auth/mfa', { mfaToken, code: code.trim() });
    setAccessToken(data.token);
    setUser(data.user);
  }

  async function completeSetup(setupToken: string, username: string, password: string) {
    const data = await postAuth<{ token: string; user: User }>('/auth/setup', {
      setupToken: setupToken.trim(),
      username: username.toLowerCase().trim(),
      password,
    });
    setAccessToken(data.token);
    setUser(data.user);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, verifyMfa, completeSetup, logout, logoutAll, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit etre dans <AuthProvider>');
  return ctx;
}
