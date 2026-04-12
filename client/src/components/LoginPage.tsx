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
                  placeholder="admin"
                  required
                  autoFocus
                  autoComplete="username"
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
                  required
                  autoComplete="current-password"
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
    </div>
  );
}