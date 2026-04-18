import { useEffect } from 'react';
import { io } from 'socket.io-client';
// Note : Assure-toi d'importer ton hook useAuth correctement selon ton architecture
import { useAuth } from '../components/AuthProvider'; 

export function usePushNotifications() {
  const { token } = useAuth();

  useEffect(() => {
    // Demander la permission au navigateur pour les notifications push
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    if (!token) return;

    // 1. Connexion au serveur WebSocket
    const socket = io(import.meta.env.VITE_API_URL || 'http://192.168.0.47:4000', {
      auth: { token }
    });

    socket.on('connect', () => {
      console.log('[SOCKET] Connecté au serveur en temps réel !');
    });

    // 2. Écoute des nouvelles alertes backend
    socket.on('new_alert', (alert) => {
      console.log('🚨 NOUVELLE ALERTE :', alert);
      
      // 3. Déclencher une notification native de l'OS
      if ("Notification" in window && Notification.permission === 'granted') {
        new Notification(alert.title, {
          body: "Une vérification du panneau de contrôle est requise.",
          icon: '/favicon.ico', // Pointe vers le logo de ton app
          requireInteraction: true // Garde la notification visible
        });
      }
    });

    // Nettoyage de la socket si le composant est démonté ou si le token change
    return () => {
      socket.disconnect();
    };
  }, [token]);
}