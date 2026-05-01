import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/api';

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
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });
      pcRef.current = pc;

      // On ne veut que recevoir (pas envoyer de flux depuis le navigateur)
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      // Quand une piste vidéo arrive, on l'affiche
      pc.ontrack = ({ streams }) => {
        if (videoRef.current && !disposed && streams[0]) {
          videoRef.current.srcObject = streams[0];
          videoRef.current.play().catch(() => {});
          setConnecting(false);
        }
      };

      // Création de l'offre SDP locale
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Attente de la fin du gathering ICE (max 3s)
      // go2rtc a besoin des candidats ICE pour établir la connexion
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const timeout = setTimeout(resolve, 3000);
        pc.addEventListener('icegatheringstatechange', function handler() {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            pc.removeEventListener('icegatheringstatechange', handler);
            resolve();
          }
        });
      });

      if (disposed) { pc.close(); return; }

      // Envoi de l'offre SDP au serveur Node.js qui la proxie vers go2rtc
      const res = await fetch(apiUrl(`/api/webrtc/${cameraId}`), {
        method:  'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body:    pc.localDescription!.sdp,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // go2rtc répond avec la SDP answer (ICE candidates inclus)
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
