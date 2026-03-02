import { useState, FormEvent, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { login }    = useAuth();
  const [username,   setUsername]  = useState('');
  const [password,   setPassword]  = useState('');
  const [error,      setError]     = useState('');
  const [loading,    setLoading]   = useState(false);
  const [dots,       setDots]      = useState('');
  const [time,       setTime]      = useState(new Date());

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
      // On passe username dans le champ "email" pour compatibilité avec le backend
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
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .lp-root {
          min-height: 100vh;
          background: #050608;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Share Tech Mono', monospace;
          overflow: hidden;
          position: relative;
        }
        .lp-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(0,200,100,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,200,100,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: gridScroll 20s linear infinite;
        }
        @keyframes gridScroll { from { transform: translateY(0); } to { transform: translateY(40px); } }
        .lp-vignette {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, transparent 40%, #050608 100%);
          pointer-events: none;
        }
        .lp-scanlines {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px);
          pointer-events: none;
        }
        .lp-sysinfo {
          position: absolute; top: 24px; left: 28px;
          color: rgba(0,200,80,0.35); font-size: 10px; letter-spacing: 0.08em; line-height: 1.8;
        }
        .lp-clock {
          position: absolute; top: 24px; right: 28px; text-align: right;
          color: rgba(0,200,80,0.35); font-size: 10px; letter-spacing: 0.08em; line-height: 1.8;
        }
        .lp-clock-time { font-size: 20px; color: rgba(0,200,80,0.5); letter-spacing: 0.12em; }
        .lp-corner {
          position: absolute; width: 40px; height: 40px;
          border-color: rgba(0,200,80,0.2); border-style: solid;
        }
        .lp-corner--tl { top: 16px; left: 16px; border-width: 1px 0 0 1px; }
        .lp-corner--tr { top: 16px; right: 16px; border-width: 1px 1px 0 0; }
        .lp-corner--bl { bottom: 16px; left: 16px; border-width: 0 0 1px 1px; }
        .lp-corner--br { bottom: 16px; right: 16px; border-width: 0 1px 1px 0; }

        .lp-card {
          position: relative; z-index: 10; width: 420px;
          background: rgba(8,12,10,0.95);
          border: 1px solid rgba(0,200,80,0.15);
          animation: fadeIn 0.6s ease;
        }
        @keyframes fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }

        .lp-card-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px;
          background: rgba(0,200,80,0.05);
          border-bottom: 1px solid rgba(0,200,80,0.1);
        }
        .lp-card-topbar-dots { display: flex; gap: 6px; }
        .lp-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(0,200,80,0.15); }
        .lp-dot--active {
          background: rgba(0,200,80,0.6);
          box-shadow: 0 0 6px rgba(0,200,80,0.4);
          animation: blink 2s ease-in-out infinite;
        }
        @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        .lp-card-topbar-label { font-size: 9px; color: rgba(0,200,80,0.4); letter-spacing: 0.2em; }

        .lp-card-body { padding: 36px 36px 28px; }

        .lp-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
        .lp-logo-icon {
          width: 36px; height: 36px;
          border: 1px solid rgba(0,200,80,0.3);
          display: flex; align-items: center; justify-content: center;
          color: rgba(0,200,80,0.8); font-size: 18px;
        }
        .lp-logo-text { font-size: 18px; font-weight: 700; letter-spacing: 0.25em; color: rgba(0,200,80,0.85); }
        .lp-subtitle { font-size: 10px; color: rgba(0,200,80,0.3); letter-spacing: 0.15em; margin-bottom: 32px; padding-left: 48px; }
        .lp-sep { height: 1px; background: linear-gradient(90deg, transparent, rgba(0,200,80,0.15), transparent); margin-bottom: 28px; }

        .lp-field { margin-bottom: 18px; }
        .lp-label { display: block; font-size: 9px; letter-spacing: 0.2em; color: rgba(0,200,80,0.4); margin-bottom: 7px; }
        .lp-input-wrap { position: relative; }
        .lp-input-prefix {
          position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
          font-size: 11px; color: rgba(0,200,80,0.3);
        }
        .lp-input {
          width: 100%;
          background: rgba(0,200,80,0.03);
          border: 1px solid rgba(0,200,80,0.12);
          color: rgba(0,200,80,0.85);
          font-family: 'Share Tech Mono', monospace;
          font-size: 13px; padding: 10px 12px 10px 30px;
          outline: none; transition: border-color 0.2s, background 0.2s;
          letter-spacing: 0.05em;
        }
        .lp-input::placeholder { color: rgba(0,200,80,0.15); }
        .lp-input:focus { border-color: rgba(0,200,80,0.4); background: rgba(0,200,80,0.05); }

        .lp-error {
          display: flex; align-items: center; gap: 8px;
          font-size: 10px; color: #ff4444;
          background: rgba(255,68,68,0.06); border: 1px solid rgba(255,68,68,0.2);
          padding: 8px 12px; margin-bottom: 16px; letter-spacing: 0.06em;
        }
        .lp-btn {
          width: 100%; background: transparent;
          border: 1px solid rgba(0,200,80,0.3);
          color: rgba(0,200,80,0.8);
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px; font-weight: 700; letter-spacing: 0.25em;
          padding: 12px; cursor: pointer; transition: all 0.2s;
          position: relative; overflow: hidden; margin-top: 8px;
        }
        .lp-btn:hover:not(:disabled) {
          border-color: rgba(0,200,80,0.6); color: rgba(0,200,80,1);
          box-shadow: 0 0 16px rgba(0,200,80,0.1);
          background: rgba(0,200,80,0.05);
        }
        .lp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .lp-card-footer {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 16px;
          border-top: 1px solid rgba(0,200,80,0.08);
          background: rgba(0,200,80,0.02);
        }
        .lp-footer-text { font-size: 9px; color: rgba(0,200,80,0.2); letter-spacing: 0.12em; }
        .lp-footer-status { display: flex; align-items: center; gap: 5px; font-size: 9px; color: rgba(0,200,80,0.4); letter-spacing: 0.1em; }
        .lp-footer-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: rgba(0,200,80,0.6); box-shadow: 0 0 4px rgba(0,200,80,0.4);
          animation: blink 2s ease-in-out infinite;
        }
      `}</style>

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
          <div>TIMEZONE // Europe/Paris</div>
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
    </>
  );
}




















/*      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow:wght@300;400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .lp-root {
          min-height: 100vh;
          background: #050608;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Share Tech Mono', monospace;
          overflow: hidden;
          position: relative;
        }
        .lp-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(0,200,100,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,200,100,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: gridScroll 20s linear infinite;
        }
        @keyframes gridScroll { from { transform: translateY(0); } to { transform: translateY(40px); } }
        .lp-vignette {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, transparent 40%, #050608 100%);
          pointer-events: none;
        }
        .lp-scanlines {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px);
          pointer-events: none;
        }
        .lp-sysinfo {
          position: absolute; top: 24px; left: 28px;
          color: rgba(0,200,80,0.35); font-size: 10px; letter-spacing: 0.08em; line-height: 1.8;
        }
        .lp-clock {
          position: absolute; top: 24px; right: 28px; text-align: right;
          color: rgba(0,200,80,0.35); font-size: 10px; letter-spacing: 0.08em; line-height: 1.8;
        }
        .lp-clock-time { font-size: 20px; color: rgba(0,200,80,0.5); letter-spacing: 0.12em; }
        .lp-corner {
          position: absolute; width: 40px; height: 40px;
          border-color: rgba(0,200,80,0.2); border-style: solid;
        }
        .lp-corner--tl { top: 16px; left: 16px; border-width: 1px 0 0 1px; }
        .lp-corner--tr { top: 16px; right: 16px; border-width: 1px 1px 0 0; }
        .lp-corner--bl { bottom: 16px; left: 16px; border-width: 0 0 1px 1px; }
        .lp-corner--br { bottom: 16px; right: 16px; border-width: 0 1px 1px 0; }

        .lp-card {
          position: relative; z-index: 10; width: 420px;
          background: rgba(8,12,10,0.95);
          border: 1px solid rgba(0,200,80,0.15);
          animation: fadeIn 0.6s ease;
        }
        @keyframes fadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }

        .lp-card-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px;
          background: rgba(0,200,80,0.05);
          border-bottom: 1px solid rgba(0,200,80,0.1);
        }
        .lp-card-topbar-dots { display: flex; gap: 6px; }
        .lp-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(0,200,80,0.15); }
        .lp-dot--active {
          background: rgba(0,200,80,0.6);
          box-shadow: 0 0 6px rgba(0,200,80,0.4);
          animation: blink 2s ease-in-out infinite;
        }
        @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        .lp-card-topbar-label { font-size: 9px; color: rgba(0,200,80,0.4); letter-spacing: 0.2em; }

        .lp-card-body { padding: 36px 36px 28px; }

        .lp-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
        .lp-logo-icon {
          width: 36px; height: 36px;
          border: 1px solid rgba(0,200,80,0.3);
          display: flex; align-items: center; justify-content: center;
          color: rgba(0,200,80,0.8); font-size: 18px;
        }
        .lp-logo-text { font-size: 18px; font-weight: 700; letter-spacing: 0.25em; color: rgba(0,200,80,0.85); }
        .lp-subtitle { font-size: 10px; color: rgba(0,200,80,0.3); letter-spacing: 0.15em; margin-bottom: 32px; padding-left: 48px; }
        .lp-sep { height: 1px; background: linear-gradient(90deg, transparent, rgba(0,200,80,0.15), transparent); margin-bottom: 28px; }

        .lp-field { margin-bottom: 18px; }
        .lp-label { display: block; font-size: 9px; letter-spacing: 0.2em; color: rgba(0,200,80,0.4); margin-bottom: 7px; }
        .lp-input-wrap { position: relative; }
        .lp-input-prefix {
          position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
          font-size: 11px; color: rgba(0,200,80,0.3);
        }
        .lp-input {
          width: 100%;
          background: rgba(0,200,80,0.03);
          border: 1px solid rgba(0,200,80,0.12);
          color: rgba(0,200,80,0.85);
          font-family: 'Share Tech Mono', monospace;
          font-size: 13px; padding: 10px 12px 10px 30px;
          outline: none; transition: border-color 0.2s, background 0.2s;
          letter-spacing: 0.05em;
        }
        .lp-input::placeholder { color: rgba(0,200,80,0.15); }
        .lp-input:focus { border-color: rgba(0,200,80,0.4); background: rgba(0,200,80,0.05); }

        .lp-error {
          display: flex; align-items: center; gap: 8px;
          font-size: 10px; color: #ff4444;
          background: rgba(255,68,68,0.06); border: 1px solid rgba(255,68,68,0.2);
          padding: 8px 12px; margin-bottom: 16px; letter-spacing: 0.06em;
        }
        .lp-btn {
          width: 100%; background: transparent;
          border: 1px solid rgba(0,200,80,0.3);
          color: rgba(0,200,80,0.8);
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px; font-weight: 700; letter-spacing: 0.25em;
          padding: 12px; cursor: pointer; transition: all 0.2s;
          position: relative; overflow: hidden; margin-top: 8px;
        }
        .lp-btn:hover:not(:disabled) {
          border-color: rgba(0,200,80,0.6); color: rgba(0,200,80,1);
          box-shadow: 0 0 16px rgba(0,200,80,0.1);
          background: rgba(0,200,80,0.05);
        }
        .lp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .lp-card-footer {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 16px;
          border-top: 1px solid rgba(0,200,80,0.08);
          background: rgba(0,200,80,0.02);
        }
        .lp-footer-text { font-size: 9px; color: rgba(0,200,80,0.2); letter-spacing: 0.12em; }
        .lp-footer-status { display: flex; align-items: center; gap: 5px; font-size: 9px; color: rgba(0,200,80,0.4); letter-spacing: 0.1em; }
        .lp-footer-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: rgba(0,200,80,0.6); box-shadow: 0 0 4px rgba(0,200,80,0.4);
          animation: blink 2s ease-in-out infinite;
        }
      `}</style>*/