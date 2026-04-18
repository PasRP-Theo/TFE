import { useState, useEffect, useMemo, useRef } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAppConfig } from '../hooks/useAppConfig';
import BrandLogo from './BrandLogo';
import { useVirtualKeyboard } from '../hooks/useVirtualKeyboard';

export default function LoginPage() {
  const { login }  = useAuth();
  const { config } = useAppConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [dots,     setDots]     = useState('');
  const [time,     setTime]     = useState(new Date());
  const autoLoginAttempted = useRef(false);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);

  const isControlPanel = useMemo(() => {
    if (window.location.pathname === '/controlpanel') {
      window.sessionStorage.setItem('sentys:control_panel', 'true');
      return true;
    }
    return window.sessionStorage.getItem('sentys:control_panel') === 'true';
  }, []);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const { showKeyboard, isKeyboardEnabled } = useVirtualKeyboard();

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      const secondsLeft = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (secondsLeft > 0) {
        setLockoutSecondsLeft(secondsLeft);
      } else {
        setLockoutUntil(null);
        setLockoutSecondsLeft(0);
        setError('');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  useEffect(() => {
    const isKioskMode = window.localStorage.getItem('sentys:kiosk_mode') === 'true';

    // On tente l'auto-login en mode Kiosk SEULEMENT si le compte bootstrap par défaut est actif
    if (isKioskMode && config.defaultAdminActive && !autoLoginAttempted.current) {
      autoLoginAttempted.current = true;
      setLoading(true);
      // Utilise les identifiants par défaut du compte bootstrap (ex: root/root)
      login(config.defaultAdminUsername, 'root').catch(() => {
        console.warn("Auto-login Kiosk avec le compte bootstrap a échoué.");
        setError("L'auto-login Kiosk a échoué. Le compte 'root' est peut-être désactivé.");
        setLoading(false);
      });
    }
  }, [login, config.defaultAdminActive, config.defaultAdminUsername]);

  const locale = config.interfaceLanguage;
  const use12HourClock = config.timeFormat === '12h';

  const isLockedOut = useMemo(() => lockoutUntil !== null && lockoutUntil > Date.now(), [lockoutUntil]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isLockedOut) return;
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur de connexion';
      setError(errorMessage);
      if (errorMessage.includes('Trop de tentatives')) {
        const lockoutEndsAt = Date.now() + 15 * 60 * 1000;
        setLockoutUntil(lockoutEndsAt);
        setLockoutSecondsLeft(15 * 60);
      }
    } finally {
      setLoading(false);
    }
  }

  const timeStr = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: use12HourClock });
  const dateStr = time.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const lockoutMinutes = Math.floor(lockoutSecondsLeft / 60);
  const lockoutSeconds = String(lockoutSecondsLeft % 60).padStart(2, '0');

  function handleGuestLogin() {
    if (isLockedOut) return;
    setError('');
    setLoading(true);
    login('kiosk_guest', '').catch(err => {
      setError(err instanceof Error ? err.message : 'Erreur Invité');
      setLoading(false);
    });
  }

  function handleAdminLogin() {
    if (isLockedOut) return;
    setShowPinPrompt(true);
    setError('');
  }

  function handlePinPress(digit: string) {
    if (isLockedOut || pinInput.length >= 4) return;
    const nextPin = pinInput + digit;
    setPinInput(nextPin);
    setError('');

    if (nextPin.length === 4) {
      const savedPin = config.kioskPin || '1234';
      if (nextPin === savedPin) {
        setError('');
        setLoading(true);
        login('kiosk_admin', '').catch(err => {
          setError(err instanceof Error ? err.message : 'Erreur Admin');
          setLoading(false);
          setPinInput('');
        });
      } else {
        setError('Code PIN incorrect');
        setTimeout(() => setPinInput(''), 500);
      }
    }
  }

  return (
    <div className="lp-root">
      <div className="lp-grid" />
      <div className="lp-scanlines" />
      <div className="lp-vignette" />
      <div className="lp-corner lp-corner--tl" />
      <div className="lp-corner lp-corner--tr" />
      <div className="lp-corner lp-corner--bl" />
      <div className="lp-corner lp-corner--br" />

      <div className="lp-sysinfo">
        <div>SYS // {config.appName.toUpperCase()}{config.showSystemVersion ? ` ${config.systemVersion}` : ''}</div>
        <div>NODE // CENTRAL-UNIT-01</div>
        <div>NET  // 192.168.1.1 — SECURED</div>
      </div>

      <div className="lp-clock">
        <div className="lp-clock-time">{timeStr}</div>
        <div>{dateStr}</div>
        <div>TIMEZONE // Europe/Brussels</div>
      </div>

      <div className="lp-card">
        <div className="lp-card-topbar">
          <div className="lp-card-topbar-dots">
            <div className="lp-dot lp-dot--active" />
            <div className="lp-dot" />
            <div className="lp-dot" />
          </div>
          <div className="lp-card-topbar-label">AUTH_MODULE // RESTRICTED ACCESS</div>
        </div>

        <div className="lp-card-body">
          <div className="lp-logo">
            <BrandLogo
              wrapperClassName="lp-logo-mark"
              imageClassName="lp-logo-icon"
              fallbackClassName="lp-logo-fallback"
              fallbackText={config.appName.charAt(0) || 'A'}
            />
            <div className="lp-logo-text">{config.appName}</div>
          </div>
          <div className="lp-subtitle">{config.appSubtitle.toUpperCase()}</div>
          <div className="lp-login-message">{config.loginMessage}</div>
          <div className="lp-sep" />

          {config.defaultAdminActive && !isControlPanel && (
            <div className="lp-error lp-error--info">
              <span>ℹ</span><span>Première connexion : {config.defaultAdminUsername} / root. Change ce compte immédiatement après connexion.</span>
            </div>
          )}

          {isControlPanel ? (
            showPinPrompt ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ marginBottom: '16px', fontSize: '14px', letterSpacing: '2px', color: 'var(--accent-blue)', fontWeight: 'bold' }}>
                  CODE PIN (ADMIN)
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '20px' }}>
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: pinInput.length > i ? 'var(--accent-blue)' : 'transparent', border: '2px solid var(--accent-blue)', transition: 'all 0.2s' }} />
                  ))}
                </div>
                {isLockedOut ? (
                  <div className="lp-error" style={{ marginBottom: '15px', width: '100%' }}>
                    <span>⚠</span>
                    <span>Trop de tentatives. Réessayez dans {lockoutMinutes}m {lockoutSeconds}s.</span>
                  </div>
                ) : error && (
                  <div className="lp-error" style={{ marginBottom: '15px', width: '100%' }}>
                    <span>⚠</span><span>{error}</span>
                  </div>
                )}
                {loading ? (
                  <button className="lp-btn" type="button" disabled>VÉRIFICATION{dots}</button>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', width: '100%', maxWidth: '280px', opacity: isLockedOut ? 0.5 : 1, pointerEvents: isLockedOut ? 'none' : 'auto' }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                      <button key={num} type="button" onClick={() => handlePinPress(num.toString())} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '20px', padding: '15px 0', borderRadius: '8px', cursor: 'pointer' }}>{num}</button>
                    ))}
                    <button type="button" onClick={() => { setPinInput(""); setError(""); }} style={{ background: 'var(--accent-red-bg)', border: '1px solid var(--accent-red-border)', color: 'var(--accent-red)', fontSize: '18px', borderRadius: '8px', cursor: 'pointer' }}>C</button>
                    <button type="button" onClick={() => handlePinPress('0')} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: '20px', padding: '15px 0', borderRadius: '8px', cursor: 'pointer' }}>0</button>
                    <button type="button" onClick={() => setPinInput(p => p.slice(0, -1))} style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--accent-amber)', fontSize: '18px', borderRadius: '8px', cursor: 'pointer' }}>⌫</button>
                  </div>
                )}
                <button 
                  className="lp-btn" 
                  type="button" 
                  onClick={() => { setShowPinPrompt(false); setError(''); setPinInput(''); }} 
                  disabled={loading}
                  style={{ marginTop: '20px', background: 'transparent', border: '1px dashed var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  RETOUR
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <button className="lp-btn" type="button" onClick={handleAdminLogin} disabled={loading || isLockedOut}>
                  {loading ? `CONNEXION${dots}` : '🛡️ CONNEXION ADMIN'}
                </button>
                <button 
                  className="lp-btn" 
                  type="button" 
                  onClick={handleGuestLogin} 
                  disabled={loading || isLockedOut} 
                  style={{ background: 'transparent', border: '1px dashed var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  👁️ CONNEXION INVITÉ
                </button>
                {error && (
                  <div className="lp-error" style={{ marginTop: '0' }}>
                    <span>⚠</span><span>{error}</span>
                  </div>
                )}
              </div>
            )
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="lp-field">
                <label className="lp-label">IDENTIFIANT</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-prefix">›</span>
                  <input
                    className="lp-input"
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="admin"
                    required
                    disabled={loading || isLockedOut}
                    autoFocus
                    autoComplete="username"
                    readOnly={isKeyboardEnabled}
                    onFocus={() => showKeyboard(username, setUsername)}
                  />
                </div>
              </div>

            <div className="lp-field">
              <label className="lp-label">MOT DE PASSE</label>
              <div className="lp-input-wrap">
                <span className="lp-input-prefix">⬥</span>
                <input
                  className="lp-input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={loading || isLockedOut}
                  required
                  autoComplete="current-password"
                  readOnly={isKeyboardEnabled}
                  onFocus={() => showKeyboard(password, setPassword)}
                />
              </div>
            </div>

            {isLockedOut ? (
              <div className="lp-error">
                <span>⚠</span>
                <span>Trop de tentatives. Réessayez dans {lockoutMinutes}m {lockoutSeconds}s.</span>
              </div>
            ) : error && (
              <div className="lp-error">
                <span>⚠</span><span>{error}</span>
              </div>
            )}

            <button className="lp-btn" type="submit" disabled={loading || isLockedOut}>
              {loading ? `AUTHENTIFICATION${dots}` : 
               isLockedOut ? 'SYSTÈME VERROUILLÉ' : '→ ACCÉDER AU SYSTÈME'}
            </button>
          </form>
          )}
        </div>

        <div className="lp-card-footer">
          <div className="lp-footer-text">{config.appSubtitle.toUpperCase()}{config.showSystemVersion ? ` · ${config.systemVersion}` : ''}</div>
          <div className="lp-footer-status">
            <div className="lp-footer-dot" />
            CONNEXION SÉCURISÉE
          </div>
        </div>
      </div>
    </div>
  );
}