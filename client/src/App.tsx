import { useEffect, useState, useRef, useCallback } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { AppConfigProvider, useAppConfig } from './hooks/useAppConfig';
import { AppearanceProvider, useAppearance } from './hooks/useAppearance';
import LoginPage   from './components/LoginPage';
// import SensorList  from './components/SensorList';
import CameraFeed  from './components/CameraFeed';
import Settings    from './components/Settings';
import SystemInfo  from './components/SystemInfo';
import AlertsPage  from './components/AlertsPage';
import BrandLogo from './components/BrandLogo.tsx';
import { registerSW } from 'virtual:pwa-register';
import { apiUrl, readJsonResponse } from './lib/api';
import { VirtualKeyboardProvider } from './components/VirtualKeyboard.tsx';
import './App.css';

// ── Enregistrement de la PWA (Service Worker) ──────────────
if (typeof window !== 'undefined') {
  registerSW({ immediate: true });
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface BatteryManager extends EventTarget {
  readonly charging: boolean;
  readonly chargingTime: number;
  readonly dischargingTime: number;
  readonly level: number;
}

// ── Route protégée par rôle ────────────────────────────────
function AdminRoute({ 
  children 
}: { 
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  
  const hasAccess = user?.role === 'admin';
  if (!hasAccess) return <Navigate to="/videos" replace />;

  return <>{children}</>;
}

function getSystemStatus(
  isOnline: boolean,
  pendingAlertsCount: number,
  batteryInfo: { charging: boolean; level: number } | null
): { color: string; text: string } {
  if (!isOnline) {
    return { color: 'var(--accent-amber)', text: 'INSTABLE' };
  }
  if (pendingAlertsCount > 0) {
    return { color: 'var(--accent-red)', text: 'ALERTE / PANNE' };
  }
  if (batteryInfo && !batteryInfo.charging) {
    const color = batteryInfo.level <= 20 ? 'var(--accent-red)' : 'var(--accent-amber)';
    return { color, text: `SUR BATTERIE (${batteryInfo.level}%)` };
  }
  return { color: '#22c55e', text: 'OK' };
}

  function AppShell() {
  const { user, logout, loading } = useAuth();
  const { config } = useAppConfig();
  const { settings, toggleTheme } = useAppearance();
  const [isInstalledMode, setIsInstalledMode] = useState(false);
  const [pendingAlertsCount, setPendingAlertsCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [batteryInfo, setBatteryInfo] = useState<{ charging: boolean, level: number } | null>(null);
  const location = useLocation();

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

    const refreshInstallState = () => {
      const installed = detectStandaloneMode();
      setIsInstalledMode(installed);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      // On laisse le navigateur libre d'afficher son pop-up natif automatique
      (window as { deferredInstallPrompt?: BeforeInstallPromptEvent }).deferredInstallPrompt = promptEvent;
    };

    const handleAppInstalled = () => {
      (window as { deferredInstallPrompt?: BeforeInstallPromptEvent | null }).deferredInstallPrompt = null;
      refreshInstallState();
    };

    const standaloneMedia = window.matchMedia('(display-mode: standalone)') as LegacyMediaQueryList;
    const overlayMedia = window.matchMedia('(display-mode: window-controls-overlay)') as LegacyMediaQueryList;
    const updateInstalledMode = () => refreshInstallState();
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
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      removeStandaloneListener();
      removeOverlayListener();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let navBattery: BatteryManager | null = null;
    const updateBattery = () => {
      if (navBattery) {
        setBatteryInfo({
          charging: navBattery.charging,
          level: Math.round(navBattery.level * 100)
        });
      }
    };

    if ('getBattery' in navigator) {
      (navigator as Navigator & { getBattery: () => Promise<BatteryManager> }).getBattery().then((b: BatteryManager) => {
        navBattery = b;
        updateBattery();
        b.addEventListener('chargingchange', updateBattery);
        b.addEventListener('levelchange', updateBattery);
      }).catch(() => {});
    }

    return () => {
      if (navBattery) {
        navBattery.removeEventListener('chargingchange', updateBattery);
        navBattery.removeEventListener('levelchange', updateBattery);
      }
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    let stopped = false;

    const refreshAlertsSummary = async () => {
      try {
        const response = await fetch(apiUrl('/api/alerts/summary'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await readJsonResponse<{ pending_count?: number } & { error?: string }>(response);
        if (!response.ok || stopped) return;
        setPendingAlertsCount(data.pending_count || 0);
      } catch {
        if (!stopped) setPendingAlertsCount(0);
      }
    };

    refreshAlertsSummary().catch(() => {});
    const interval = setInterval(() => refreshAlertsSummary().catch(() => {}), 15000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [user]);

  const isKioskMode = window.localStorage.getItem('sentys:kiosk_mode') === 'true' || window.sessionStorage.getItem('sentys:control_panel') === 'true';

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetInactivityTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (isKioskMode) {
      timerRef.current = setTimeout(() => {
        logout();
        window.localStorage.removeItem('token');
        window.location.reload();
      }, 5 * 60 * 1000); // 5 minutes
    }
  }, [isKioskMode, logout]);

  useEffect(() => {
    resetInactivityTimer();
    const events = ['mousemove', 'touchstart', 'keydown', 'click'];
    events.forEach(e => window.addEventListener(e, resetInactivityTimer));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach(e => window.removeEventListener(e, resetInactivityTimer));
    };
  }, [resetInactivityTimer]);


  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <BrandLogo
              wrapperClassName="login-logo-mark"
              imageClassName="login-logo-icon"
              fallbackClassName="login-logo-fallback"
              fallbackText={config.appName.charAt(0) || 'A'}
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
    { to: '/videos',   label: 'Caméras',    shortLabel: 'Caméras',  icon: '◉', show: true    },
    { to: '/alerts',   label: 'Alertes',    shortLabel: 'Alertes',  icon: '⚠', show: true, badge: pendingAlertsCount > 0 ? String(pendingAlertsCount) : '' },
    { to: '/system',   label: 'Système',    shortLabel: 'Système', icon: '⌁', show: true },
    //{ to: '/courses',  label: 'Courses',    show: true    },
    { to: '/settings', label: 'Paramètres', shortLabel: 'Réglages', icon: '⚙', show: isAdmin },
  ].filter(l => l.show);

  const { color: systemLedColor, text: systemLedText } = getSystemStatus(isOnline, pendingAlertsCount, batteryInfo);

  return (
    <div className={`app app--density-${config.uiDensity} ${isInstalledMode ? 'app--installed' : ''}`}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo" style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
            <BrandLogo
              wrapperClassName="app-logo-mark"
              imageClassName="app-logo-icon"
              fallbackClassName="app-logo-fallback"
              fallbackText={config.appName.charAt(0) || 'A'}
            />
            <span className="app-logo-text" style={{ display: 'inline-block', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{config.appName}</span>
            {config.showSystemVersion && <span className="app-logo-version" style={{ display: 'inline-block', fontSize: '0.6rem', whiteSpace: 'nowrap' }}>{config.systemVersion}</span>}
          </div>

          <nav className="app-nav" aria-label="Navigation principale">
            {navLinks.map(({ to, label, shortLabel, icon, badge }) => (
              <Link key={to} to={to}
                className={`app-nav-link ${location.pathname === to ? 'active' : ''}`}>
                <span className="app-nav-link-icon" aria-hidden="true">{icon}</span>
                <span className="app-nav-link-text app-nav-link-text--full">{label}</span>
                <span className="app-nav-link-text app-nav-link-text--short">{shortLabel}</span>
                {badge ? <span className="app-nav-link-badge">{badge}</span> : null}
              </Link>
            ))}
          </nav>

          {config.showStatusPanel && (
            <div className="app-status-group">
              <div className="app-status" style={{ color: systemLedColor }}>
                <span className="app-status-dot" style={{ background: systemLedColor, boxShadow: `0 0 8px ${systemLedColor}` }} />
                {systemLedText}
              </div>
            </div>
          )}

          <div className="app-user">
            <span className="app-user-name">{user.username}</span>
            <span className={`app-user-role ${isAdmin ? '' : 'app-user-role--user'}`}>
              {isAdmin ? 'ADMIN' : 'USER'}
            </span>
          </div>

          {isKioskMode && (
            <button className="app-theme-btn" onClick={() => { logout(); window.localStorage.removeItem('token'); window.location.reload(); }} title="Verrouiller l'écran">🔒</button>
          )}

          <button className="app-theme-btn"
            onClick={toggleTheme}
            title={settings.theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}>
            {settings.theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <button className="app-logout-btn" onClick={() => {
            logout();
            window.localStorage.removeItem('token');
            window.location.reload();
          }} title="Se déconnecter">⏻</button>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/"        element={<Navigate to="/videos" replace />} />
          <Route path="/videos"  element={<CameraFeed />} />
          <Route path="/alerts"  element={<AlertsPage />} />
          {/* <Route path="/courses" element={<GroceryList />} />*/}
          <Route path="/system"  element={<SystemInfo />} />
          <Route path="/settings" element={
            <AdminRoute>
              <Settings />
            </AdminRoute>
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
    <AppConfigProvider>
      <AuthProvider>
        <AppearanceProvider>
          <VirtualKeyboardProvider>
            <AppShell />
          </VirtualKeyboardProvider>
        </AppearanceProvider>
      </AuthProvider>
    </AppConfigProvider>
  );
}