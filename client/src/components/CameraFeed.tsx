import { useState, useEffect } from "react";

interface Camera {
  id:       number;
  name:     string;
  location: string;
  status:   "running" | "paused" | "stopped";
  startedAt: Date;
}

const INITIAL_CAMERAS: Camera[] = [
  { id: 1, name: "Entrée principale", location: "Extérieur",    status: "running", startedAt: new Date() },
  { id: 2, name: "Salon",             location: "RDC",          status: "running", startedAt: new Date() },
  { id: 3, name: "Cuisine",           location: "RDC",          status: "running", startedAt: new Date() },
  { id: 4, name: "Garage",            location: "Extérieur",    status: "stopped", startedAt: new Date() },
  { id: 5, name: "Jardin",            location: "Extérieur",    status: "running", startedAt: new Date() },
  { id: 6, name: "Chambre",           location: "Étage",        status: "paused",  startedAt: new Date() },
];

function StatusBadge({ status }: { status: Camera["status"] }) {
  const cfg = {
    running: { label: "EN LIGNE",  cls: "cam-badge--online"  },
    paused:  { label: "EN PAUSE",  cls: "cam-badge--paused"  },
    stopped: { label: "ARRÊTÉE",   cls: "cam-badge--offline" },
  }[status];
  return (
    <span className={`cam-badge ${cfg.cls}`}>
      <span className="cam-badge-dot" />
      {cfg.label}
    </span>
  );
}

// Écran simulé avec effet scanline
function FakeScreen({ status, name }: { status: Camera["status"]; name: string }) {
  const [scanY, setScanY] = useState(0);

  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => setScanY(y => (y + 2) % 100), 30);
    return () => clearInterval(t);
  }, [status]);

  if (status !== "running") {
    return (
      <div className="cam-screen">
        <div className="cam-offline">
          <div className="cam-offline-icon">⊘</div>
          <p className="cam-offline-text">
            {status === "paused" ? "EN PAUSE" : "FLUX INACTIF"}
          </p>
        </div>
        <div className="cam-corner cam-corner--tl" />
        <div className="cam-corner cam-corner--tr" />
        <div className="cam-corner cam-corner--bl" />
        <div className="cam-corner cam-corner--br" />
      </div>
    );
  }

  return (
    <div className="cam-screen">
      {/* Bruit simulé */}
      <div className="cam-noise" />
      {/* Scanline */}
      <div className="cam-scanline" style={{ top: `${scanY}%` }} />
      {/* Coins */}
      <div className="cam-corner cam-corner--tl" />
      <div className="cam-corner cam-corner--tr" />
      <div className="cam-corner cam-corner--bl" />
      <div className="cam-corner cam-corner--br" />
      {/* Indicateur REC */}
      <div className="cam-rec-indicator">
        <div className="cam-rec-dot-anim" /> REC
      </div>
    </div>
  );
}

