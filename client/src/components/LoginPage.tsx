import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAppConfig } from '../hooks/useAppConfig';
import BrandLogo from './BrandLogo.tsx';

export default function LoginPage() {
  const { login }  = useAuth();
  const { config } = useAppConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [dots,     setDots]     = useState('');
  const [time,     setTime]     = useState(new Date());
  const [focusedField, setFocusedField] = useState<'username' | 'password' | null>('username');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [isShift, setIsShift] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(t);
  }, [loading]);

  const locale = config.interfaceLanguage;
  const use12HourClock = config.timeFormat === '12h';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  const timeStr = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: use12HourClock });
  const dateStr = time.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  const keyboardLayout = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm'],
    ['⇧', 'w', 'x', 'c', 'v', 'b', 'n', '⌫'],
    ['@', '.', 'ESPACE', '-', '_', 'ENTRÉE']
  ];

  function handleKeyClick(key: string) {
    if (key === '⇧') { setIsShift(!isShift); return; }
    if (key === 'ENTRÉE') { setShowKeyboard(false); return; }

    const isUser = focusedField === 'username';
    const val = isUser ? username : password;
    const setVal = isUser ? setUsername : setPassword;

    if (key === '⌫') {
      setVal(val.slice(0, -1));
    } else if (key === 'ESPACE') {
      setVal(val + ' ');
    } else {
      const char = (isShift && key.length === 1 && key.match(/[a-z]/i)) ? key.toUpperCase() : key;
      setVal(val + char);
      if (isShift) setIsShift(false);
    }
  }

  return (
    <div className="lp-root" style={{ paddingBottom: showKeyboard ? '280px' : undefined }}>
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

          {config.defaultAdminActive && (
            <div className="lp-error lp-error--info">
              <span>ℹ</span><span>Première connexion : {config.defaultAdminUsername} / root. Change ce compte immédiatement après connexion.</span>
            </div>
          )}

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
                  onFocus={() => { setFocusedField('username'); setShowKeyboard(true); }}
                  placeholder="admin"
                  required
                  autoFocus
                  autoComplete="username"
                  inputMode="none"
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
                  onFocus={() => { setFocusedField('password'); setShowKeyboard(true); }}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  inputMode="none"
                />
              </div>
            </div>

            {error && (
              <div className="lp-error">
                <span>⚠</span><span>{error}</span>
              </div>
            )}

            <button className="lp-btn" type="submit" disabled={loading}>
              {loading ? `AUTHENTIFICATION${dots}` : '→ ACCÉDER AU SYSTÈME'}
            </button>
          </form>
        </div>

        <div className="lp-card-footer">
          <div className="lp-footer-text">{config.appSubtitle.toUpperCase()}{config.showSystemVersion ? ` · ${config.systemVersion}` : ''}</div>
          <div className="lp-footer-status">
            <div className="lp-footer-dot" />
            CONNEXION SÉCURISÉE
          </div>
        </div>
      </div>

      {showKeyboard && (
        <div className="vk-container" onMouseDown={e => e.preventDefault()}>
          <style>{`
            .vk-container {
              position: fixed;
              bottom: 0; left: 0; right: 0;
              background: rgba(8, 17, 29, 0.95);
              backdrop-filter: blur(12px);
              padding: 12px 8px 24px;
              border-top: 1px solid rgba(108, 199, 255, 0.3);
              z-index: 9999;
              display: flex;
              flex-direction: column;
              gap: 8px;
              box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
              animation: vk-slide-up 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            @keyframes vk-slide-up {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
            .vk-row { display: flex; justify-content: center; gap: 6px; }
            .vk-key {
              padding: 14px 0; flex: 1; max-width: 50px;
              background: rgba(255,255,255,0.08); color: white;
              border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
              font-size: 18px; font-family: monospace; cursor: pointer;
              display: flex; align-items: center; justify-content: center;
              user-select: none; transition: background 0.1s, transform 0.1s;
            }
            .vk-key:active { background: rgba(108, 199, 255, 0.4); transform: scale(0.95); }
            .vk-key--wide { max-width: 80px; font-size: 14px; background: rgba(108, 199, 255, 0.15); border-color: rgba(108, 199, 255, 0.3); }
            .vk-key--shift-active { background: rgba(108, 199, 255, 0.4); border-color: rgba(108, 199, 255, 0.8); }
            .vk-key--space { max-width: 250px; }
            .vk-key--danger { background: rgba(248, 113, 113, 0.15); border-color: rgba(248, 113, 113, 0.3); color: #fca5a5; }
          `}</style>
          {keyboardLayout.map((row, rowIndex) => (
            <div key={rowIndex} className="vk-row">
              {row.map(key => {
                let className = "vk-key";
                if (key === '⇧') className += " vk-key--wide" + (isShift ? " vk-key--shift-active" : "");
                else if (key === 'ENTRÉE') className += " vk-key--wide";
                else if (key === 'ESPACE') className += " vk-key--space";
                else if (key === '⌫') className += " vk-key--wide vk-key--danger";
                return (
                  <button key={key} type="button" className={className} onClick={() => handleKeyClick(key)}>
                    {isShift && key.length === 1 && key.match(/[a-z]/i) ? key.toUpperCase() : key}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}