import { useState, useEffect, useRef } from "react";
import type Hls from "hls.js";
import type { ErrorData } from "hls.js";
import { apiUrl } from "../lib/api";

type HlsConstructor = typeof import("hls.js").default;

interface Camera {
  id:        number;
  name:      string;
  rtsp_url:  string;
  location:  string;
  motionActive?: boolean;
  lastMotionAt?: string | null;
  nodeDeviceId?: string | null;
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

interface DiscoveredCamera {
  id: number;
  device_id: string;
  name: string;
  host: string;
  stream_url: string;
  location: string;
  model: string;
  source: string;
  last_seen_at: string;
  created_at: string;
}

interface CameraNode {
  id: number;
  device_id: string;
  name: string;
  host: string;
  stream_url: string;
  location: string;
  model: string;
  source: string;
  motion_detected: boolean;
  motionActive: boolean;
  last_motion_at: string | null;
  last_seen_at: string;
  created_at: string;
  connected: boolean;
}

interface MotionEventEntry {
  id: number;
  device_id: string;
  motion: boolean;
  detected_at: string;
  created_at: string;
}

type AddMode = 'node' | 'discover' | 'manual';

// ── Lecteur HLS ────────────────────────────────────────────
function HlsPlayer({ hlsUrl, streamKey }: { hlsUrl: string; streamKey: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullUrl  = `${apiUrl(hlsUrl)}${hlsUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(streamKey)}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stallWatcher: ReturnType<typeof setInterval> | null = null;
    let disposed = false;
    let lastProgressAt = Date.now();
    let lastTime = -1;

    const resetVideoElement = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const destroyPlayer = ({ resetVideo = true } = {}) => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (stallWatcher) {
        clearInterval(stallWatcher);
        stallWatcher = null;
      }
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (resetVideo) {
        resetVideoElement();
      }
    };

    const markProgress = () => {
      lastProgressAt = Date.now();
      lastTime = video.currentTime;
    };

    const scheduleRetry = (delay = 1500) => {
      if (disposed || retryTimer) return;
      destroyPlayer();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!disposed) {
          void loadStream();
        }
      }, delay);
    };

    const startWatchdog = () => {
      if (stallWatcher) clearInterval(stallWatcher);
      stallWatcher = setInterval(() => {
        if (disposed || video.paused || video.ended) return;
        if (video.readyState < 2) {
          if (Date.now() - lastProgressAt > 5000) scheduleRetry(1200);
          return;
        }
        if (video.currentTime !== lastTime) {
          markProgress();
          return;
        }
        if (Date.now() - lastProgressAt > 8000) scheduleRetry(1200);
      }, 3000);
    };

    const setupHls = (HlsLib: HlsConstructor) => {
      if (disposed || !HlsLib.isSupported()) return;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      hls = new HlsLib({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        maxBufferLength: 12,
        backBufferLength: 8,
        manifestLoadingRetryDelay: 1000,
        levelLoadingRetryDelay: 1000,
        fragLoadingRetryDelay: 1000,
      });
      hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
        markProgress();
        startWatchdog();
        video.play().catch(() => {});
      });
      hls.on(HlsLib.Events.FRAG_LOADED, markProgress);
      hls.on(HlsLib.Events.LEVEL_LOADED, markProgress);
      hls.on(HlsLib.Events.ERROR, (_event, data: ErrorData) => {
        if (!data || !data.fatal) return;
        if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
          try {
            hls?.startLoad();
          } catch {
            // noop
          }
          scheduleRetry(1500);
          return;
        }
        if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          scheduleRetry(1800);
          return;
        }
        scheduleRetry(1800);
      });
      hls.loadSource(fullUrl);
      hls.attachMedia(video);
    };

    const loadStream = async () => {
      if (disposed) return;
      markProgress();

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        resetVideoElement();
        video.src = fullUrl;
        video.load();
        startWatchdog();
        video.play().catch(() => {});
        return;
      }

      const { default: HlsLib } = await import('hls.js');
      if (disposed || !HlsLib.isSupported()) return;
      setupHls(HlsLib);
    };

    const handlePlaybackSignal = () => markProgress();
    const handlePotentialStall = () => {
      if (!video.paused) scheduleRetry(1400);
    };

    video.addEventListener('playing', handlePlaybackSignal);
    video.addEventListener('loadeddata', handlePlaybackSignal);
    video.addEventListener('timeupdate', handlePlaybackSignal);
    video.addEventListener('waiting', handlePotentialStall);
    video.addEventListener('stalled', handlePotentialStall);
    video.addEventListener('ended', handlePotentialStall);

    void loadStream().catch(() => {
      scheduleRetry(1500);
    });

    return () => {
      disposed = true;
      video.removeEventListener('playing', handlePlaybackSignal);
      video.removeEventListener('loadeddata', handlePlaybackSignal);
      video.removeEventListener('timeupdate', handlePlaybackSignal);
      video.removeEventListener('waiting', handlePotentialStall);
      video.removeEventListener('stalled', handlePotentialStall);
      video.removeEventListener('ended', handlePotentialStall);
      destroyPlayer();
    };
  }, [fullUrl]);

  return (
    <video ref={videoRef} autoPlay muted playsInline preload="auto" className="cam-video" />
  );
}

// ── Écran offline ─────────────────────────────────────────
function OfflineScreen({ status }: { status: Camera["status"] }) {
  const text = status === 'paused' ? 'EN PAUSE'
             : status === 'reconnecting' ? 'RECONNEXION...'
             : 'FLUX INACTIF';
  return (
    <div className="cam-screen">
      {status === 'reconnecting' && <div className="cam-scanline" />}
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
        ? <HlsPlayer hlsUrl={cam.hlsUrl} streamKey={`${cam.id}:${cam.startedAt || 'pending'}:${cam.status}`} />
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

function MotionBadge({ active }: { active?: boolean }) {
  if (!active) return null;
  return (
    <span className="cam-badge cam-badge--paused">
      <span className="cam-badge-dot" />MOUVEMENT
    </span>
  );
}

function getCameraStatusText(cam: Camera) {
  const base = cam.status === 'running'
    ? `Actif depuis ${new Date(cam.startedAt!).toLocaleTimeString('fr-FR')}`
    : cam.status === 'paused'
      ? 'En pause'
      : cam.status === 'reconnecting'
        ? 'Reconnexion…'
        : 'Inactif';

  if (cam.motionActive) return `${base} · Mouvement detecte`;
  if (cam.lastMotionAt) return `${base} · Dernier mouvement ${new Date(cam.lastMotionAt).toLocaleTimeString('fr-FR')}`;
  return base;
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
        {getCameraStatusText(cam)}
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
  const [addMode, setAddMode] = useState<AddMode>('node');
  const [cameraNodes, setCameraNodes] = useState<CameraNode[]>([]);
  const [cameraNodesLoading, setCameraNodesLoading] = useState(false);
  const [cameraNodesError, setCameraNodesError] = useState<string | null>(null);
  const [nodeMotionWindowSeconds, setNodeMotionWindowSeconds] = useState(20);
  const [searchingEsp32, setSearchingEsp32] = useState(false);
  const [discoverMessage, setDiscoverMessage] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredCamera[]>([]);
  const [discoveriesLoading, setDiscoveriesLoading] = useState(false);
  const [discoveriesError, setDiscoveriesError] = useState<string | null>(null);
  const [discoveriesTtlMinutes, setDiscoveriesTtlMinutes] = useState(10);
  const [time,    setTime]    = useState(new Date());
  const [historyCameraId, setHistoryCameraId] = useState<number | null>(null);
  const [historyRecords, setHistoryRecords] = useState<RecordingEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [motionHistoryDeviceId, setMotionHistoryDeviceId] = useState<string | null>(null);
  const [motionHistoryTitle, setMotionHistoryTitle] = useState('');
  const [motionHistoryRecords, setMotionHistoryRecords] = useState<MotionEventEntry[]>([]);
  const [motionHistoryLoading, setMotionHistoryLoading] = useState(false);
  const [motionHistoryError, setMotionHistoryError] = useState<string | null>(null);

  async function fetchDiscoveries(silent = false) {
    if (!silent) setDiscoveriesLoading(true);
    try {
      const res = await fetch(apiUrl('/api/cameras/discoveries'));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de charger les ESP32 détectées');
      setDiscoveredDevices(Array.isArray(data.devices) ? data.devices : []);
      setDiscoveriesTtlMinutes(typeof data.ttlMinutes === 'number' ? data.ttlMinutes : 10);
      setDiscoveriesError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setDiscoveriesError(message);
    } finally {
      if (!silent) setDiscoveriesLoading(false);
    }
  }

  async function fetchCameraNodes(silent = false) {
    if (!silent) setCameraNodesLoading(true);
    try {
      const res = await fetch(apiUrl('/api/camera-nodes'));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de charger les noeuds camera');
      setCameraNodes(Array.isArray(data.nodes) ? data.nodes : []);
      setNodeMotionWindowSeconds(typeof data.motionActiveWindowSeconds === 'number' ? data.motionActiveWindowSeconds : 20);
      setCameraNodesError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setCameraNodesError(message);
    } finally {
      if (!silent) setCameraNodesLoading(false);
    }
  }

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!showAdd) return;

    let stopped = false;
    setAddMode('node');

    fetchDiscoveries();
    fetchCameraNodes();
    const interval = setInterval(() => {
      if (!stopped) {
        fetchDiscoveries(true);
        fetchCameraNodes(true);
      }
    }, 5000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [showAdd]);

  async function fetchCameras() {
    try {
      const res  = await fetch(apiUrl('/api/cameras'));
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
      await fetch(apiUrl(`/api/cameras/${id}/${action}`), { method: 'POST' });
      fetchCameras();
    } catch { /* ignore */ }
  }

  async function searchEsp32Cameras() {
    setSearchingEsp32(true);
    setDiscoverMessage('Recherche des ESP32-CAM en cours…');
    try {
      const res = await fetch(apiUrl('/api/cameras/discover'));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de recherche ESP32-CAM');
      await fetchDiscoveries(true);
      if (Array.isArray(data.results) && data.results.length > 0) {
        setDiscoverMessage(`${data.results.length} ESP32-CAM détectée${data.results.length > 1 ? 's' : ''}.`);
      } else {
        setDiscoverMessage('Aucune ESP32-CAM trouvée pour le moment.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setDiscoverMessage(message);
    } finally {
      setSearchingEsp32(false);
    }
  }

  async function addCamera() {
    if (!newName.trim() || !newRtsp.trim()) return;
    try {
      const res  = await fetch(apiUrl('/api/cameras'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, rtsp_url: newRtsp, location: newLoc }),
      });
      const data = await res.json();
      setCameras(prev => [...prev, data]);
      setNewName(''); setNewRtsp(''); setNewLoc(''); setDiscoverMessage(null); setShowAdd(false);
    } catch { /* ignore */ }
  }

  async function connectCameraNode(node: CameraNode) {
    try {
      const res = await fetch(apiUrl(`/api/camera-nodes/${encodeURIComponent(node.device_id)}/connect`), {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de connecter le noeud camera');

      const camera = data.camera as Camera | undefined;
      if (camera) {
        setCameras(prev => prev.some(item => item.id === camera.id) ? prev.map(item => item.id === camera.id ? camera : item) : [...prev, camera]);
      }
      setDiscoverMessage(data.alreadyConnected ? `Noeud ${node.name} deja connecte.` : `Noeud ${node.name} connecte.`);
      fetchCameraNodes(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setDiscoverMessage(message);
    }
  }

  function selectDiscoveredDevice(device: DiscoveredCamera) {
    setAddMode('manual');
    setNewName(device.name || device.device_id);
    setNewRtsp(device.stream_url);
    setNewLoc(device.location || device.host);
    setDiscoverMessage(`ESP32 détectée sélectionnée : ${device.name} (${device.host})`);
  }

  async function addDiscoveredDevice(device: DiscoveredCamera) {
    try {
      const res  = await fetch(apiUrl('/api/cameras'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: device.name || device.device_id,
          rtsp_url: device.stream_url,
          location: device.location || device.host,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible d’ajouter la caméra détectée');
      setCameras(prev => [...prev, data]);
      setNewName('');
      setNewRtsp('');
      setNewLoc('');
      setDiscoverMessage(`Caméra ajoutée depuis ${device.host}`);
      setShowAdd(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setDiscoverMessage(message);
    }
  }

  async function deleteCamera(id: number) {
    if (!confirm('Supprimer cette caméra ?')) return;
    await fetch(apiUrl(`/api/cameras/${id}`), { method: 'DELETE' });
    setCameras(prev => prev.filter(c => c.id !== id));
    if (focused === id) setFocused(null);
  }

  async function loadCameraHistory(id: number) {
    setHistoryCameraId(id);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(apiUrl(`/api/cameras/${id}/history`));
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

  async function loadMotionHistory(deviceId: string, title: string) {
    setMotionHistoryDeviceId(deviceId);
    setMotionHistoryTitle(title);
    setMotionHistoryLoading(true);
    setMotionHistoryError(null);
    try {
      const res = await fetch(apiUrl(`/api/camera-nodes/${encodeURIComponent(deviceId)}/motion-history`));
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Impossible de charger l’historique mouvement');
      }
      const data = await res.json();
      setMotionHistoryRecords(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setMotionHistoryRecords([]);
      setMotionHistoryError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setMotionHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryCameraId(null);
    setHistoryRecords([]);
    setHistoryError(null);
  }

  function closeMotionHistory() {
    setMotionHistoryDeviceId(null);
    setMotionHistoryTitle('');
    setMotionHistoryRecords([]);
    setMotionHistoryError(null);
  }

  const onlineCount = cameras.filter(c => c.status === 'running').length;
  const recCount    = cameras.filter(c => c.recording).length;
  const focusedCam  = cameras.find(c => c.id === focused);
  const canAddManually = Boolean(newName.trim() && newRtsp.trim());

  function toggleAddPanel() {
    setShowAdd((current) => {
      const next = !current;
      if (next) {
        setAddMode('node');
      } else {
        setDiscoverMessage(null);
      }
      return next;
    });
  }

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
          <button
            type="button"
            className={`panel-action-btn ${showAdd ? 'panel-action-btn--active' : ''}`}
            onClick={toggleAddPanel}
          >
            <span className="panel-action-btn__icon" aria-hidden="true">{showAdd ? '×' : '+'}</span>
            <span>{showAdd ? 'Fermer' : 'Ajouter une camera'}</span>
          </button>
        </div>
      </div>

      {/* Formulaire ajout */}
      {showAdd && (
        <div className="cam-add-form">
          <div className="cam-add-topbar">
            <div>
              <h3 className="cam-add-title">Ajouter une caméra</h3>
              <p className="cam-add-subtitle">Noeud Raspberry Pi, ESP32-CAM ou flux manuel.</p>
            </div>
            <div className="cam-add-mode-switch">
              <button
                type="button"
                className={`cam-add-mode-btn ${addMode === 'node' ? 'cam-add-mode-btn--active' : ''}`}
                onClick={() => setAddMode('node')}
              >
                Noeud Pi
              </button>
              <button
                type="button"
                className={`cam-add-mode-btn ${addMode === 'discover' ? 'cam-add-mode-btn--active' : ''}`}
                onClick={() => setAddMode('discover')}
              >
                ESP32-CAM
              </button>
              <button
                type="button"
                className={`cam-add-mode-btn ${addMode === 'manual' ? 'cam-add-mode-btn--active' : ''}`}
                onClick={() => setAddMode('manual')}
              >
                Manuel
              </button>
            </div>
          </div>

          {addMode === 'node' && (
            <section className="cam-discovery-panel">
              <div className="cam-discovery-header">
                <div>
                  <h3 className="cam-discovery-title">Noeuds Raspberry Pi detectes</h3>
                  <p className="cam-discovery-subtitle">Mouvement actif pendant {nodeMotionWindowSeconds} secondes apres la derniere detection.</p>
                </div>
                <button
                  type="button"
                  className="sensor-link-btn"
                  onClick={() => fetchCameraNodes()}
                  disabled={cameraNodesLoading}
                >
                  {cameraNodesLoading ? 'Actualisation...' : 'Actualiser'}
                </button>
              </div>
              {discoverMessage && (
                <div className="sensor-note">
                  <p>{discoverMessage}</p>
                </div>
              )}
              {cameraNodesLoading && <p>Chargement des noeuds camera…</p>}
              {cameraNodesError && <p className="cam-discovery-error">{cameraNodesError}</p>}
              {!cameraNodesLoading && !cameraNodesError && cameraNodes.length === 0 && (
                <p className="cam-discovery-empty">Aucun noeud detecte. Lance le script d’annonce sur le Raspberry Pi.</p>
              )}
              {cameraNodes.length > 0 && (
                <ul className="cam-discovery-list">
                  {cameraNodes.map(node => (
                    <li key={node.device_id} className="cam-discovery-item">
                      <div className="cam-discovery-item-head">
                        <strong>{node.name}</strong>
                        <span className={`cam-discovery-source cam-discovery-source--${node.source}`}>{node.model || node.source}</span>
                      </div>
                      <div className="cam-discovery-meta">{node.host}{node.location ? ` · ${node.location}` : ''}</div>
                      <div className="cam-discovery-meta">Vu le {new Date(node.last_seen_at).toLocaleString('fr-FR')}</div>
                      <div className="cam-inline-actions">
                        <StatusBadge status={node.connected ? 'running' : 'stopped'} />
                        <MotionBadge active={node.motionActive} />
                        <button
                          type="button"
                          className="sensor-link-btn"
                          onClick={() => loadMotionHistory(node.device_id, node.name)}
                        >
                          Historique mouvement
                        </button>
                        <button
                          type="button"
                          className="sensor-confirm-btn"
                          onClick={() => connectCameraNode(node)}
                        >
                          {node.connected ? 'Reconnecter vue' : 'Connecter'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {addMode === 'discover' && (
            <section className="cam-discovery-panel">
              <div className="cam-discovery-header">
                <div>
                  <h3 className="cam-discovery-title">ESP32 vues récemment</h3>
                  <p className="cam-discovery-subtitle">Fenêtre de visibilité : {discoveriesTtlMinutes} min</p>
                </div>
                <button
                  type="button"
                  className="sensor-link-btn"
                  onClick={searchEsp32Cameras}
                  disabled={searchingEsp32}
                >
                  {searchingEsp32 ? 'Recherche...' : 'Chercher ESP32-CAM'}
                </button>
              </div>
              {discoverMessage && (
                <div className="sensor-note">
                  <p>{discoverMessage}</p>
                </div>
              )}
              {discoveriesLoading && <p>Chargement des annonces ESP32…</p>}
              {discoveriesError && <p className="cam-discovery-error">{discoveriesError}</p>}
              {!discoveriesLoading && !discoveriesError && discoveredDevices.length === 0 && (
                <p className="cam-discovery-empty">Aucune annonce reçue. Lancez une recherche pour remplir la liste.</p>
              )}
              {discoveredDevices.length > 0 && (
                <ul className="cam-discovery-list">
                  {discoveredDevices.map(device => (
                    <li key={device.device_id} className="cam-discovery-item">
                      <div className="cam-discovery-item-head">
                        <strong>{device.name}</strong>
                        <span className={`cam-discovery-source cam-discovery-source--${device.source}`}>{device.source}</span>
                      </div>
                      <div className="cam-discovery-meta">{device.host}{device.location ? ` · ${device.location}` : ''}</div>
                      <div className="cam-discovery-meta">Vu le {new Date(device.last_seen_at).toLocaleString('fr-FR')}</div>
                      <div className="cam-inline-actions">
                        <button
                          type="button"
                          className="sensor-link-btn"
                          onClick={() => selectDiscoveredDevice(device)}
                        >
                          Préremplir
                        </button>
                        <button
                          type="button"
                          className="sensor-confirm-btn"
                          onClick={() => addDiscoveredDevice(device)}
                        >
                          Ajouter directement
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {addMode === 'manual' && (
            <section className="cam-manual-panel">
              <div>
                <h3 className="cam-discovery-title">Ajout manuel</h3>
                <p className="cam-discovery-subtitle">Saisissez un flux RTSP ou HTTP valide.</p>
              </div>
              <input className="sensor-input" placeholder="Nom de la caméra"
                value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
              <input className="sensor-input" placeholder="IP ou URL de flux (rtsp://... / http://... )"
                value={newRtsp} onChange={e => setNewRtsp(e.target.value)} />
              <input className="sensor-input" placeholder="Emplacement (optionnel)"
                value={newLoc} onChange={e => setNewLoc(e.target.value)} />
              {discoverMessage && (
                <div className="sensor-note">
                  <p>{discoverMessage}</p>
                </div>
              )}
              <div className="cam-add-actions">
                <button type="button" className="sensor-link-btn" onClick={() => setAddMode('node')}>
                  Retour aux noeuds Pi
                </button>
                <button className="sensor-confirm-btn" onClick={addCamera} disabled={!canAddManually}>Ajouter</button>
              </div>
            </section>
          )}
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
              <div className="cam-card-actions cam-card-actions--wide-gap">
                <StatusBadge status={focusedCam.status} />
                <MotionBadge active={focusedCam.motionActive} />
                {focusedCam.nodeDeviceId && (
                  <button className="sensor-link-btn" onClick={() => loadMotionHistory(focusedCam.nodeDeviceId!, focusedCam.name)}>
                    Mouvements
                  </button>
                )}
                <button className="cam-card-history" onClick={() => loadCameraHistory(focusedCam.id)}>📁 Historique</button>
                <button className="cam-card-delete" onClick={() => deleteCamera(focusedCam.id)}>✕</button>
              </div>
            </div>
            <CameraScreen cam={focusedCam} time={time} />
            <CameraControls cam={focusedCam} onAction={handleAction} />
          </div>
          <div className="cam-focus-hint">
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
                <div className="cam-card-actions">
                  <StatusBadge status={cam.status} />
                  <MotionBadge active={cam.motionActive} />
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
                <div className="cam-history-meta">
                  {historyRecords.length} enregistrement{historyRecords.length > 1 ? 's' : ''}
                </div>
              </div>
              <button className="cam-card-delete" onClick={closeHistory}>✕</button>
            </div>
            {historyLoading && <p>Chargement de l’historique…</p>}
            {historyError && <p className="cam-history-error">{historyError}</p>}
            {!historyLoading && !historyError && historyRecords.length === 0 && (
              <p>Aucun enregistrement disponible pour cette caméra.</p>
            )}
            {!historyLoading && historyRecords.length > 0 && (
              <div className="cam-history-list">
                {historyRecords.map(entry => (
                  <div key={entry.filename} className="cam-history-row">
                    <div>
                      <strong>{entry.filename}</strong>
                      <div className="cam-history-meta">
                        {new Date(entry.createdAt).toLocaleString('fr-FR')} · {Math.round(entry.size / 1024)} KB
                      </div>
                    </div>
                    <a
                      href={apiUrl(entry.url)}
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

      {motionHistoryDeviceId !== null && (
        <div className="cam-history-overlay" onClick={closeMotionHistory}>
          <div className="cam-history-panel" onClick={e => e.stopPropagation()}>
            <div className="cam-history-header">
              <div>
                <strong>Historique mouvement {motionHistoryTitle}</strong>
                <div className="cam-history-meta">
                  {motionHistoryRecords.length} evenement{motionHistoryRecords.length > 1 ? 's' : ''}
                </div>
              </div>
              <button className="cam-card-delete" onClick={closeMotionHistory}>✕</button>
            </div>
            {motionHistoryLoading && <p>Chargement de l’historique mouvement…</p>}
            {motionHistoryError && <p className="cam-history-error">{motionHistoryError}</p>}
            {!motionHistoryLoading && !motionHistoryError && motionHistoryRecords.length === 0 && (
              <p>Aucun mouvement enregistre pour ce noeud.</p>
            )}
            {!motionHistoryLoading && motionHistoryRecords.length > 0 && (
              <div className="cam-history-list">
                {motionHistoryRecords.map(entry => (
                  <div key={entry.id} className="cam-history-row">
                    <div>
                      <strong>{entry.motion ? 'Mouvement detecte' : 'Etat inactif'}</strong>
                      <div className="cam-history-meta">
                        {new Date(entry.detected_at).toLocaleString('fr-FR')}
                      </div>
                    </div>
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