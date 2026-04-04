import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage   from './components/Loginpage';
// import SensorList  from './components/SensorList';
import CameraFeed  from './components/CameraFeed';
import Settings    from './components/Settings';
import SystemInfo  from './components/SystemInfo';
import './App.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// ── Page 403 pour les accès refusés ───────────────────────
function AccessDenied() {
  return (
    <div className="access-denied">
      <span className="access-denied-icon">⊘</span>
      <span className="access-denied-title">ACCÈS REFUSÉ</span>
      <span className="access-denied-subtitle">Vous n'avez pas les permissions nécessaires.</span>
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  }, [theme]);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }

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

  const navLinks = [
    // Vue capteurs désactivée à la demande.
    // { to: '/',         label: 'Capteurs',   show: true    },
    { to: '/videos',   label: 'Caméras',    show: true    },
    { to: '/system',   label: 'Système',    show: isAdmin },
    //{ to: '/courses',  label: 'Courses',    show: true    },
    { to: '/settings', label: 'Paramètres', show: isAdmin },
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
            EN LIGNE · LOCAL
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

          {installPrompt && (
            <button className="app-install-btn" onClick={installApp} title="Installer l'application sur cet appareil">
              Installer
            </button>
          )}

          <button className="app-logout-btn" onClick={logout} title="Se déconnecter">⏻</button>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          {/* Route capteurs désactivée à la demande. */}
          <Route path="/"        element={<Navigate to="/videos" replace />} />
          <Route path="/videos"  element={<CameraFeed />} />
          {/* <Route path="/courses" element={<GroceryList />} />*/}
          <Route path="/system"  element={
            <AdminRoute><SystemInfo /></AdminRoute>
          } />
          <Route path="/settings" element={
            <AdminRoute><Settings /></AdminRoute>
          } />
          {/* Redirige vers accueil si route inconnue */}
          <Route path="*" element={<Navigate to="/videos" replace />} />
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