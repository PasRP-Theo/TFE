import { useState, useEffect, useMemo } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAppConfig } from '../hooks/useAppConfig';
import { apiUrl, readJsonResponse } from '../lib/api';
import BrandLogo from './BrandLogo';

export default function LoginPage() {
  const { login, verifyMfa, completeSetup } = useAuth();
  const { config } = useAppConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [dots,     setDots]     = useState('');
  const [time,     setTime]     = useState(new Date());
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/auth/setup-status'))
      .then(r => readJsonResponse<{ needsSetup?: boolean }>(r))
      .then(data => { if (!cancelled) setNeedsSetup(Boolean(data.needsSetup)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

  const locale = config.interfaceLanguage;
  const use12HourClock = config.timeFormat === '12h';

  const isLockedOut = useMemo(() => lockoutUntil !== null && lockoutUntil > Date.now(), [lockoutUntil]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isLockedOut) return;
    setError('');
    setLoading(true);
    try {
      if (mfaToken) {
        await verifyMfa(mfaToken, mfaCode);
      } else if (needsSetup) {
        if (password !== passwordConfirm) throw new Error('Les mots de passe ne correspondent pas');
        await completeSetup(setupToken, username, password);
      } else {
        const result = await login(username, password);
        if (result.mfaToken) {
          setMfaToken(result.mfaToken);
          setPassword('');
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur de connexion';
      setError(errorMessage);
      if (errorMessage.includes('expirée')) { setMfaToken(null); setMfaCode(''); }
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

  return (
    <div className="lp-root">
      <div className="lp-grid" />
      <div className="lp-scanlines" />
      <div className="lp-vignette" />
      <div className="lp-corner lp-corner--tl" />
      <div className="lp-corner lp-corner--tr" />
      <div className="lp-corner lp-corner--bl" />
      <div className="lp-corner lp-corner--br" />


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


            <form onSubmit={handleSubmit}>
              {mfaToken ? (
                <div className="lp-field">
                  <label className="lp-label">CODE DE VÉRIFICATION (APPLICATION OU CODE DE RÉCUPÉRATION)</label>
                  <div className="lp-input-wrap">
                    <span className="lp-input-prefix">#</span>
                    <input
                      className="lp-input"
                      type="text"
                      inputMode="text"
                      value={mfaCode}
                      onChange={e => setMfaCode(e.target.value)}
                      placeholder="123456"
                      required
                      disabled={loading}
                      autoFocus
                      autoComplete="one-time-code"
                    />
                  </div>
                </div>
              ) : (<>
              {needsSetup && (
                <>
                  <div className="lp-login-message">
                    Première installation : créez le compte administrateur. Le jeton d'installation
                    est affiché dans la console du serveur (<code>pm2 logs</code>).
                  </div>
                  <div className="lp-field">
                    <label className="lp-label">JETON D'INSTALLATION</label>
                    <div className="lp-input-wrap">
                      <span className="lp-input-prefix">#</span>
                      <input
                        className="lp-input"
                        type="text"
                        value={setupToken}
                        onChange={e => setSetupToken(e.target.value)}
                        required
                        disabled={loading || isLockedOut}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </>
              )}
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
                  autoComplete={needsSetup ? 'new-password' : 'current-password'}

                />
              </div>
            </div>

            {needsSetup && (
              <div className="lp-field">
                <label className="lp-label">CONFIRMATION (15 CARACTÈRES MIN.)</label>
                <div className="lp-input-wrap">
                  <span className="lp-input-prefix">⬥</span>
                  <input
                    className="lp-input"
                    type="password"
                    value={passwordConfirm}
                    onChange={e => setPasswordConfirm(e.target.value)}
                    disabled={loading || isLockedOut}
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            </>)}

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
               isLockedOut ? 'SYSTÈME VERROUILLÉ' : mfaToken ? '→ VÉRIFIER' : needsSetup ? '→ CRÉER LE COMPTE ADMINISTRATEUR' : '→ ACCÉDER AU SYSTÈME'}
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