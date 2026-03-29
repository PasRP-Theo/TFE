import { useState, useEffect, useRef } from "react";

interface HlsInstance {
  loadSource(source: string): void;
  attachMedia(video: HTMLVideoElement): void;
  on(event: string, callback: () => void): void;
  destroy(): void;
}

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface Camera {
  id:        number;
  name:      string;
  rtsp_url:  string;
  location:  string;
  status:    "running" | "paused" | "stopped" | "reconnecting";
  recording: boolean;
  startedAt: string | null;
  hlsUrl:    string | null;
}

interface RecordingEntry {
  filename:  string;
  url:       string;
  createdAt: string;
  size:      number;
}

// ── Lecteur HLS ────────────────────────────────────────────
function HlsPlayer({ hlsUrl }: { hlsUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullUrl  = `${API}${hlsUrl}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: any = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    const cleanup = () => {
      destroyed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (video) {
        video.pause();
        video.src = '';
      }
    };

    const setupHls = (Hls: any) => {
      if (destroyed || !video || !Hls.isSupported()) return;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 30,
        backBufferLength: 15,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
        if (!data || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryTimer == null) {
          cleanup();
          retryTimer = setTimeout(() => {
            if (!destroyed) import('hls.js').then(({ default: HlsLib }) => setupHls(HlsLib)).catch(() => {});
          }, 2000);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }
        cleanup();
      });
      hls.loadSource(fullUrl);
      hls.attachMedia(video);
    };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = fullUrl;
      video.load();
      video.play().catch(() => {});
      return cleanup;
    }

    import('hls.js').then(({ default: Hls }) => {
      if (destroyed || !video || !Hls.isSupported()) return;
      setupHls(Hls);
    }).catch(() => {});

    return () => {
      cleanup();
    };
  }, [fullUrl]);

  return (
    <video ref={videoRef} autoPlay muted playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  );
}

// ── Écran offline ─────────────────────────────────────────
function OfflineScreen({ status }: { status: Camera["status"] }) {
  const [scanY, setScanY] = useState(0);
  useEffect(() => {
    if (status !== 'reconnecting') return;
    const t = setInterval(() => setScanY(y => (y + 2) % 100), 30);
    return () => clearInterval(t);
  }, [status]);

  const text = status === 'paused' ? 'EN PAUSE'
             : status === 'reconnecting' ? 'RECONNEXION...'
             : 'FLUX INACTIF';
  return (
    <div className="cam-screen">
      {status === 'reconnecting' && <div className="cam-scanline" style={{ top: `${scanY}%` }} />}
      <div className="cam-offline">
        <div className="cam-offline-icon">⊘</div>
        <p className="cam-offline-text">{text}</p>
      </div>
      <div className="cam-corner cam-corner--tl" />
      <div className="cam-corner cam-corner--tr" />
      <div className="cam-corner cam-corner--bl" />
      <div className="cam-corner cam-corner--br" />
    </div>
  );
}

// ── Écran caméra ──────────────────────────────────────────
function CameraScreen({ cam, time }: { cam: Camera; time: Date }) {
  return (
    <div className="cam-screen">
      {cam.status === 'running' && cam.hlsUrl
        ? <HlsPlayer hlsUrl={cam.hlsUrl} />
        : <OfflineScreen status={cam.status} />
      }
      {cam.recording && (
        <div className="cam-rec-indicator">
          <div className="cam-rec-dot-anim" /> REC
        </div>
      )}
      <div className="cam-time-overlay">{time.toLocaleTimeString('fr-FR')}</div>
      <div className="cam-corner cam-corner--tl" />
      <div className="cam-corner cam-corner--tr" />
      <div className="cam-corner cam-corner--bl" />
      <div className="cam-corner cam-corner--br" />
    </div>
  );
}

// ── Badge statut ──────────────────────────────────────────
function StatusBadge({ status }: { status: Camera["status"] }) {
  const cfg = {
    running:      { label: "EN LIGNE",    cls: "cam-badge--online"    },
    paused:       { label: "EN PAUSE",    cls: "cam-badge--paused"    },
    stopped:      { label: "ARRÊTÉE",     cls: "cam-badge--offline"   },
    reconnecting: { label: "RECONNEXION", cls: "cam-badge--reconnect" },
  }[status];
  return (
    <span className={`cam-badge ${cfg.cls}`}>
      <span className="cam-badge-dot" />{cfg.label}
    </span>
  );
}

// ── Contrôles ─────────────────────────────────────────────
function CameraControls({ cam, onAction }: {
  cam: Camera;
  onAction: (id: number, action: "start" | "pause" | "resume" | "stop") => void;
}) {
  const { id, status } = cam;
  return (
    <div className="cam-footer" onClick={e => e.stopPropagation()}>
      <span className="cam-footer-status">
        {status === 'running'      ? `Actif depuis ${new Date(cam.startedAt!).toLocaleTimeString('fr-FR')}`
        : status === 'paused'      ? 'En pause'
        : status === 'reconnecting'? 'Reconnexion…'
        : 'Inactif'}
      </span>
      {status === 'stopped'      && <button className="cam-btn-start" onClick={() => onAction(id, 'start')}>▶ START</button>}
      {status === 'running'      && <button className="cam-btn-pause" onClick={() => onAction(id, 'pause')}>⏸ PAUSE</button>}
      {status === 'paused'       && <button className="cam-btn-start" onClick={() => onAction(id, 'resume')}>▶ REPRENDRE</button>}
      {(status === 'running' || status === 'paused' || status === 'reconnecting') &&
        <button className="cam-btn-stop" onClick={() => onAction(id, 'stop')}>⏹ STOP</button>}
    </div>
  );
}

// ── Composant principal ────────────────────────────────────
export default function CameraFeed() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRtsp, setNewRtsp] = useState('');
  const [newLoc,  setNewLoc]  = useState('');
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [scanningLocal, setScanningLocal] = useState(false);
  const [discoverMessage, setDiscoverMessage] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<Array<{ host: string; streamUrl: string }>>([]);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [scanElapsed, setScanElapsed] = useState(0);
  const scanAbortController = useRef<AbortController | null>(null);
  const [time,    setTime]    = useState(new Date());
  const [historyCameraId, setHistoryCameraId] = useState<number | null>(null);
  const [historyRecords, setHistoryRecords] = useState<RecordingEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scanningLocal) {
      setScanElapsed(0);
      return;
    }
    const interval = setInterval(() => setScanElapsed(seconds => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, [scanningLocal]);

  async function fetchCameras() {
    try {
      const res  = await fetch(`${API}/api/cameras`);
      const data = await res.json();
      if (Array.isArray(data)) setCameras(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchCameras();
    const t = setInterval(fetchCameras, 3000);
    return () => clearInterval(t);
  }, []);

  async function handleAction(id: number, action: "start" | "pause" | "resume" | "stop") {
    try {
      await fetch(`${API}/api/cameras/${id}/${action}`, { method: 'POST' });
      fetchCameras();
    } catch { /* ignore */ }
  }

  async function detectCamera() {
    const target = newRtsp.trim();
    if (!target) {
      setDiscoverMessage('Entrez une adresse IP ou une URL avant de détecter.');
      return;
    }
    setDiscovering(true);
    setDiscoverMessage(null);
    try {
      const res = await fetch(`${API}/api/cameras/discover?host=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de découverte');
      setNewRtsp(data.streamUrl);
      setDiscoverMessage(`Flux détecté : ${data.streamUrl}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setDiscoverMessage(message || 'Erreur de découverte');
    } finally {
      setDiscovering(false);
    }
  }

  function cancelLocalScan() {
    if (!scanAbortController.current) return;
    scanAbortController.current.abort();
    scanAbortController.current = null;
    setScanningLocal(false);
    setDiscoverMessage('Scan réseau annulé.');
    setScanLogs(prev => [...prev, 'Scan annulé par l’utilisateur.']);
  }

  async function scanLocalNetwork() {
    const controller = new AbortController();
    scanAbortController.current = controller;
    setScanningLocal(true);
    setScanResults([]);
    setScanLogs([
      'Lancement du scan réseau local...',
      'Envoi de la requête au serveur...',
      'Le scan peut prendre quelques dizaines de secondes si aucun flux n’est trouvé.',
    ]);
    setDiscoverMessage('Scan réseau local en cours…');
    const scanStart = Date.now();
    try {
      const res = await fetch(`${API}/api/cameras/discover`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de scan réseau');
      const elapsedSeconds = Math.max(0, Math.round((Date.now() - scanStart) / 1000));
      setScanLogs(prev => [...prev, 'Réponse reçue du serveur.', `Scan terminé en ${elapsedSeconds}s.`]);
      if (Array.isArray(data.results) && data.results.length > 0) {
        setScanResults(data.results);
        setNewRtsp(data.results[0].streamUrl);
        setDiscoverMessage(`Flux détecté sur ${data.results[0].host}`);
        setScanLogs(prev => [...prev, `Flux détecté sur ${data.results[0].host}`]);
      } else {
        setDiscoverMessage('Aucun flux détecté sur le réseau local.');
        setScanLogs(prev => [...prev, 'Aucun flux trouvé sur le réseau local.']);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setDiscoverMessage('Scan réseau annulé.');
        setScanLogs(prev => [...prev, 'Scan annulé par l’utilisateur.']);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setDiscoverMessage(message || 'Erreur de scan réseau');
        setScanLogs(prev => [...prev, `Erreur : ${message || 'échec du scan'}`]);
      }
    } finally {
      scanAbortController.current = null;
      setScanningLocal(false);
    }
  }

  async function addCamera() {
    if (!newName.trim() || !newRtsp.trim()) return;
    try {
      const res  = await fetch(`${API}/api/cameras`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, rtsp_url: newRtsp, location: newLoc }),
      });
      const data = await res.json();
      setCameras(prev => [...prev, data]);
      setNewName(''); setNewRtsp(''); setNewLoc(''); setDiscoverMessage(null); setScanResults([]); setShowAdd(false);
    } catch { /* ignore */ }
  }

  async function deleteCamera(id: number) {
    if (!confirm('Supprimer cette caméra ?')) return;
    await fetch(`${API}/api/cameras/${id}`, { method: 'DELETE' });
    setCameras(prev => prev.filter(c => c.id !== id));
    if (focused === id) setFocused(null);
  }

  async function loadCameraHistory(id: number) {
    setHistoryCameraId(id);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`${API}/api/cameras/${id}/history`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Impossible de charger l’historique');
      }
      const data = await res.json();
      setHistoryRecords(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setHistoryRecords([]);
      setHistoryError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryCameraId(null);
    setHistoryRecords([]);
    setHistoryError(null);
  }

  const onlineCount = cameras.filter(c => c.status === 'running').length;
  const recCount    = cameras.filter(c => c.recording).length;
  const focusedCam  = cameras.find(c => c.id === focused);

  return (
    <div className="cam-page">

      {/* Header */}
      <div className="cam-header">
        <div className="cam-header-left">
          <span className="cam-header-title">CAMÉRAS</span>
          <div className="cam-header-meta">
            <span className="cam-header-stat">EN LIGNE <span>{onlineCount}/{cameras.length}</span></span>
            <span className="cam-header-stat rec">REC <span>{recCount}</span></span>
          </div>
        </div>
        <div className="cam-header-right">
          <span className="cam-clock">{time.toLocaleTimeString('fr-FR')}</span>
          <button className="sensor-add-btn" onClick={() => setShowAdd(v => !v)}>
            {showAdd ? '✕' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {/* Formulaire ajout */}
      {showAdd && (
        <div className="cam-add-form">
          <input className="sensor-input" placeholder="Nom de la caméra"
            value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
          <input className="sensor-input" placeholder="IP ou URL de flux (rtsp://... / http://... )"
            value={newRtsp} onChange={e => setNewRtsp(e.target.value)} />
          <div className="cam-add-actions">
            <button
              type="button"
              className="sensor-confirm-btn"
              onClick={detectCamera}
              disabled={discovering}
            >
              {discovering ? 'Détection...' : 'Détecter'}
            </button>
            <button
              type="button"
              className="sensor-confirm-btn"
              onClick={scanLocalNetwork}
              disabled={scanningLocal}
            >
              {scanningLocal ? 'Scan...' : 'Scanner le réseau'}
            </button>
            {scanningLocal && (
              <button
                type="button"
                className="sensor-cancel-btn"
                onClick={cancelLocalScan}
              >
                Annuler
              </button>
            )}
          </div>
          {(discoverMessage || scanResults.length > 0 || scanLogs.length > 0) && (
            <div className="sensor-note">
              {discoverMessage && <p>{discoverMessage}</p>}
              {scanningLocal && (
                <p>Recherche des caméras sur le réseau local… Cela peut prendre quelques secondes.</p>
              )}
              {scanningLocal && (
                <p>Temps écoulé : {scanElapsed}s</p>
              )}
              {scanLogs.length > 0 && (
                <div className="sensor-scan-log">
                  <p>Journal du scan :</p>
                  <ol>
                    {scanLogs.map((log, idx) => <li key={idx}>{log}</li>)}
                  </ol>
                </div>
              )}
              {scanResults.length > 0 && (
                <div>
                  <p>Résultats trouvés :</p>
                  <ul className="sensor-scan-results">
                    {scanResults.map(result => (
                      <li key={result.host} className="sensor-scan-result-item">
                        <div>
                          <strong>IP :</strong> {result.host}
                        </div>
                        <div>
                          <strong>Flux probable :</strong> {result.streamUrl}
                        </div>
                        <button
                          type="button"
                          className="sensor-link-btn"
                          onClick={() => setNewRtsp(result.streamUrl)}
                        >
                          Utiliser ce flux
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <input className="sensor-input" placeholder="Emplacement (optionnel)"
            value={newLoc} onChange={e => setNewLoc(e.target.value)} />
          <button className="sensor-confirm-btn" onClick={addCamera}>Ajouter</button>
        </div>
      )}

      {/* Vue focus */}
      {focusedCam ? (
        <div className="cam-focus-wrapper" onClick={() => setFocused(null)}>
          <div className={`cam-card ${focusedCam.recording ? 'cam-card--rec' : ''}`}
            onClick={e => e.stopPropagation()}>
            <div className="cam-card-header">
              <div className="cam-card-title">
                <span className="cam-card-id">CAM {String(focusedCam.id).padStart(2, '0')}</span>
                <span className="cam-card-name">{focusedCam.name}</span>
                {focusedCam.location && <span className="cam-card-loc">· {focusedCam.location}</span>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <StatusBadge status={focusedCam.status} />
                <button className="cam-card-history" onClick={() => loadCameraHistory(focusedCam.id)}>📁 Historique</button>
                <button className="cam-card-delete" onClick={() => deleteCamera(focusedCam.id)}>✕</button>
              </div>
            </div>
            <CameraScreen cam={focusedCam} time={time} />
            <CameraControls cam={focusedCam} onAction={handleAction} />
          </div>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:8, letterSpacing:'0.08em' }}>
            ← Clic en dehors pour revenir à la grille
          </div>
        </div>
      ) : (
        <div className="cam-grid">
          {loading && <div className="cam-empty">Chargement des caméras…</div>}
          {!loading && cameras.length === 0 && (
            <div className="cam-empty">
              Aucune caméra configurée — cliquez "+ Ajouter" pour commencer.
            </div>
          )}
          {cameras.map(cam => (
            <div
              key={cam.id}
              className={`cam-card ${cam.recording ? 'cam-card--rec' : ''} ${focused === cam.id ? 'cam-card--focused' : ''}`}
              onClick={() => setFocused(cam.id)}
            >
              <div className="cam-card-header" onClick={e => e.stopPropagation()}>
                <div className="cam-card-title">
                  <span className="cam-card-id">CAM {String(cam.id).padStart(2, '0')}</span>
                  <span className="cam-card-name">{cam.name}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <StatusBadge status={cam.status} />
                  <button className="cam-card-history"
                    onClick={e => { e.stopPropagation(); loadCameraHistory(cam.id); }}>
                    📁
                  </button>
                  <button className="cam-card-delete"
                    onClick={e => { e.stopPropagation(); deleteCamera(cam.id); }}>✕</button>
                </div>
              </div>
              <CameraScreen cam={cam} time={time} />
              <CameraControls cam={cam} onAction={handleAction} />
            </div>
          ))}
        </div>
      )}

      {historyCameraId !== null && (
        <div className="cam-history-overlay" onClick={closeHistory}>
          <div className="cam-history-panel" onClick={e => e.stopPropagation()}>
            <div className="cam-history-header">
              <div>
                <strong>Historique caméra {historyCameraId}</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {historyRecords.length} enregistrement{historyRecords.length > 1 ? 's' : ''}
                </div>
              </div>
              <button className="cam-card-delete" onClick={closeHistory}>✕</button>
            </div>
            {historyLoading && <p>Chargement de l’historique…</p>}
            {historyError && <p style={{ color: 'var(--danger)' }}>{historyError}</p>}
            {!historyLoading && !historyError && historyRecords.length === 0 && (
              <p>Aucun enregistrement disponible pour cette caméra.</p>
            )}
            {!historyLoading && historyRecords.length > 0 && (
              <div className="cam-history-list">
                {historyRecords.map(entry => (
                  <div key={entry.filename} className="cam-history-row">
                    <div>
                      <strong>{entry.filename}</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(entry.createdAt).toLocaleString('fr-FR')} · {Math.round(entry.size / 1024)} KB
                      </div>
                    </div>
                    <a
                      href={`${API}${entry.url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="cam-history-link"
                    >
                      Ouvrir
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}