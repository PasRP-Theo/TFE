import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id:    number;
  email: string;
  role:  string;
}

interface AuthContextType {
  user:    User | null;
  token:   string | null;
  login:   (email: string, password: string) => Promise<void>;
  logout:  () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [token,   setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaure la session au démarrage
  useEffect(() => {
    const saved = localStorage.getItem('token');
    if (!saved) { setLoading(false); return; }

    fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${saved}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) { setUser(data.user); setToken(saved); }
        else localStorage.removeItem('token');
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res  = await fetch(`${API}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur de connexion');
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être dans <AuthProvider>');
  return ctx;
}