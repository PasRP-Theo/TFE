import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage   from './components/LoginPage';
import SensorList  from './components/SensorList';
import CameraFeed  from './components/CameraFeed';
import GroceryList from './components/Grocerylist';
import Settings    from './components/Settings';
import './App.css';

// ── Page 403 pour les accès refusés ───────────────────────
function AccessDenied() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: '12px',
      fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
    }}>
      <span style={{ fontSize: '32px', color: 'var(--accent-red)' }}>⊘</span>
      <span style={{ fontSize: '11px', letterSpacing: '0.2em', color: 'var(--accent-red)' }}>ACCÈS REFUSÉ</span>
      <span style={{ fontSize: '10px', letterSpacing: '0.1em' }}>Vous n'avez pas les permissions nécessaires.</span>
    </div>
  );
}

// ── Route protégée par rôle ────────────────────────────────
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <AccessDenied />;
  return <>{children}</>;
}

function AppShell() {
  const { user, logout, loading } = useAuth();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  }, [theme]);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <span className="login-logo-icon">⬡</span>
            <span className="login-logo-text">Chargement...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const isAdmin = user.role === 'admin';

  // L'onglet Paramètres n'apparaît que pour les admins
  const navLinks = [
    { to: '/',         label: 'Capteurs',   show: true     },
    { to: '/videos',   label: 'Caméras',    show: true     },
    //{ to: '/courses',  label: 'Courses',    show: true     },
    { to: '/settings', label: 'Paramètres', show: isAdmin  },
  ].filter(l => l.show);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo">
            <span className="app-logo-icon">⬡</span>
            <span className="app-logo-text">AUBEPINES</span>
            <span className="app-logo-version">v2.4.1</span>
          </div>

          <nav className="app-nav">
            {navLinks.map(({ to, label }) => (
              <Link key={to} to={to}
                className={`app-nav-link ${location.pathname === to ? 'active' : ''}`}>
                {label}
              </Link>
            ))}
          </nav>

          <div className="app-status">
            <span className="app-status-dot" />
            EN LIGNE
          </div>

          <div className="app-user">
            <span className="app-user-email">{user.email}</span>
            <span className={`app-user-role ${isAdmin ? '' : 'app-user-role--user'}`}>
              {isAdmin ? 'ADMIN' : 'USER'}
            </span>
          </div>

          <button className="app-theme-btn"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <button className="app-logout-btn" onClick={logout} title="Se déconnecter">⏻</button>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/"        element={<SensorList />} />
          <Route path="/videos"  element={<CameraFeed />} />
          {/* <Route path="/courses" element={<GroceryList />} />*/}
          <Route path="/settings" element={
            <AdminRoute><Settings /></AdminRoute>
          } />
          {/* Redirige / vers accueil si route inconnue */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}