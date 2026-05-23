import { useState, useEffect, useRef, useCallback } from "react";
import type Hls from "hls.js";
import type { ErrorData } from "hls.js";
import { apiUrl } from "../lib/api";
import { WebRTCPlayer } from "./WebRTCPlayer";
import { useAppConfig } from "../hooks/useAppConfig";
import { useAuth } from "../hooks/useAuth";
import { useVirtualKeyboard } from "../hooks/useVirtualKeyboard";

interface Camera {
  id:        number;
  name:      string;
  rtsp_url:  string;
  location:  string;
  motionActive?: boolean;
  lastMotionAt?: string | null;
  nodeDeviceId?: string | null;
  status:    "running" | "paused" | "stopped" | "reconnecting" | "watching";
  recording: boolean;
  startedAt: string | null;
  hlsUrl:    string | null;
}

interface CameraStatusSummary {
  reconnectingCount: number;
  stoppedCount: number;
}

interface RecordingEntry {
  filename:  string;
  url:       string;
  createdAt: string;
  size:      number;
}

interface HistoryResponse {
  recordings: RecordingEntry[];
  retentionDays?: number;
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

interface MotionEventEntry {
  id: number;
  device_id: string;
  motion: boolean;
  detected_at: string;
  created_at: string;
  offline_recording?: boolean;
  recording_path?: string | null;
}

type AddMode = 'discover' | 'manual';
type HistorySort = 'recent' | 'oldest' | 'largest';

function formatStorageSize(sizeInBytes: number) {
  if (sizeInBytes < 1024) return `${sizeInBytes} o`;
  if (sizeInBytes < 1024 * 1024) return `${Math.round(sizeInBytes / 1024)} Ko`;
  if (sizeInBytes < 1024 * 1024 * 1024) return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatHistoryDate(value: string) {
  return new Date(value).toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getHistoryGroupLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (left: Date, right: Date) => (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  );

  if (sameDay(date, today)) return 'Aujourd’hui';
  if (sameDay(date, yesterday)) return 'Hier';

  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ── Lecteur HLS ────────────────────────────────────────────
function HlsPlayer({ hlsUrl, streamKey }: { hlsUrl: string; streamKey: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Timestamp unique à chaque montage du composant — force le navigateur à recharger
  // le manifest depuis le serveur plutôt que de servir une version mise en cache.
  const mountTokenRef = useRef(Date.now());

  let pathOnly = hlsUrl;
  try {
    if (hlsUrl && hlsUrl.startsWith('http')) {
      pathOnly = new URL(hlsUrl).pathname;
    }
  } catch {
    // ignore
  }
  const fullUrl = apiUrl(`${pathOnly}?v=${encodeURIComponent(streamKey)}&_=${mountTokenRef.current}`);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const lastTimeRef = useRef<number>(-1);
  const stalledTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let nativeCleanup: (() => void) | null = null;

    // N'affiche l'écran noir de chargement qu'au tout premier lancement
    if (retryCount === 0) {
      setLoading(true);
      setError(false);
    }

    const loadStream = async () => {
      const { default: HlsLib } = await import('hls.js');
      if (disposed) return;

      if (HlsLib.isSupported()) {
        hls = new HlsLib({
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 6,
          maxBufferLength: 8,
        });

        hls.loadSource(fullUrl);
        hls.attachMedia(video);

        hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
          if (disposed) return;
          setLoading(false);
          video.play().catch(() => {});
        });

        hls.on(HlsLib.Events.ERROR, (_event, data: ErrorData) => {
          if (data.fatal) {
            if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
              hls?.startLoad(); // Récupère le segment manquant sans couper la vidéo
            } else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
              hls?.recoverMediaError(); // Répare les pixels corrompus sans couper la vidéo
            } else {
              if (!disposed) {
                hls?.destroy();
                hls = null;
                retryTimer = setTimeout(() => {
                  if (!disposed) setRetryCount(c => c + 1);
                }, 1500);
              }
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = fullUrl;
        const onMeta = () => {
          if (disposed) return;
          setLoading(false);
          video.play().catch(() => {});
        };
        const onErr = () => {
          if (!disposed) {
            setError(true);
            setLoading(false);
            retryTimer = setTimeout(() => {
              if (!disposed) setRetryCount(c => c + 1);
            }, 3000);
          }
        };
        video.addEventListener('loadedmetadata', onMeta);
        video.addEventListener('error', onErr);
        nativeCleanup = () => {
          video.removeEventListener('loadedmetadata', onMeta);
          video.removeEventListener('error', onErr);
        };
      }
    };

    void loadStream();

    // Détection de gel : si currentTime n'avance plus depuis 5s → caméra non alimentée
    stalledTimerRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;
      if (video.currentTime === lastTimeRef.current && video.currentTime > 0) {
        setStalled(true);
      } else {
        setStalled(false);
        lastTimeRef.current = video.currentTime;
      }
    }, 5000);

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (stalledTimerRef.current) clearInterval(stalledTimerRef.current);
      if (hls) hls.destroy();
      nativeCleanup?.();
    };
  }, [fullUrl, retryCount]);

  function retry() {
    setStalled(false);
    setError(false);
    lastTimeRef.current = -1;
    setRetryCount(c => c + 1);
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {loading && !error && !stalled && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', color: '#fff', zIndex: 10, fontSize: '14px' }}>
          <span className="cam-rec-dot-anim" style={{ marginRight: '10px', backgroundColor: '#fff' }} /> Connexion au flux...
        </div>
      )}
      {(error || stalled) && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', color: '#fff', zIndex: 10, fontSize: '14px', gap: '10px' }}>
          <div style={{ fontSize: '28px', opacity: 0.6 }}>⊘</div>
          <div style={{ fontWeight: 600 }}>{stalled ? 'Caméra non alimentée' : 'Flux indisponible'}</div>
          <div style={{ opacity: 0.5, fontSize: '12px' }}>{stalled ? 'Signal perdu — vérifiez l\'alimentation' : 'Le flux ne répond plus'}</div>
          <button type="button" className="ui-confirm-btn" onClick={retry}>
            Réessayer
          </button>
        </div>
      )}
      <video ref={videoRef} autoPlay muted playsInline preload="auto" className="cam-video" style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }} />
    </div>
  );
}

