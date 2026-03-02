import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface User {
  id:    number;
  email: string;
  role:  string;
}

interface AuthContextType {
  user:    User | null;
  token:   string | null;
  login:   (username: string, password: string) => Promise<void>;
  logout:  () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function decodeJWT(token: string): { exp?: number } | null {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [token,   setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('token');
    if (!saved) { setLoading(false); return; }

    const decoded = decodeJWT(saved);
    if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
      localStorage.removeItem('token');
      setLoading(false);
      return;
    }

    fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${saved}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) { setUser(data.user); setToken(saved); }
        else localStorage.removeItem('token');
      })
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token) return;
    const decoded = decodeJWT(token);
    if (!decoded?.exp) return;

    const msLeft = decoded.exp * 1000 - Date.now();
    if (msLeft <= 0) { logout(); return; }

    const timer = setTimeout(() => {
      logout();
    }, msLeft);

    return () => clearTimeout(timer);
  }, [token, logout]);

  async function login(username: string, password: string) {
    const res  = await fetch(`${API}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: username.toLowerCase().trim(), password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(data.user);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit etre dans <AuthProvider>');
  return ctx;
}