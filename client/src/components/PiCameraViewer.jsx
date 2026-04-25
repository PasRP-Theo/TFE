import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { usePiCamera } from '../hooks/usePiCamera.js';
import { piCameraApi } from '../lib/piCameraApi.js';

export default function PiCameraViewer({ streamName = 'cam1' }) {
  const { isStreaming, error } = usePiCamera(streamName);
  const videoRef = useRef(null);
  const [hlsLoading, setHlsLoading] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isStreaming) return;

    const streamUrl = piCameraApi.buildStreamUrl(streamName);
    let hls = null;
    
    setHlsLoading(true); // ERR_3 — Affiche le chargement

    // ERR_3 — HLS.js pour gérer le flux m3u8 sur Chrome/Firefox
    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setHlsLoading(false);
        video.play().catch(e => console.warn("Autoplay bloqué par le navigateur", e));
      });
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          setHlsLoading(false);
          console.error("Erreur HLS fatale:", data);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Fallback natif pour Safari
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setHlsLoading(false);
        video.play().catch(e => console.warn("Autoplay bloqué", e));
      });
    } else {
      setHlsLoading(false);
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [isStreaming, streamName]);

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
      
      {/* Affichage des erreurs détectées par le hook */}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', color: '#ff4d4f', padding: '20px', textAlign: 'center', zIndex: 10 }}>
          <p style={{ fontWeight: 'bold' }}>⚠️ {error}</p>
        </div>
      )}

      {/* Message de chargement pendant l'init HLS */}
      {hlsLoading && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', zIndex: 5 }}>
          <p>⏳ Chargement du flux HLS...</p>
        </div>
      )}

      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: (error || (!isStreaming && !hlsLoading)) ? 'none' : 'block' }}
      />
    </div>
  );
}