// ── Lecteur avec bascule WebRTC → HLS ────────────────────────
function CameraPlayer({ cam, streamKey }: { cam: Camera; streamKey: string }) {
  const [useHls, setUseHls] = useState(false);
  const handleError = useCallback(() => setUseHls(true), []);

  if (useHls || !cam.hlsUrl) {
    return <HlsPlayer hlsUrl={cam.hlsUrl!} streamKey={streamKey} />;
  }
  return <WebRTCPlayer cameraId={cam.id} onError={handleError} />;
}

// ── Écran offline ─────────────────────────────────────────
function OfflineScreen({ status }: { status: Camera["status"] }) {
  const text = status === 'paused' ? 'EN PAUSE'
             : status === 'reconnecting' ? 'RECONNEXION...'
             : status === 'watching' ? 'EN VEILLE — CLIQUEZ POUR VOIR'
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

// ── Écran démarrage ───────────────────────────────────────
function StartingScreen() {
  return (
    <div className="cam-screen">
      <div className="cam-offline">
        <div className="cam-offline-icon" style={{ fontSize: '20px', opacity: 0.7 }}>
          <span className="cam-rec-dot-anim" style={{ display: 'inline-block', marginRight: '8px', backgroundColor: '#fff' }} />
        </div>
        <p className="cam-offline-text">DÉMARRAGE DU FLUX...</p>
      </div>
      <div className="cam-corner cam-corner--tl" />
      <div className="cam-corner cam-corner--tr" />
      <div className="cam-corner cam-corner--bl" />
      <div className="cam-corner cam-corner--br" />
    </div>
  );
}

// ── Écran caméra ──────────────────────────────────────────
function CameraScreen({ cam, time, openKey = 0 }: { cam: Camera; time: Date; openKey?: number }) {
  return (
    <div className="cam-screen">
      {cam.status === 'running' && cam.hlsUrl
        ? <CameraPlayer cam={cam} streamKey={`${cam.id}:${cam.startedAt || 'pending'}:${cam.status}:${openKey}`} />
        : cam.status === 'running'
          ? <StartingScreen />
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
    watching:     { label: "EN VEILLE",   cls: "cam-badge--offline"   },
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
        : cam.status === 'watching'
          ? 'En veille — cliquez pour démarrer'
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
      {(status === 'stopped' || status === 'watching') &&
        <button type="button" className="cam-btn-start" onClick={() => onAction(id, 'start')}>▶ START</button>}
      {status === 'running'      && <button className="cam-btn-pause" onClick={() => onAction(id, 'pause')}>⏸ PAUSE</button>}
      {status === 'paused'       && <button className="cam-btn-start" onClick={() => onAction(id, 'resume')}>▶ REPRENDRE</button>}
      {(status === 'running' || status === 'paused' || status === 'reconnecting') &&
        <button className="cam-btn-stop" onClick={() => onAction(id, 'stop')}>⏹ STOP</button>}
    </div>
  );
}

// ── Composant principal ────────────────────────────────────
export default function CameraFeed({ onStatusChange }: {
  onStatusChange?: (summary: CameraStatusSummary) => void;
}) {
  const { config } = useAppConfig();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { showKeyboard, isKeyboardEnabled } = useVirtualKeyboard();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const camerasRef = useRef<Camera[]>([]);
  useEffect(() => { camerasRef.current = cameras; }, [cameras]);
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [focused, setFocused] = useState<number | null>(null);
  const focusOpenCountRef = useRef(0);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRtsp, setNewRtsp] = useState('');
  const [newLoc,  setNewLoc]  = useState('');
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<AddMode>('discover');
  const [searchingNetwork, setSearchingNetwork] = useState(false);
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
  const [historyRetentionDays, setHistoryRetentionDays] = useState(30);
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState<HistorySort>('recent');
  const [historyDeleteError, setHistoryDeleteError] = useState<string | null>(null);
  const [historyDeleteLoading, setHistoryDeleteLoading] = useState(false);
  const [cameraDeleteTarget, setCameraDeleteTarget] = useState<Camera | null>(null);
  const [recordDeleteTarget, setRecordDeleteTarget] = useState<RecordingEntry | null>(null);
  const [purgeHistoryConfirm, setPurgeHistoryConfirm] = useState(false);
  const [motionHistoryDeviceId, setMotionHistoryDeviceId] = useState<string | null>(null);
  const [motionHistoryTitle, setMotionHistoryTitle] = useState('');
  const [motionHistoryRecords, setMotionHistoryRecords] = useState<MotionEventEntry[]>([]);
  const [motionHistoryLoading, setMotionHistoryLoading] = useState(false);
  const [motionHistoryError, setMotionHistoryError] = useState<string | null>(null);
  const [sysInfo, setSysInfo] = useState<{ hasBattery: boolean; isCharging: boolean; percent?: number } | null>(null);

  async function fetchDiscoveries(silent = false) {
    if (!silent) setDiscoveriesLoading(true);
    try {
      const res = await fetch(apiUrl('/api/cameras/discoveries'));
      if (!res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;
        throw new Error(data?.error || `Impossible de charger les caméras détectées (${res.status})`);
      }
      const data = await res.json();
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

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (onStatusChange) {
      const reconnectingCount = cameras.filter(c => c.status === 'reconnecting').length;
      const stoppedCount = cameras.filter(c => c.status === 'stopped').length;
      onStatusChange({ reconnectingCount, stoppedCount });
    }
  }, [cameras, onStatusChange]);

  // Démarre le stream HLS quand l'utilisateur ouvre une caméra en veille ou arrêtée.
  useEffect(() => {
    if (focused === null) return;
    const cam = camerasRef.current.find(c => c.id === focused);
    if (cam?.status === 'watching' || cam?.status === 'stopped') {
      fetch(apiUrl(`/api/cameras/${focused}/start`), { method: 'POST' })
        .then(() => fetchCameras())
        .catch(() => {});
    }
  }, [focused]);

  // Heartbeat toutes les 60s pour maintenir le stream actif tant que la caméra est ouverte.
  useEffect(() => {
    if (focused === null) return;
    const interval = setInterval(() => {
      fetch(apiUrl(`/api/cameras/${focused}/stream/heartbeat`), { method: 'POST' }).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [focused]);

  useEffect(() => {
    if (!showAdd) return;

    let stopped = false;
    setAddMode(config.defaultCameraAddMode === 'manual' ? 'manual' : 'discover');

    fetchDiscoveries();
    const interval = setInterval(() => {
      if (!stopped) {
        fetchDiscoveries(true);
      }
    }, config.cameraDiscoveryIntervalSeconds * 1000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [showAdd, config.defaultCameraAddMode, config.cameraDiscoveryIntervalSeconds]);

  async function fetchCameras() {
    try {
      const res  = await fetch(apiUrl('/api/cameras'));
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setCameras(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    fetchCameras();
    const t = setInterval(fetchCameras, config.cameraRefreshSeconds * 1000);
    return () => clearInterval(t);
  }, [config.cameraRefreshSeconds]);

  // Poll rapide (toutes les 800ms) quand une caméra est en cours de démarrage (running mais pas encore de flux HLS)
  const hasStartingCamera = cameras.some(c => c.status === 'running' && !c.hlsUrl);
  useEffect(() => {
    if (!hasStartingCamera) return;
    const t = setInterval(fetchCameras, 800);
    return () => clearInterval(t);
  }, [hasStartingCamera]);

  useEffect(() => {
    let stopped = false;
    async function fetchSysInfo() {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(apiUrl('/api/system/info'), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!stopped) {
          setSysInfo({ hasBattery: data.battery.hasBattery, isCharging: data.battery.isCharging, percent: data.battery.percent });
        }
      } catch {
        // ignore
      }
    }
    fetchSysInfo();
    const t = setInterval(fetchSysInfo, 5000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  async function handleAction(id: number, action: "start" | "pause" | "resume" | "stop") {
    try {
      await fetch(apiUrl(`/api/cameras/${id}/${action}`), { method: 'POST' });
      fetchCameras();
    } catch { /* ignore */ }
  }

  async function searchNetworkCameras() {
    setSearchingNetwork(true);
    setDiscoverMessage('Recherche des caméras en cours…');
    try {
      const res = await fetch(apiUrl('/api/cameras/discover'));
      if (!res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;
        throw new Error(data?.error || `Erreur de recherche sur le réseau (${res.status})`);
      }
      const data = await res.json();
      await fetchDiscoveries(true);
      if (Array.isArray(data.results) && data.results.length > 0) {
        setDiscoverMessage(`${data.results.length} caméra(s) détectée(s).`);
      } else {
        setDiscoverMessage('Aucune caméra trouvée pour le moment.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setDiscoverMessage(message);
    } finally {
      setSearchingNetwork(false);
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
      if (!res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const errData = isJson ? await res.json() : null;
        throw new Error(errData?.error || `Impossible d’ajouter la caméra (${res.status})`);
      }
      const data = await res.json();
      setCameras(prev => [...prev, data]);
      setNewName(''); setNewRtsp(''); setNewLoc(''); setDiscoverMessage(null); setShowAdd(false);
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
    setDiscoverMessage(`Caméra détectée sélectionnée : ${device.name} (${device.host})`);
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
      if (!res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;
        throw new Error(data?.error || `Impossible d’ajouter la caméra détectée (${res.status})`);
      }
      const data = await res.json();
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

  async function confirmDeleteCamera() {
    if (!cameraDeleteTarget) return;
    await fetch(apiUrl(`/api/cameras/${cameraDeleteTarget.id}`), { method: 'DELETE' });
    setCameras(prev => prev.filter(c => c.id !== cameraDeleteTarget.id));
    if (focused === cameraDeleteTarget.id) setFocused(null);
    if (historyCameraId === cameraDeleteTarget.id) closeHistory();
    setCameraDeleteTarget(null);
  }

  async function loadCameraHistory(id: number) {
    setHistoryCameraId(id);
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryDeleteError(null);
    setHistorySearch('');
    setHistorySort('recent');
    try {
      const res = await fetch(apiUrl(`/api/cameras/${id}/history`));
      if (!res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;
        throw new Error(data?.error || `Impossible de charger l’historique (${res.status})`);
      }
      const data = await res.json() as HistoryResponse | RecordingEntry[];
      if (Array.isArray(data)) {
        setHistoryRecords(data);
        setHistoryRetentionDays(30);
      } else {
        setHistoryRecords(Array.isArray(data.recordings) ? data.recordings : []);
        setHistoryRetentionDays(typeof data.retentionDays === 'number' ? data.retentionDays : 30);
      }
    } catch (err: unknown) {
      setHistoryRecords([]);
      setHistoryError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function confirmDeleteRecording() {
    if (historyCameraId === null || !recordDeleteTarget) return;
    setHistoryDeleteLoading(true);
    setHistoryDeleteError(null);
    try {
      const res = await fetch(apiUrl(`/api/cameras/${historyCameraId}/history/${encodeURIComponent(recordDeleteTarget.filename)}`), {
        method: 'DELETE',
      });
      if (!res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;
        throw new Error(data?.error || `Impossible de supprimer l’enregistrement (${res.status})`);
      }
      await res.json();
      setHistoryRecords(prev => prev.filter(entry => entry.filename !== recordDeleteTarget.filename));
      setRecordDeleteTarget(null);
    } catch (err: unknown) {
      setHistoryDeleteError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setHistoryDeleteLoading(false);
    }
  }

  async function confirmDeleteAllHistory() {
    if (historyCameraId === null) return;
    setHistoryDeleteLoading(true);
    setHistoryDeleteError(null);
    try {
      const res = await fetch(apiUrl(`/api/cameras/${historyCameraId}/history`), {
        method: 'DELETE',
      });
      if (!res.ok) {
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;
        throw new Error(data?.error || `Impossible de supprimer tous les enregistrements (${res.status})`);
      }
      await res.json();
      setHistoryRecords([]);
      setPurgeHistoryConfirm(false);
    } catch (err: unknown) {
      setHistoryDeleteError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setHistoryDeleteLoading(false);
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
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;
        throw new Error(data?.error || `Impossible de charger l’historique mouvement (${res.status})`);
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
    setHistoryDeleteError(null);
    setRecordDeleteTarget(null);
    setPurgeHistoryConfirm(false);
  }

  function closeMotionHistory() {
    setMotionHistoryDeviceId(null);
    setMotionHistoryTitle('');
    setMotionHistoryRecords([]);
    setMotionHistoryError(null);
  }

  async function saveCameraName(id: number) {
    if (!editNameValue.trim()) {
      setEditingNameId(null);
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/cameras/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editNameValue.trim() }),
      });
      if (res.ok) {
        setCameras(prev => prev.map(c => c.id === id ? { ...c, name: editNameValue.trim() } : c));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEditingNameId(null);
    }
  }

  const onlineCount = cameras.filter(c => c.status === 'running').length;
  const recCount    = cameras.filter(c => c.recording).length;
  const focusedCam  = cameras.find(c => c.id === focused);
  const canAddManually = Boolean(newName.trim() && newRtsp.trim());

  function toggleAddPanel() {
    setShowAdd((current) => {
      const next = !current;
      if (next) {
            setAddMode((config.defaultCameraAddMode === 'node' || config.defaultCameraAddMode as string === 'scan') ? 'discover' : config.defaultCameraAddMode as AddMode);
      } else {
        setDiscoverMessage(null);
      }
      return next;
    });
  }

  const visibleCameras = config.showOfflineCameras
    ? cameras
    : cameras.filter((camera) => camera.status !== 'stopped' && camera.status !== 'reconnecting');
  const historySearchValue = historySearch.trim().toLowerCase();
  const filteredHistoryRecords = historyRecords.filter((entry) => {
    if (!historySearchValue) return true;
    const haystack = `${entry.filename} ${formatHistoryDate(entry.createdAt)}`.toLowerCase();
    return haystack.includes(historySearchValue);
  });
  const sortedHistoryRecords = [...filteredHistoryRecords].sort((left, right) => {
    if (historySort === 'oldest') return left.createdAt.localeCompare(right.createdAt);
    if (historySort === 'largest') return right.size - left.size || right.createdAt.localeCompare(left.createdAt);
    return right.createdAt.localeCompare(left.createdAt);
  });
  const groupedHistoryRecords = sortedHistoryRecords.reduce<Array<{ label: string; items: RecordingEntry[] }>>((groups, entry) => {
    const label = getHistoryGroupLabel(entry.createdAt);
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.items.push(entry);
      return groups;
    }
    groups.push({ label, items: [entry] });
    return groups;
  }, []);

  return (
    <div className="cam-page" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div className="cam-header">
        <div className="cam-header-left">
          <span className="cam-header-title">CAMÉRAS</span>
          <div className="cam-header-meta">
            <span className="cam-header-stat">EN LIGNE <span>{onlineCount}/{visibleCameras.length}</span></span>
            <span className="cam-header-stat rec">REC <span>{recCount}</span></span>
          </div>
        </div>
        <div className="cam-header-right">
          <span className="cam-clock">{time.toLocaleTimeString('fr-FR')}</span>
          {isAdmin && (
            <button
              type="button"
              className={`panel-action-btn ${showAdd ? 'panel-action-btn--active' : ''}`}
              onClick={toggleAddPanel}
            >
              <span className="panel-action-btn__icon" aria-hidden="true">{showAdd ? '×' : '+'}</span>
              <span>{showAdd ? 'Fermer' : 'Ajouter une camera'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Formulaire ajout */}
      {showAdd && (
        <div className="cam-add-overlay" onClick={() => { setShowAdd(false); setDiscoverMessage(null); }}>
          <div className="cam-add-form" onClick={(event) => event.stopPropagation()}>
            <div className="cam-add-topbar">
              <div>
                <h3 className="cam-add-title">Ajouter une caméra</h3>
              <p className="cam-add-subtitle">Annonces réseau ou flux manuel.</p>
              </div>
              <div className="cam-add-topbar-actions">
                <div className="cam-add-mode-switch">
                  <button
                    type="button"
                    className={`cam-add-mode-btn ${addMode === 'discover' ? 'cam-add-mode-btn--active' : ''}`}
                    onClick={() => setAddMode('discover')}
                  >
                    Annonces Réseau
                  </button>
                  <button
                    type="button"
                    className={`cam-add-mode-btn ${addMode === 'manual' ? 'cam-add-mode-btn--active' : ''}`}
                    onClick={() => setAddMode('manual')}
                  >
                    Manuel
                  </button>
                </div>
                <button type="button" className="cam-add-close-btn" onClick={() => { setShowAdd(false); setDiscoverMessage(null); }}>
                  Fermer
                </button>
              </div>
            </div>

            {addMode === 'discover' && (
              <section className="cam-discovery-panel">
              <div className="cam-discovery-header">
                <div>
          <h3 className="cam-discovery-title">Caméras réseau détectées</h3>
                  <p className="cam-discovery-subtitle">Fenêtre de visibilité : {discoveriesTtlMinutes} min</p>
                </div>
                <button
                  type="button"
                  className="ui-link-btn"
                  onClick={searchNetworkCameras}
                  disabled={searchingNetwork}
                >
          {searchingNetwork ? 'Recherche...' : 'Lancer le scan'}
                </button>
              </div>
              {discoverMessage && (
                <div className="ui-note">
                  <p>{discoverMessage}</p>
                </div>
              )}
      {discoveriesLoading && <p>Chargement des annonces réseau…</p>}
              {discoveriesError && <p className="cam-discovery-error">{discoveriesError}</p>}
              {!discoveriesLoading && !discoveriesError && discoveredDevices.length === 0 && (
        <p className="cam-discovery-empty">Aucune caméra réseau trouvée. Lancez un scan pour remplir la liste.</p>
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
                          className="ui-link-btn"
                          onClick={() => selectDiscoveredDevice(device)}
                        >
                          Préremplir
                        </button>
                        <button
                          type="button"
                          className="ui-confirm-btn"
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
              <input className="ui-input" placeholder="Nom de la caméra"
                value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
      <input className="ui-input" placeholder="Ex: http://192.168.0.213:8889/cam1/ ou rtsp://..."
                value={newRtsp} onChange={e => setNewRtsp(e.target.value)} />
              <input className="ui-input" placeholder="Emplacement (optionnel)"
                value={newLoc} onChange={e => setNewLoc(e.target.value)} />
              {discoverMessage && (
                <div className="ui-note">
                  <p>{discoverMessage}</p>
                </div>
              )}
              <div className="cam-add-actions">
                <button type="button" className="ui-link-btn" onClick={() => setAddMode('discover')}>
                  Retour aux annonces
                </button>
                <button className="ui-confirm-btn" onClick={addCamera} disabled={!canAddManually}>Ajouter</button>
              </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* Vue focus */}
      {focusedCam ? (
        <div className="cam-focus-wrapper" onClick={() => setFocused(null)}>
          <div className={`cam-card cam-card--focus-mode ${focusedCam.recording ? 'cam-card--rec' : ''}`}
            onClick={e => e.stopPropagation()}>
            <div className="cam-card-header">
              <div className="cam-card-title" style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '8px' }}>
                <span className="cam-card-id" style={{ flexShrink: 0 }}>CAM {String(focusedCam.id).padStart(2, '0')}</span>
                {editingNameId === focusedCam.id ? (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      className="ui-input"
                      style={{ padding: '2px 8px', fontSize: '14px', height: 'auto', margin: 0, minHeight: '28px', maxWidth: '200px' }}
                      value={editNameValue}
                      readOnly={isKeyboardEnabled}
                      onFocus={() => showKeyboard(editNameValue, setEditNameValue)}
                      onChange={e => setEditNameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveCameraName(focusedCam.id);
                        if (e.key === 'Escape') setEditingNameId(null);
                      }}
                    />
                    <button type="button" className="ui-confirm-btn" style={{ padding: '2px 8px', minHeight: '28px', fontSize: '12px' }} onClick={() => saveCameraName(focusedCam.id)}>✓</button>
                    <button type="button" className="ui-delete-btn" style={{ padding: '2px 8px', minHeight: '28px', fontSize: '12px' }} onClick={() => setEditingNameId(null)}>✕</button>
                  </div>
                ) : (
                  <span 
                    className="cam-card-name" 
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: isAdmin ? 'pointer' : 'default' }}
                    onClick={e => { if (isAdmin) { e.stopPropagation(); setEditingNameId(focusedCam.id); setEditNameValue(focusedCam.name); } }}
                    title={isAdmin ? "Cliquez pour renommer" : undefined}
                  >
                    {focusedCam.name}
                    {isAdmin && <span style={{ opacity: 0.5, marginLeft: '6px', fontSize: '0.85em' }}>✎</span>}
                  </span>
                )}
                {focusedCam.location && <span className="cam-card-loc" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>· {focusedCam.location}</span>}
              </div>
              <div className="cam-card-actions cam-card-actions--wide-gap" style={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <StatusBadge status={focusedCam.status} />
                <MotionBadge active={focusedCam.motionActive} />
                {focusedCam.nodeDeviceId && (
                  <button className="ui-link-btn" onClick={() => loadMotionHistory(focusedCam.nodeDeviceId!, focusedCam.name)}>
                    Mouvements
                  </button>
                )}
                <button className="cam-card-history" onClick={() => loadCameraHistory(focusedCam.id)}>📁 Historique</button>
                <button className="cam-card-delete" title="Retour à la grille" onClick={(e) => { e.stopPropagation(); setFocused(null); }}>✕</button>
              </div>
            </div>
            <div className="cam-screen-shell cam-screen-shell--focus-mode">
              <CameraScreen cam={focusedCam} time={time} openKey={focusOpenCountRef.current} />
            </div>
            <CameraControls cam={focusedCam} onAction={handleAction} />
          </div>
          {isAdmin && (
            <button 
              type="button" 
              className="cam-focus-exit-btn" 
              style={{ borderColor: 'var(--accent-red-border)', background: 'rgba(248, 113, 113, 0.1)', color: 'var(--accent-red)' }} 
              onClick={(event) => { event.stopPropagation(); setCameraDeleteTarget(focusedCam); }}
            >
              Supprimer la caméra
            </button>
          )}
        </div>
      ) : (
        <div className={`cam-grid cam-grid--${config.cameraCardSize}`} style={{ paddingBottom: '80px' }}>
          {loading && <div className="cam-empty">Chargement des caméras…</div>}
          {!loading && visibleCameras.length === 0 && (
            <div className="cam-empty">
              Aucune caméra configurée — cliquez "+ Ajouter" pour commencer.
            </div>
          )}
          {visibleCameras.map(cam => (
            <div
              key={cam.id}
              className={`cam-card ${cam.recording ? 'cam-card--rec' : ''} ${focused === cam.id ? 'cam-card--focused' : ''}`}
              onClick={() => { focusOpenCountRef.current += 1; setFocused(cam.id); }}
            >
            <div className="cam-card-header">
                <div className="cam-card-title" style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '8px' }}>
                  <span className="cam-card-id" style={{ flexShrink: 0 }}>CAM {String(cam.id).padStart(2, '0')}</span>
                <span className="cam-card-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cam.name}>
                  {cam.name}
                </span>
                </div>
                <div className="cam-card-actions" style={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <StatusBadge status={cam.status} />
                  <MotionBadge active={cam.motionActive} />
                  <button className="cam-card-history"
                    onClick={e => { e.stopPropagation(); loadCameraHistory(cam.id); }}>
                    📁
                  </button>
                {isAdmin && (
                  <button className="cam-card-delete"
                    onClick={e => { e.stopPropagation(); setCameraDeleteTarget(cam); }}>✕</button>
                )}
                </div>
              </div>
              <CameraScreen cam={cam} time={time} />
              <CameraControls cam={cam} onAction={handleAction} />
            </div>
          ))}
        </div>
      )}

      {/* Barre de statut serveur */}
      {sysInfo && (
        <div className="cf-server-bar">
          <span className="cf-server-bar__label">SERVEUR :</span>
          <span className={`cf-server-bar__value ${(!sysInfo.hasBattery || sysInfo.isCharging) ? '' : 'cf-server-bar__value--battery'}`}>
            {(!sysInfo.hasBattery || sysInfo.isCharging) ? '⚡ SUR SECTEUR' : `🔋 SUR BATTERIE ${sysInfo.percent != null ? `(${sysInfo.percent.toFixed(0)}%)` : ''}`}
          </span>
        </div>
      )}

      {historyCameraId !== null && (
        <div className="cam-history-overlay" onClick={closeHistory}>
          <div className="cam-history-panel" onClick={e => e.stopPropagation()}>
            <div className="cam-history-header">
              <div className="cam-history-header-main">
                <span className="cam-history-kicker">GESTIONNAIRE D'ENREGISTREMENTS</span>
                <strong>Caméra {historyCameraId}</strong>
                <div className="cam-history-meta">
                  {historyRecords.length} enregistrement{historyRecords.length > 1 ? 's' : ''}
                </div>
              </div>
              <button className="cam-card-delete" onClick={closeHistory}>✕</button>
            </div>
            <div className="cam-history-toolbar">
              <div className="cam-history-toolbar-main">
                <input
                  className="cam-history-search"
                  type="search"
                  aria-label="Rechercher dans les enregistrements"
                  placeholder="Rechercher un rendu..."
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                />
                <div className="cam-history-sort" aria-label="Trier les enregistrements" role="group">
                  <button
                    type="button"
                    className={`cam-history-sort-btn ${historySort === 'recent' ? 'cam-history-sort-btn--active' : ''}`}
                    onClick={() => setHistorySort('recent')}
                  >
                    Plus récents
                  </button>
                  <button
                    type="button"
                    className={`cam-history-sort-btn ${historySort === 'oldest' ? 'cam-history-sort-btn--active' : ''}`}
                    onClick={() => setHistorySort('oldest')}
                  >
                    Plus anciens
                  </button>
                  <button
                    type="button"
                    className={`cam-history-sort-btn ${historySort === 'largest' ? 'cam-history-sort-btn--active' : ''}`}
                    onClick={() => setHistorySort('largest')}
                  >
                    Plus lourds
                  </button>
                </div>
              </div>
              <div className="cam-history-toolbar-side">
                <span className="cam-history-retention">Suppression auto après {historyRetentionDays} jours</span>
                {isAdmin && (
                  <button
                    type="button"
                    className="ui-delete-btn ui-delete-btn--danger"
                    onClick={() => {
                      setHistoryDeleteError(null);
                      setPurgeHistoryConfirm(true);
                    }}
                    disabled={historyRecords.length === 0 || historyDeleteLoading}
                  >
                    Tout supprimer
                  </button>
                )}
              </div>
            </div>
            {historyLoading && <div className="cam-history-empty-state">Chargement de l’historique…</div>}
            {historyError && <div className="cam-history-error">{historyError}</div>}
            {historyDeleteError && <div className="cam-history-error">{historyDeleteError}</div>}
            {!historyLoading && !historyError && historyRecords.length === 0 && (
              <div className="cam-history-empty-state">Aucun enregistrement disponible pour cette caméra.</div>
            )}
            {!historyLoading && !historyError && historyRecords.length > 0 && groupedHistoryRecords.length === 0 && (
              <div className="cam-history-empty-state">Aucun résultat pour cette recherche.</div>
            )}
            {!historyLoading && groupedHistoryRecords.length > 0 && (
              <div className="cam-history-list">
                {groupedHistoryRecords.map(group => (
                  <section key={group.label} className="cam-history-group">
                    <div className="cam-history-group-title">{group.label}</div>
                    {group.items.map(entry => {
                      const isOfflineSync = entry.filename.startsWith('offline_sync');
                      return (
                      <div key={entry.filename} className={`cam-history-row ${isOfflineSync ? 'cam-history-row--offline' : ''}`}>
                        <div className="cam-history-row-main">
                          <div 
                            className="cam-history-row-icon"
                            style={isOfflineSync ? { backgroundColor: 'var(--accent-amber)', color: '#111' } : {}}
                          >
                            {isOfflineSync ? 'SYNC' : 'REC'}
                          </div>
                          <div className="cam-history-row-copy">
                            <strong style={isOfflineSync ? { color: 'var(--accent-amber)' } : {}}>{entry.filename}</strong>
                            <div className="cam-history-meta">
                              {formatHistoryDate(entry.createdAt)}
                              {isOfflineSync && ' · Récupération après coupure Wi-Fi'}
                            </div>
                            <div className="cam-history-tags">
                              <span className="cam-history-tag">{formatStorageSize(entry.size)}</span>
                              <span className="cam-history-tag">{isOfflineSync ? 'Upload différé' : 'HLS export'}</span>
                            </div>
                          </div>
                        </div>
                        <div className="cam-history-tags">
                          <div className="cam-history-actions">
                            <a
                              href={apiUrl(entry.url)}
                              target="_blank"
                              rel="noreferrer"
                              className="cam-history-link"
                            >
                              Ouvrir
                            </a>
                            <a
                              href={apiUrl(entry.url)}
                              download
                              className="cam-history-link cam-history-link--secondary"
                            >
                              Télécharger
                            </a>
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="cam-history-link cam-history-link--danger"
                                  onClick={() => {
                                    setHistoryDeleteError(null);
                                    setRecordDeleteTarget(entry);
                                  }}
                                >
                                  Supprimer
                                </button>
                              )}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </section>
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
              <div className="cam-history-header-main">
                <span className="cam-history-kicker">JOURNAL DE MOUVEMENT</span>
                <strong>{motionHistoryTitle}</strong>
                <div className="cam-history-meta">
                  {motionHistoryRecords.length} evenement{motionHistoryRecords.length > 1 ? 's' : ''}
                </div>
              </div>
              <button className="cam-card-delete" onClick={closeMotionHistory}>✕</button>
            </div>
            {motionHistoryLoading && <div className="cam-history-empty-state">Chargement de l’historique mouvement…</div>}
            {motionHistoryError && <div className="cam-history-error">{motionHistoryError}</div>}
            {!motionHistoryLoading && !motionHistoryError && motionHistoryRecords.length === 0 && (
              <div className="cam-history-empty-state">Aucun mouvement enregistré pour ce nœud.</div>
            )}
            {!motionHistoryLoading && motionHistoryRecords.length > 0 && (
              <div className="cam-history-list">
                {motionHistoryRecords.map(entry => (
                  <div key={entry.id} className={`cam-history-row${entry.offline_recording ? ' cam-history-row--offline' : ''}`}>
                    <div className="cam-history-row-main">
                      <div className={`cam-history-row-icon ${entry.motion ? '' : 'cam-history-row-icon--muted'}`}>{entry.motion ? 'ON' : 'OFF'}</div>
                      <div className="cam-history-row-copy">
                        <strong>{entry.motion ? 'Mouvement détecté' : 'État inactif'}</strong>
                        {entry.offline_recording && (
                          <span className="cam-history-offline-badge">HORS LIGNE</span>
                        )}
                        <div className="cam-history-meta">
                          {formatHistoryDate(entry.detected_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {cameraDeleteTarget && (
        <div className="settings-modal-overlay" onClick={() => setCameraDeleteTarget(null)}>
          <div className="settings-modal-card settings-modal-card--danger" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal-title settings-modal-title--danger">SUPPRIMER LA CAMÉRA</div>
            <div className="settings-modal-warning settings-modal-warning--danger">
              La caméra {cameraDeleteTarget.name} sera retirée de la grille et son flux sera arrêté.
            </div>
            <div className="settings-modal-warning">
              Les enregistrements déjà présents restent disponibles tant qu’ils ne sont pas supprimés ou purgés automatiquement après {historyRetentionDays} jours.
            </div>
            <div className="settings-modal-actions">
              <button className="ui-link-btn" onClick={() => setCameraDeleteTarget(null)}>Annuler</button>
              <button className="ui-delete-btn ui-delete-btn--danger" onClick={confirmDeleteCamera}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {recordDeleteTarget && (
        <div className="settings-modal-overlay" onClick={() => !historyDeleteLoading && setRecordDeleteTarget(null)}>
          <div className="settings-modal-card settings-modal-card--danger" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal-title settings-modal-title--danger">SUPPRIMER L’ENREGISTREMENT</div>
            <div className="settings-modal-warning settings-modal-warning--danger">
              {recordDeleteTarget.filename} sera définitivement supprimé.
            </div>
            <div className="settings-modal-warning">
              Cette action retire uniquement ce rendu. La purge automatique reste fixée à {historyRetentionDays} jours.
            </div>
            {historyDeleteError && <div className="settings-msg settings-msg--error">⚠ {historyDeleteError}</div>}
            <div className="settings-modal-actions">
              <button className="ui-link-btn" onClick={() => setRecordDeleteTarget(null)} disabled={historyDeleteLoading}>Annuler</button>
              <button className="ui-delete-btn ui-delete-btn--danger" onClick={confirmDeleteRecording} disabled={historyDeleteLoading}>
                {historyDeleteLoading ? 'Suppression...' : 'Supprimer ce rendu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {purgeHistoryConfirm && (
        <div className="settings-modal-overlay" onClick={() => !historyDeleteLoading && setPurgeHistoryConfirm(false)}>
          <div className="settings-modal-card settings-modal-card--danger" onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal-title settings-modal-title--danger">SUPPRIMER TOUT L’HISTORIQUE</div>
            <div className="settings-modal-warning settings-modal-warning--danger">
              Tous les rendus de cette caméra seront supprimés définitivement.
            </div>
            <div className="settings-modal-warning">
              Cette purge manuelle s’ajoute au nettoyage automatique quotidien des fichiers de plus de {historyRetentionDays} jours.
            </div>
            {historyDeleteError && <div className="settings-msg settings-msg--error">⚠ {historyDeleteError}</div>}
            <div className="settings-modal-actions">
              <button className="ui-link-btn" onClick={() => setPurgeHistoryConfirm(false)} disabled={historyDeleteLoading}>Annuler</button>
              <button className="ui-delete-btn ui-delete-btn--danger" onClick={confirmDeleteAllHistory} disabled={historyDeleteLoading}>
                {historyDeleteLoading ? 'Suppression...' : 'Tout supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}