import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage   from './components/LoginPage';
// import SensorList  from './components/SensorList';
import CameraFeed  from './components/CameraFeed';
import Settings    from './components/Settings';
import SystemInfo  from './components/SystemInfo';
import BrandLogo from './components/BrandLogo.tsx';
import './App.css';

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
  const [isInstalledMode, setIsInstalledMode] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  }, [theme]);

  useEffect(() => {
    type LegacyMediaQueryList = MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };

    const detectStandaloneMode = () => {
      const nav = window.navigator as Navigator & { standalone?: boolean };
      return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: window-controls-overlay)').matches
        || nav.standalone === true;
    };

    const standaloneMedia = window.matchMedia('(display-mode: standalone)') as LegacyMediaQueryList;
    const overlayMedia = window.matchMedia('(display-mode: window-controls-overlay)') as LegacyMediaQueryList;
    const updateInstalledMode = () => setIsInstalledMode(detectStandaloneMode());
    const addMediaListener = (query: LegacyMediaQueryList, handler: (event: MediaQueryListEvent) => void) => {
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', handler);
        return () => query.removeEventListener('change', handler);
      }

      query.addListener?.(handler);
      return () => query.removeListener?.(handler);
    };

    updateInstalledMode();
    const removeStandaloneListener = addMediaListener(standaloneMedia, updateInstalledMode);
    const removeOverlayListener = addMediaListener(overlayMedia, updateInstalledMode);
    window.addEventListener('appinstalled', updateInstalledMode);

    return () => {
      removeStandaloneListener();
      removeOverlayListener();
      window.removeEventListener('appinstalled', updateInstalledMode);
    };
  }, []);

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <BrandLogo
              wrapperClassName="login-logo-mark"
              imageClassName="login-logo-icon"
              fallbackClassName="login-logo-fallback"
              fallbackText="A"
            />
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
    { to: '/videos',   label: 'Caméras',    shortLabel: 'Caméras',  icon: '◉', show: true    },
    { to: '/system',   label: 'Système',    shortLabel: 'Système', icon: '⌁', show: isAdmin },
    //{ to: '/courses',  label: 'Courses',    show: true    },
    { to: '/settings', label: 'Paramètres', shortLabel: 'Réglages', icon: '⚙', show: isAdmin },
  ].filter(l => l.show);

  return (
    <div className={`app ${isInstalledMode ? 'app--installed' : ''}`}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo">
            <BrandLogo
              wrapperClassName="app-logo-mark"
              imageClassName="app-logo-icon"
              fallbackClassName="app-logo-fallback"
              fallbackText="A"
            />
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

          <div className="app-status-group">
            <div className="app-status">
              <span className="app-status-dot" />
              EN LIGNE · LOCAL
            </div>
            {isInstalledMode && (
              <div className="app-installed-badge">
                <span className="app-installed-badge-dot" />
                MODE APP
              </div>
            )}
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