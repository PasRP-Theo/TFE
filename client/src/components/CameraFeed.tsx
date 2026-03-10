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
            className="cam-focus-wrapper"
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
  );
}