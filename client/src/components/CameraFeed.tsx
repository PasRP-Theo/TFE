import { useState, useEffect, useRef } from "react";
import type Hls from "hls.js";
import type { ErrorData } from "hls.js";
import { apiUrl } from "../lib/api";
import { useAppConfig } from "../hooks/useAppConfig";
import { useAuth } from "../hooks/useAuth";

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

interface ScannedCamera {
  ip: string;
  name: string;
  hlsUrl: string;
  rtspUrl: string;
}

type AddMode = 'node' | 'scan' | 'discover' | 'manual';
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
  const { config } = useAppConfig();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScannedCamera[]>([]);

  async function fetchDiscoveries(silent = false) {
    if (!silent) setDiscoveriesLoading(true);
    try {
      const res = await fetch(apiUrl('/api/cameras/discoveries'));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de charger les caméras détectées');
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
    setAddMode(config.defaultCameraAddMode);

    fetchDiscoveries();
    fetchCameraNodes();
    const interval = setInterval(() => {
      if (!stopped) {
        fetchDiscoveries(true);
        fetchCameraNodes(true);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de recherche sur le réseau');
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

  async function scanNetwork() {
    setIsScanning(true);
    setScanResults([]);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl('/api/cameras/scan'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setScanResults(data);
      }
    } catch (err) {
      console.error("Erreur de scan:", err);
    } finally {
      setIsScanning(false);
    }
  }

  async function addScannedCamera(cam: ScannedCamera) {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl('/api/cameras'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ name: `Pi-${cam.name}-${cam.ip.split('.').pop()}`, rtsp_url: cam.rtspUrl, location: cam.ip })
      });
      const data = await res.json();
      setCameras(prev => [...prev, data]);
      setScanResults(prev => prev.filter(c => c.rtspUrl !== cam.rtspUrl));
    } catch {
      // ignore
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
        const data = await res.json();
        throw new Error(data.error || 'Impossible de charger l’historique');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de supprimer l’enregistrement');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de supprimer tous les enregistrements');
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

  const onlineCount = cameras.filter(c => c.status === 'running').length;
  const recCount    = cameras.filter(c => c.recording).length;
  const focusedCam  = cameras.find(c => c.id === focused);
  const canAddManually = Boolean(newName.trim() && newRtsp.trim());

  function toggleAddPanel() {
    setShowAdd((current) => {
      const next = !current;
      if (next) {
        setAddMode(config.defaultCameraAddMode);
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
            <>
            <button
              type="button"
              className={`panel-action-btn ${showAdd ? 'panel-action-btn--active' : ''}`}
              onClick={toggleAddPanel}
            >
              <span className="panel-action-btn__icon" aria-hidden="true">{showAdd ? '×' : '+'}</span>
              <span>{showAdd ? 'Fermer' : 'Ajouter une camera'}</span>
            </button>
            </>
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
                <p className="cam-add-subtitle">Noeud Raspberry Pi, ESP32-CAM ou flux manuel.</p>
              </div>
              <div className="cam-add-topbar-actions">
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
                    className={`cam-add-mode-btn ${addMode === 'scan' ? 'cam-add-mode-btn--active' : ''}`}
                    onClick={() => {
                      setAddMode('scan');
                      if (!isScanning && scanResults.length === 0) scanNetwork();
                    }}
                  >
                    Scan MediaMTX
                  </button>
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

            {addMode === 'scan' && (
              <section className="cam-discovery-panel">
                <div className="cam-discovery-header">
                  <div>
                    <h3 className="cam-discovery-title">Caméras MediaMTX détectées</h3>
                    <p className="cam-discovery-subtitle">Scan local rapide des flux RTSP/HLS ouverts.</p>
                  </div>
                  <button
                    type="button"
                    className="sensor-link-btn"
                    onClick={scanNetwork}
                    disabled={isScanning}
                  >
                    {isScanning ? 'Actualisation...' : 'Actualiser'}
                  </button>
                </div>
                {isScanning && <p>Scan du réseau en cours (attente ~4s)…</p>}
                {!isScanning && scanResults.length === 0 && (
                  <p className="cam-discovery-empty">Aucune caméra MediaMTX trouvée. Cliquez sur Actualiser pour scanner le réseau.</p>
                )}
                {scanResults.length > 0 && (
                  <ul className="cam-discovery-list">
                    {scanResults.map((cam, idx) => (
                      <li key={idx} className="cam-discovery-item">
                        <div className="cam-discovery-item-head">
                          <strong>{cam.name}</strong>
                          <span className="cam-discovery-source cam-discovery-source--probe">MediaMTX Pi Zero</span>
                        </div>
                        <div className="cam-discovery-meta">{cam.ip}</div>
                        <div className="cam-discovery-meta">Vu le {new Date().toLocaleString('fr-FR')}</div>
                        <div className="cam-inline-actions">
                          <StatusBadge status="running" />
                          <button
                            type="button"
                            className="sensor-confirm-btn"
                            onClick={() => addScannedCamera(cam)}
                          >
                            Connecter
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
          <h3 className="cam-discovery-title">Caméras réseau détectées</h3>
                  <p className="cam-discovery-subtitle">Fenêtre de visibilité : {discoveriesTtlMinutes} min</p>
                </div>
                <button
                  type="button"
                  className="sensor-link-btn"
                  onClick={searchNetworkCameras}
                  disabled={searchingNetwork}
                >
          {searchingNetwork ? 'Recherche...' : 'Lancer le scan'}
                </button>
              </div>
              {discoverMessage && (
                <div className="sensor-note">
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
      <input className="sensor-input" placeholder="Ex: http://192.168.0.213:8889/cam1/ ou rtsp://..."
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
        </div>
      )}

      {/* Vue focus */}
      {focusedCam ? (
        <div className="cam-focus-wrapper" onClick={() => setFocused(null)}>
          <div className={`cam-card cam-card--focus-mode ${focusedCam.recording ? 'cam-card--rec' : ''}`}
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
              {isAdmin && (
                <button className="cam-card-delete" onClick={() => setCameraDeleteTarget(focusedCam)}>✕</button>
              )}
              </div>
            </div>
            <div className="cam-screen-shell cam-screen-shell--focus-mode">
              <CameraScreen cam={focusedCam} time={time} />
            </div>
            <CameraControls cam={focusedCam} onAction={handleAction} />
          </div>
          <button type="button" className="cam-focus-exit-btn" onClick={(event) => { event.stopPropagation(); setFocused(null); }}>
            Retour à la grille
          </button>
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

      {/* Barre de diagnostic LED (Dynamique & Fixe) */}
      {(() => {
        const hasOffline = cameras.some(c => c.status === 'stopped');
        const hasInstable = !navigator.onLine || cameras.some(c => c.status === 'reconnecting' || c.status === 'paused');
        const ledColor = hasOffline ? 'var(--accent-red)' : hasInstable ? 'var(--accent-amber)' : '#22c55e';
        const ledStatus = hasOffline ? 'ROUGE : PANNE' : hasInstable ? 'ORANGE : INSTABLE' : 'VERT : OK';
        const ledDesc = hasOffline ? 'Une ou plusieurs caméras sont injoignables.' : hasInstable ? 'Réseau instable ou reconnexion en cours.' : 'Toutes les caméras fonctionnent normalement.';
        
        return (
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '16px', fontSize: '14px', color: 'var(--text-secondary)', boxShadow: '0 -4px 20px rgba(0,0,0,0.3)' }}>
            <span style={{ color: 'var(--text-muted)' }}><strong>DIAGNOSTIC CAMÉRAS :</strong></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: ledColor }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: ledColor, boxShadow: `0 0 10px ${ledColor}` }} /> 
              {ledStatus}
            </span>
            <span>— {ledDesc}</span>

            {sysInfo && (
              <>
                <span style={{ color: 'var(--border)', margin: '0 4px' }}>|</span>
                <span style={{ color: 'var(--text-muted)' }}><strong>SERVEUR :</strong></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: (!sysInfo.hasBattery || sysInfo.isCharging) ? 'inherit' : 'var(--accent-amber)' }}>
                  {(!sysInfo.hasBattery || sysInfo.isCharging) ? '⚡ SUR SECTEUR' : `🔋 SUR BATTERIE ${sysInfo.percent != null ? `(${sysInfo.percent.toFixed(0)}%)` : ''}`}
                </span>
              </>
            )}
          </div>
        );
      })()}

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
                    className="sensor-delete-btn sensor-delete-btn--danger"
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
                    {group.items.map(entry => (
                      <div key={entry.filename} className="cam-history-row">
                        <div className="cam-history-row-main">
                          <div className="cam-history-row-icon">REC</div>
                          <div className="cam-history-row-copy">
                            <strong>{entry.filename}</strong>
                            <div className="cam-history-meta">
                              {formatHistoryDate(entry.createdAt)}
                            </div>
                            <div className="cam-history-tags">
                              <span className="cam-history-tag">{formatStorageSize(entry.size)}</span>
                              <span className="cam-history-tag">HLS export</span>
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
                    ))}
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
                  <div key={entry.id} className="cam-history-row">
                    <div className="cam-history-row-main">
                      <div className={`cam-history-row-icon ${entry.motion ? '' : 'cam-history-row-icon--muted'}`}>{entry.motion ? 'ON' : 'OFF'}</div>
                      <div className="cam-history-row-copy">
                        <strong>{entry.motion ? 'Mouvement détecté' : 'État inactif'}</strong>
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
              <button className="sensor-link-btn" onClick={() => setCameraDeleteTarget(null)}>Annuler</button>
              <button className="sensor-delete-btn sensor-delete-btn--danger" onClick={confirmDeleteCamera}>Supprimer</button>
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
              <button className="sensor-link-btn" onClick={() => setRecordDeleteTarget(null)} disabled={historyDeleteLoading}>Annuler</button>
              <button className="sensor-delete-btn sensor-delete-btn--danger" onClick={confirmDeleteRecording} disabled={historyDeleteLoading}>
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
              <button className="sensor-link-btn" onClick={() => setPurgeHistoryConfirm(false)} disabled={historyDeleteLoading}>Annuler</button>
              <button className="sensor-delete-btn sensor-delete-btn--danger" onClick={confirmDeleteAllHistory} disabled={historyDeleteLoading}>
                {historyDeleteLoading ? 'Suppression...' : 'Tout supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}