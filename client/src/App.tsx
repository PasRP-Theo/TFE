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
import './App.css';

// ── Enregistrement de la PWA (Service Worker) ──────────────
if (typeof window !== 'undefined') {
  registerSW({ immediate: true });
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// ── Route protégée par rôle ────────────────────────────────
function AdminRoute({ 
  children, 
  isKioskMode, 
  kioskActiveRole 
}: { 
  children: React.ReactNode;
  isKioskMode: boolean;
  kioskActiveRole: 'guest' | 'admin' | null;
}) {
  const { user } = useAuth();
  const hasAccess = user?.role === 'admin' && (!isKioskMode || kioskActiveRole === 'admin');
  
  // Redirige automatiquement vers l'accueil si le rôle n'est pas suffisant (ex: Mode Invité)
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
      (window as any).deferredInstallPrompt = promptEvent;
    };

    const handleAppInstalled = () => {
      (window as any).deferredInstallPrompt = null;
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
    let navBattery: any;
    const updateBattery = () => {
      if (navBattery) {
        setBatteryInfo({
          charging: navBattery.charging,
          level: Math.round(navBattery.level * 100)
        });
      }
    };

    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((b: any) => {
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

  const isKioskMode = window.localStorage.getItem('sentys:kiosk_mode') === 'true';
  const kioskPin = window.localStorage.getItem('sentys:kiosk_pin') || '';

  const [isLocked, setIsLocked] = useState(isKioskMode);
  const [kioskActiveRole, setKioskActiveRole] = useState<'guest' | 'admin' | null>(null);
  const [showAdminPin, setShowAdminPin] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [lockError, setLockError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetInactivityTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (isKioskMode && !isLocked) {
      timerRef.current = setTimeout(() => {
        setIsLocked(true);
        setKioskActiveRole(null);
        setShowAdminPin(false);
        setEnteredPin("");
        setAttempts(0);
        setLockError("");
      }, 5 * 60 * 1000); // 5 minutes
    }
  }, [isKioskMode, isLocked]);

  useEffect(() => {
    resetInactivityTimer();
    const events = ['mousemove', 'touchstart', 'keydown', 'click'];
    events.forEach(e => window.addEventListener(e, resetInactivityTimer));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach(e => window.removeEventListener(e, resetInactivityTimer));
    };
  }, [resetInactivityTimer]);

  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      if (Date.now() > lockoutUntil) {
        setLockoutUntil(null);
        setAttempts(0);
        setLockError("");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

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

  if (isKioskMode && isLocked) {
    const isLockedOut = lockoutUntil !== null;

    const handlePinPress = (digit: string) => {
      if (isLockedOut || enteredPin.length >= 4) return;
      const nextPin = enteredPin + digit;
      setEnteredPin(nextPin);
      setLockError("");

      if (nextPin.length === 4) {
        if (nextPin === kioskPin) {
          setIsLocked(false);
          setKioskActiveRole('admin');
          setEnteredPin("");
          setShowAdminPin(false);
          setAttempts(0);
        } else {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          if (newAttempts >= 3) {
            setLockoutUntil(new Date().getTime() + 60000);
            setLockError("SYSTÈME BLOQUÉ (1 MIN)");
              
              // Envoi immédiat de l'alerte de sécurité à l'administrateur
              const currentToken = window.localStorage.getItem('token');
              if (currentToken) {
                fetch(apiUrl('/api/alerts'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${currentToken}`,
                  },
                  body: JSON.stringify({
                    alert_type: 'security_kiosk_lock',
                    level: 'critical',
                    title: 'Tentatives d\'accès Kiosk échouées',
                    message: `Le panneau de contrôle a été temporairement verrouillé suite à 3 codes PIN incorrects.`,
                    source_type: 'system',
                  })
                }).catch(err => console.error('Erreur lors de l\'envoi de l\'alerte de sécurité', err));
              }
          } else {
            setLockError(`CODE INCORRECT (${3 - newAttempts} ESSAIS)`);
          }
          setTimeout(() => setEnteredPin(""), 500);
        }
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw', position: 'fixed', top: 0, left: 0, zIndex: 9999, background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
        <div style={{ background: 'var(--bg-surface)', padding: '40px', borderRadius: '12px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-elevated)', width: '320px', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 20px 0', letterSpacing: '2px', color: 'var(--accent-blue)' }}>🔒 ÉCRAN DE CONTRÔLE</h2>
          
          {!isOnline && (
            <div style={{ background: 'var(--bg-hover)', color: 'var(--accent-amber)', padding: '12px', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--accent-amber)', fontSize: '0.85rem', fontWeight: 'bold', lineHeight: '1.4' }}>
              ⚠️ ALERTE<br/>Absence de réseau IP détectée.
            </div>
          )}

          {batteryInfo && !batteryInfo.charging && (
            <div style={{ background: 'var(--bg-hover)', color: batteryInfo.level <= 20 ? 'var(--accent-red)' : 'var(--accent-amber)', padding: '12px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${batteryInfo.level <= 20 ? 'var(--accent-red)' : 'var(--accent-amber)'}`, fontSize: '0.85rem', fontWeight: 'bold', lineHeight: '1.4' }}>
              {batteryInfo.level <= 20 ? '🚨' : '⚠️'} ALIMENTATION COUPÉE<br/>L'appareil est sur batterie ({batteryInfo.level}%).
            </div>
          )}

          {!showAdminPin ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '20px 0' }}>
              <button className="sensor-confirm-btn sensor-confirm-btn--xl" style={{ padding: '20px', fontSize: '18px' }} onClick={() => { setIsLocked(false); setKioskActiveRole('guest'); }}>CONNEXION INVITÉ</button>
              <button className="sensor-delete-btn sensor-delete-btn--xl" style={{ padding: '20px', fontSize: '18px', background: 'var(--accent-blue-bg)', color: 'var(--accent-blue)', border: '1px solid var(--accent-blue-border)' }} onClick={() => {
                if (kioskPin) {
                  setShowAdminPin(true);
                } else {
                  setIsLocked(false);
                  setKioskActiveRole('admin');
                }
              }}>CONNEXION ADMIN</button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '30px' }}>
                {[0, 1, 2, 3].map(i => <div key={i} style={{ width: '20px', height: '20px', borderRadius: '50%', background: enteredPin.length > i ? 'var(--accent-blue)' : 'transparent', border: '2px solid var(--accent-blue)', transition: 'all 0.2s' }} />)}
              </div>
              {lockError && <div style={{ color: 'var(--accent-red)', marginBottom: '20px', fontSize: '12px', fontWeight: 'bold' }}>{lockError}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', opacity: isLockedOut ? 0.5 : 1, pointerEvents: isLockedOut ? 'none' : 'auto' }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => <button key={num} onClick={() => handlePinPress(num.toString())} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '24px', padding: '20px 0', borderRadius: '8px', cursor: 'pointer' }}>{num}</button>)}
                <button onClick={() => { setEnteredPin(""); setLockError(""); }} style={{ background: 'var(--accent-red-bg)', border: '1px solid var(--accent-red-border)', color: 'var(--accent-red)', fontSize: '20px', borderRadius: '8px', cursor: 'pointer' }}>C</button>
                <button onClick={() => handlePinPress('0')} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '24px', padding: '20px 0', borderRadius: '8px', cursor: 'pointer' }}>0</button>
                <button onClick={() => setEnteredPin(p => p.slice(0, -1))} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--accent-amber)', fontSize: '20px', borderRadius: '8px', cursor: 'pointer' }}>⌫</button>
              </div>
              <div style={{ marginTop: '20px' }}>
                <button className="sensor-link-btn" onClick={() => { setShowAdminPin(false); setEnteredPin(""); setLockError(""); }}>← Retour</button>
              </div>
            </>
          )}

          <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid var(--border-subtle)' }}>
            <button className="sensor-link-btn" onClick={() => { window.localStorage.removeItem('sentys:kiosk_mode'); window.location.href = '/'; }}>Quitter le mode Kiosk</button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = user.role === 'admin';

  const navLinks = [
    { to: '/videos',   label: 'Caméras',    shortLabel: 'Caméras',  icon: '◉', show: true    },
    { to: '/alerts',   label: 'Alertes',    shortLabel: 'Alertes',  icon: '⚠', show: true, badge: pendingAlertsCount > 0 ? String(pendingAlertsCount) : '' },
    { to: '/system',   label: 'Système',    shortLabel: 'Système', icon: '⌁', show: true },
    //{ to: '/courses',  label: 'Courses',    show: true    },
    { to: '/settings', label: 'Paramètres', shortLabel: 'Réglages', icon: '⚙', show: isAdmin && (!isKioskMode || kioskActiveRole === 'admin') },
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
              {isInstalledMode && (
                <div className="app-installed-badge">
                  <span className="app-installed-badge-dot" />
                  MODE APP
                </div>
              )}
            </div>
          )}

          <div className="app-user">
            <span className="app-user-email">{isKioskMode && kioskActiveRole === 'guest' ? 'Mode Invité' : user.email}</span>
            <span className={`app-user-role ${isAdmin && (!isKioskMode || kioskActiveRole === 'admin') ? '' : 'app-user-role--user'}`}>
              {isKioskMode && kioskActiveRole === 'guest' ? 'GUEST' : (isAdmin ? 'ADMIN' : 'USER')}
            </span>
          </div>

          {isKioskMode && (
            <button className="app-theme-btn" onClick={() => { setIsLocked(true); setKioskActiveRole(null); setShowAdminPin(false); setEnteredPin(""); }} title="Verrouiller l'écran">🔒</button>
          )}

          <button className="app-theme-btn"
            onClick={toggleTheme}
            title={settings.theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}>
            {settings.theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <button className="app-logout-btn" onClick={logout} title="Se déconnecter">⏻</button>
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
            <AdminRoute isKioskMode={isKioskMode} kioskActiveRole={kioskActiveRole}>
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
          <AppShell />
        </AppearanceProvider>
      </AuthProvider>
    </AppConfigProvider>
  );
}