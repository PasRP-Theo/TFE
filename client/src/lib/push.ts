import { apiUrl } from './api';

// Utilitaire pour convertir la clé VAPID base64 en Uint8Array (requis par l'API Push)
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

export async function isPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}

export async function subscribeUserToPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const token = localStorage.getItem('token');

  // 1. Récupérer la clé publique VAPID depuis le serveur
  const vapidRes = await fetch(apiUrl('/api/notifications/vapid-public-key'), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!vapidRes.ok) {
    throw new Error("Impossible de récupérer la clé VAPID. Les notifications push sont-elles configurées sur le serveur ?");
  }

  const { publicKey } = await vapidRes.json();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);

  // 2. S'abonner auprès du service push du navigateur
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  // 3. Envoyer la souscription à notre serveur
  const subRes = await fetch(apiUrl('/api/notifications/subscribe'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ subscription }),
  });

  if (!subRes.ok) {
    // En cas d'échec serveur, on annule la souscription locale
    await subscription.unsubscribe();
    throw new Error("Impossible d'enregistrer l'abonnement sur le serveur.");
  }
}

export async function unsubscribeUserFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    const token = localStorage.getItem('token');

    // 1. Informer le serveur de la désinscription
    await fetch(apiUrl('/api/notifications/unsubscribe'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ subscription }),
    });

    // 2. Se désabonner localement
    await subscription.unsubscribe();
  }
}