import { useState, FormEvent, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { login }  = useAuth();
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const timeStr = time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = time.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

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
        <div>SYS // SURVEILLANCE-OS v2.4.1</div>
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
            <div className="lp-logo-icon">⬡</div>
            <div className="lp-logo-text">SURVEILLANCE</div>
          </div>
          <div className="lp-subtitle">ACCÈS SÉCURISÉ AU SYSTÈME</div>
          <div className="lp-sep" />

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
          <div className="lp-footer-text">SYSTÈME DE SURVEILLANCE · v2.4.1</div>
          <div className="lp-footer-status">
            <div className="lp-footer-dot" />
            CONNEXION SÉCURISÉE
          </div>
        </div>
      </div>
    </div>
  );
}