import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage   from './components/LoginPage';
// import SensorList  from './components/SensorList';
import CameraFeed  from './components/CameraFeed';
import Settings    from './components/Settings';
import SystemInfo  from './components/SystemInfo';
import surveillanceLogo from './assets/surveillance-logo.svg';
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
  const [installHint, setInstallHint] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const updateStandalone = () => {
      const standalone = media.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsStandalone(standalone);
      if (standalone) {
        setInstallPrompt(null);
        setInstallHint(null);
      }
    };

    updateStandalone();

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallHint(null);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setInstallHint(null);
      setIsStandalone(true);
    };

    media.addEventListener('change', updateStandalone);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      media.removeEventListener('change', updateStandalone);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      setInstallPrompt(null);
      return;
    }

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);

    if (isIos) {
      setInstallHint('Sur iPhone: ouvrez Partager puis Ajouter a l\'ecran d\'accueil.');
      return;
    }

    if (isAndroid) {
      setInstallHint('Sur Android: ouvrez le menu du navigateur puis Installer l\'application ou Ajouter a l\'ecran d\'accueil.');
      return;
    }

    setInstallHint('Utilisez le menu du navigateur pour installer cette application sur l\'appareil.');
  }

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <img className="login-logo-icon" src={surveillanceLogo} alt="" aria-hidden="true" />
            <span className="login-logo-text">Chargement...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const isAdmin = user.role === 'admin';
  const showInstallButton = !isStandalone;

  const navLinks = [
    // Vue capteurs désactivée à la demande.
    // { to: '/',         label: 'Capteurs',   show: true    },
    { to: '/videos',   label: 'Caméras',    shortLabel: 'Cam',  icon: '◉', show: true    },
    { to: '/system',   label: 'Système',    shortLabel: 'Infos', icon: '⌁', show: isAdmin },
    //{ to: '/courses',  label: 'Courses',    show: true    },
    { to: '/settings', label: 'Paramètres', shortLabel: 'Config', icon: '⚙', show: isAdmin },
  ].filter(l => l.show);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo">
            <img className="app-logo-icon" src={surveillanceLogo} alt="" aria-hidden="true" />
            <span className="app-logo-text">AUBEPINES</span>
            <span className="app-logo-version">v2.4.1</span>
          </div>

          <nav className="app-nav" aria-label="Navigation principale">
            {navLinks.map(({ to, label, shortLabel, icon }) => (
              <Link key={to} to={to}
                className={`app-nav-link ${location.pathname === to ? 'active' : ''}`}>
                <span className="app-nav-link-icon" aria-hidden="true">{icon}</span>
                <span className="app-nav-link-text app-nav-link-text--full">{label}</span>
                <span className="app-nav-link-text app-nav-link-text--short">{shortLabel}</span>
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

          {showInstallButton && (
            <button className="app-install-btn" onClick={installApp} title="Installer l'application sur cet appareil">
              Installer
            </button>
          )}

          <button className="app-logout-btn" onClick={logout} title="Se déconnecter">⏻</button>
        </div>

        {installHint && (
          <div className="app-install-hint" role="status">
            {installHint}
          </div>
        )}
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