export default function CameraFeed() {
  const [cameras, setCameras] = useState<Camera[]>(INITIAL_CAMERAS);
  const [focused, setFocused] = useState<number | null>(null);
  const [time,    setTime]    = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  function stopCamera(id: number) {
    setCameras(prev => prev.map(c =>
      c.id === id ? { ...c, status: "stopped" } : c
    ));
  }

  function pauseCamera(id: number) {
    setCameras(prev => prev.map(c =>
      c.id === id ? { ...c, status: "paused" } : c
    ));
  }

  function resumeCamera(id: number) {
    setCameras(prev => prev.map(c =>
      c.id === id ? { ...c, status: "running", startedAt: new Date() } : c
    ));
  }

  const onlineCount = cameras.filter(c => c.status === "running").length;
  const focusedCam  = cameras.find(c => c.id === focused);

  return (
    <>
      <style>{`
        .cam-page { display:flex; flex-direction:column; gap:1rem; }

        .cam-header {
          display:flex; justify-content:space-between; align-items:center;
          padding-bottom:1rem; border-bottom:1px solid var(--border); flex-wrap:wrap; gap:8px;
        }
        .cam-header-left { display:flex; flex-direction:column; gap:4px; }
        .cam-header-title { font-size:13px; font-weight:700; letter-spacing:0.2em; color:var(--text-primary); }
        .cam-header-meta  { display:flex; gap:12px; }
        .cam-header-stat  { font-size:10px; letter-spacing:0.08em; color:var(--text-muted); }
        .cam-header-stat span { color:var(--accent-green); }
        .cam-clock { font-size:11px; color:var(--text-muted); letter-spacing:0.1em; }

        .cam-grid {
          display:grid; grid-template-columns:repeat(3,1fr); gap:12px;
        }
        @media(max-width:900px){ .cam-grid { grid-template-columns:repeat(2,1fr); } }
        @media(max-width:560px){ .cam-grid { grid-template-columns:1fr; } }

        .cam-card {
          background:var(--bg-surface); border:1px solid var(--border); border-radius:4px;
          overflow:hidden; cursor:pointer; transition:border-color 0.15s, box-shadow 0.15s;
          display:flex; flex-direction:column;
        }
        .cam-card:hover    { border-color:var(--accent-blue); }
        .cam-card--focused { border-color:var(--accent-blue); box-shadow:0 0 0 1px var(--accent-blue); }
        .cam-card--rec     { border-color:rgba(239,68,68,0.35); }

        .cam-card-header {
          display:flex; justify-content:space-between; align-items:center;
          padding:8px 12px; background:var(--bg-elevated); border-bottom:1px solid var(--border);
        }
        .cam-card-title   { display:flex; align-items:center; gap:8px; }
        .cam-card-id      { font-size:9px; font-weight:700; color:var(--accent-red); letter-spacing:0.1em; }
        .cam-card-name    { font-size:10px; color:var(--text-secondary); letter-spacing:0.06em; }
        .cam-card-loc     { font-size:9px; color:var(--text-muted); }

        .cam-badge {
          display:inline-flex; align-items:center; gap:5px;
          font-size:9px; font-weight:700; letter-spacing:0.12em;
          padding:2px 7px; border-radius:2px; border:1px solid;
        }
        .cam-badge--online  { color:var(--accent-green); background:rgba(34,197,94,0.08);  border-color:rgba(34,197,94,0.25); }
        .cam-badge--offline { color:var(--text-muted);   background:rgba(75,85,99,0.08);   border-color:rgba(75,85,99,0.2);  }
        .cam-badge--paused  { color:#f59e0b;              background:rgba(245,158,11,0.08); border-color:rgba(245,158,11,0.25); }
        .cam-badge-dot { width:5px; height:5px; border-radius:50%; background:currentColor; }

        .cam-screen {
          position:relative; width:100%; aspect-ratio:16/9;
          background:var(--camera-screen-bg); overflow:hidden;
          display:flex; align-items:center; justify-content:center;
        }

        .cam-noise {
          position:absolute; inset:0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E");
          opacity: 0.3;
          pointer-events:none;
        }

        .cam-scanline {
          position:absolute; left:0; right:0; height:2px;
          background:rgba(96,165,250,0.15); pointer-events:none; transition:top 30ms linear;
        }

        .cam-corner { position:absolute; width:14px; height:14px; border-color:var(--camera-corner-color); border-style:solid; }
        .cam-corner--tl { top:8px;    left:8px;   border-width:1.5px 0 0 1.5px; }
        .cam-corner--tr { top:8px;    right:8px;  border-width:1.5px 1.5px 0 0; }
        .cam-corner--bl { bottom:8px; left:8px;   border-width:0 0 1.5px 1.5px; }
        .cam-corner--br { bottom:8px; right:8px;  border-width:0 1.5px 1.5px 0; }

        .cam-rec-indicator {
          position:absolute; top:8px; right:8px; z-index:5;
          display:flex; align-items:center; gap:4px;
          background:rgba(0,0,0,0.6); border:1px solid rgba(239,68,68,0.5);
          padding:2px 6px; border-radius:2px;
          font-size:9px; font-weight:700; letter-spacing:0.15em; color:var(--accent-red);
        }
        .cam-rec-dot-anim {
          width:6px; height:6px; border-radius:50%;
          background:var(--accent-red); animation:pulse 1s ease-in-out infinite;
        }

        .cam-offline { text-align:center; z-index:1; }
        .cam-offline-icon { font-size:24px; color:var(--camera-offline-icon); margin-bottom:6px; }
        .cam-offline-text { color:var(--text-muted); font-size:9px; letter-spacing:0.2em; }

        .cam-footer {
          display:flex; align-items:center; gap:8px; padding:8px 12px;
          background:var(--bg-elevated); border-top:1px solid var(--border);
        }
        .cam-footer-status { font-size:9px; color:var(--text-muted); letter-spacing:0.06em; flex:1; }
        .cam-btn-stop, .cam-btn-pause, .cam-btn-start {
          background:transparent; font-family:var(--font-mono);
          font-size:9px; font-weight:700; letter-spacing:0.1em;
          padding:4px 10px; border-radius:3px; cursor:pointer; transition:all 0.15s; border:1px solid;
        }
        .cam-btn-stop  { border-color:rgba(239,68,68,0.3);  color:var(--accent-red); }
        .cam-btn-stop:hover:not(:disabled) { background:rgba(239,68,68,0.08); border-color:var(--accent-red); }
        .cam-btn-stop:disabled { opacity:0.25; cursor:not-allowed; }
        .cam-btn-pause { border-color:rgba(245,158,11,0.3); color:#f59e0b; }
        .cam-btn-pause:hover { background:rgba(245,158,11,0.08); border-color:#f59e0b; }
        .cam-btn-start { border-color:rgba(34,197,94,0.3);  color:var(--accent-green); }
        .cam-btn-start:hover { background:rgba(34,197,94,0.08); border-color:var(--accent-green); }

        .cam-focus-back {
          display:flex; align-items:center; gap:6px;
          font-size:10px; color:var(--text-muted); cursor:pointer; letter-spacing:0.08em;
          width:fit-content;
        }
        .cam-focus-back:hover { color:var(--accent-blue); }

        .cam-time-overlay {
          position:absolute; bottom:8px; left:8px; z-index:5;
          font-size:9px; letter-spacing:0.1em; color:rgba(255,255,255,0.4);
          background:rgba(0,0,0,0.35); padding:2px 5px; border-radius:2px;
        }
      `}</style>

      <div className="cam-page">

        {/* Header */}
        <div className="cam-header">
          <div className="cam-header-left">
            <span className="cam-header-title">CAMÉRAS</span>
            <div className="cam-header-meta">
              <span className="cam-header-stat">
                EN LIGNE <span>{onlineCount}/{cameras.length}</span>
              </span>
            </div>
          </div>
          <span className="cam-clock">{time.toLocaleTimeString('fr-FR')}</span>
        </div>

        {/* Vue focus — clic en dehors de la carte = retour grille */}
        {focusedCam ? (
          <div
            style={{ display:'flex', flexDirection:'column', gap:'12px', cursor:'pointer' }}
            onClick={() => setFocused(null)}
          >
            <div className={`cam-card ${focusedCam.status === 'running' ? 'cam-card--rec' : ''}`} onClick={e => e.stopPropagation()}>
              <div className="cam-card-header">
                <div className="cam-card-title">
                  <span className="cam-card-id">CAM {String(focusedCam.id).padStart(2,'0')}</span>
                  <span className="cam-card-name">{focusedCam.name}</span>
                  <span className="cam-card-loc">· {focusedCam.location}</span>
                </div>
                <StatusBadge status={focusedCam.status} />
              </div>
              <FakeScreen status={focusedCam.status} name={focusedCam.name} />
              <div className="cam-footer">
                <span className="cam-footer-status">
                  {focusedCam.status === 'running'
                    ? `Actif depuis ${focusedCam.startedAt.toLocaleTimeString('fr-FR')}`
                    : focusedCam.status === 'paused' ? 'En pause' : 'Inactif'}
                </span>
                {focusedCam.status === 'running' && (
                  <button className="cam-btn-pause" onClick={() => pauseCamera(focusedCam.id)}>⏸ PAUSE</button>
                )}
                {focusedCam.status === 'paused' && (
                  <button className="cam-btn-start" onClick={() => resumeCamera(focusedCam.id)}>▶ REPRENDRE</button>
                )}
                {(focusedCam.status === 'stopped' || focusedCam.status === 'paused') && focusedCam.status !== 'running' && focusedCam.status === 'stopped' && (
                  <button className="cam-btn-start" onClick={() => resumeCamera(focusedCam.id)}>▶ DÉMARRER</button>
                )}
                <button
                  className="cam-btn-stop"
                  onClick={() => stopCamera(focusedCam.id)}
                  disabled={focusedCam.status === 'stopped'}
                >
                  ⏹ STOP
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Grille */
          <div className="cam-grid">
            {cameras.map(cam => (
              <div
                key={cam.id}
                className={`cam-card ${cam.status === 'running' ? 'cam-card--rec' : ''} ${focused === cam.id ? 'cam-card--focused' : ''}`}
                onClick={() => setFocused(cam.id)}
              >
                <div className="cam-card-header" onClick={e => e.stopPropagation()}>
                  <div className="cam-card-title">
                    <span className="cam-card-id">CAM {String(cam.id).padStart(2,'0')}</span>
                    <span className="cam-card-name">{cam.name}</span>
                  </div>
                  <StatusBadge status={cam.status} />
                </div>

                <FakeScreen status={cam.status} name={cam.name} />

                <div className="cam-footer" onClick={e => e.stopPropagation()}>
                  <span className="cam-footer-status">
                    {cam.status === 'running'
                      ? `Actif depuis ${cam.startedAt.toLocaleTimeString('fr-FR')}`
                      : cam.status === 'paused' ? 'En pause' : 'Inactif'}
                  </span>
                  {cam.status === 'running' && (
                    <button className="cam-btn-pause" onClick={() => pauseCamera(cam.id)}>⏸</button>
                  )}
                  {cam.status === 'paused' && (
                    <button className="cam-btn-start" onClick={() => resumeCamera(cam.id)}>▶</button>
                  )}
                  {cam.status === 'stopped' && (
                    <button className="cam-btn-start" onClick={() => resumeCamera(cam.id)}>▶</button>
                  )}
                  <button
                    className="cam-btn-stop"
                    onClick={() => stopCamera(cam.id)}
                    disabled={cam.status === 'stopped'}
                  >
                    ⏹
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}