import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../lib/api';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePush() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
      setIsSupported(true);
      setPermission(Notification.permission);

      navigator.serviceWorker.ready.then(registration => {
        registration.pushManager.getSubscription().then(subscription => {
          setIsSubscribed(!!subscription);
          setIsSubscribing(false);
        });
      });
    } else {
      setIsSubscribing(false);
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported || isSubscribed) return;

    setIsSubscribing(true);
    setError(null);

    try {
      const currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== 'granted') {
        throw new Error('Permission de notification refusée.');
      }

      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error('Clé VAPID publique manquante côté client.');
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      await fetch(apiUrl('/api/push/subscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      });

      setIsSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'abonnement.');
      setIsSubscribed(false);
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, isSubscribed]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !isSubscribed) return;

    setIsSubscribing(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(apiUrl('/api/push/unsubscribe'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du désabonnement.');
    } finally {
      setIsSubscribing(false);
    }
  }, [isSupported, isSubscribed]);

  return { isSupported, isSubscribed, isSubscribing, permission, error, subscribe, unsubscribe };
}