import { useEffect, useRef } from 'react';
import { io as ioClient, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './api';
import { getAccessToken, refreshSession } from './session';

// UNE seule connexion temps réel (Socket.IO) pour toute l'application, partagée par les pages
// qui s'y abonnent, ouverte au premier abonné et fermée au dernier (déconnexion comprise).

let socket: Socket | null = null;
let subscribers = 0;

function acquire(): Socket {
  if (!socket) {
    socket = ioClient(API_BASE_URL || window.location.origin, {
      // jeton relu à chaque (re)connexion : le serveur coupe la socket à l'expiration du jeton
      auth: cb => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
    });
    const current = socket;
    current.on('disconnect', reason => {
      if (reason === 'io server disconnect') {
        refreshSession().then(data => { if (data && socket === current) current.connect(); });
      }
    });
  }
  subscribers += 1;
  return socket;
}

function release() {
  subscribers -= 1;
  if (subscribers <= 0 && socket) {
    socket.disconnect();
    socket = null;
    subscribers = 0;
  }
}

/**
 * Abonnement à un événement temps réel du serveur (« camera_state », « new_alert »…).
 * Les rafales d'événements sont regroupées (debounceMs) : un seul rafraîchissement par rafale.
 */
export function useRealtimeEvent(
  event: string,
  handler: () => void,
  { enabled = true, debounceMs = 150 }: { enabled?: boolean; debounceMs?: number } = {},
) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });

  useEffect(() => {
    if (!enabled) return;
    const client = acquire();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const listener = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; handlerRef.current(); }, debounceMs);
    };
    client.on(event, listener);
    return () => {
      if (timer !== null) clearTimeout(timer);
      client.off(event, listener);
      release();
    };
  }, [event, enabled, debounceMs]);
}
