import { useEffect, useRef, useState } from 'react';
import { apiUrl, apiFetch } from '../lib/api';

interface WebRTCPlayerProps {
  cameraId: number;
  onError: () => void;
}

export function WebRTCPlayer({ cameraId, onError }: WebRTCPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef    = useRef<RTCPeerConnection | null>(null);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    let disposed = false;

    async function connect() {
      // statut go2rtc
      try {
        const statusRes = await apiFetch(apiUrl('/api/webrtc/status'));
        if (statusRes.ok) {
          const { available } = await statusRes.json();
          if (!available) { if (!disposed) onError(); return; }
        }
      } catch { /* ignore, on tente quand même */ }

      if (disposed) return;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });
      pcRef.current = pc;

      // recvonly
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = ({ streams }) => {
        if (videoRef.current && !disposed && streams[0]) {
          videoRef.current.srcObject = streams[0];
          videoRef.current.play().catch(() => {});
          setConnecting(false);
        }
      };

      // déco→HLS
      pc.onconnectionstatechange = () => {
        if (disposed) return;
        const state = pc.connectionState;
        if (state === 'failed') {
          onError();
        } else if (state === 'disconnected') {
          setTimeout(() => {
            if (!disposed && pc.connectionState === 'disconnected') onError();
          }, 3000);
        }
      };

      // offre SDP
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // gathering ICE
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const timeout = setTimeout(resolve, 1000);
        pc.addEventListener('icegatheringstatechange', function handler() {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            pc.removeEventListener('icegatheringstatechange', handler);
            resolve();
          }
        });
      });

      if (disposed) { pc.close(); return; }

      // envoi SDP
      const res = await apiFetch(apiUrl(`/api/webrtc/${cameraId}`), {
        method:  'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body:    pc.localDescription!.sdp,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // SDP answer
      const answerSdp = await res.text();
      if (disposed) { pc.close(); return; }

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    }

    connect().catch((err) => {
      if (!disposed) {
        console.warn(`[WebRTC cam${cameraId}] Bascule HLS :`, err.message);
        onError();
      }
    });

    return () => {
      disposed = true;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [cameraId, onError]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {connecting && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', color: '#fff', zIndex: 10, fontSize: '14px',
        }}>
          <span className="cam-rec-dot-anim" style={{ marginRight: '10px', backgroundColor: '#fff' }} />
          WebRTC...
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="cam-video"
        style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
      />
    </div>
  );
}
