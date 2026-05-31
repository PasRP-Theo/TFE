import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../components/AuthProvider';

export function usePushNotifications() {
  const { token } = useAuth();

  useEffect(() => {
    // permission push
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    if (!token) return;

    // socket
    const socket = io(import.meta.env.VITE_API_URL || 'http://192.168.0.47:4000', {
      auth: { token }
    });

    socket.on('connect', () => {
      console.log('[SOCKET] Connecté au serveur en temps réel !');
    });

    // alerte
    socket.on('new_alert', (alert) => {
      console.log('🚨 NOUVELLE ALERTE :', alert);
      
      // notification OS
      if ("Notification" in window && Notification.permission === 'granted') {
        new Notification(alert.title, {
          body: "Une vérification du panneau de contrôle est requise.",
          icon: '/favicon.ico', // Pointe vers le logo de ton app
          requireInteraction: true // Garde la notification visible
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);
}