/// <reference lib="WebWorker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// self.__WB_MANIFEST est une variable qui sera injectée par Vite/Workbox
// et qui contient la liste de tous vos fichiers à mettre en cache.
precacheAndRoute(self.__WB_MANIFEST)

cleanupOutdatedCaches()

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// --- GESTION DES NOTIFICATIONS PUSH ---
// (Le contenu de votre ancien fichier sw-push-handler.ts)

self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('[SW] Push event but no data');
    return;
  }

  try {
    const data = event.data.json();
    const title = data.title || 'Nouvelle Notification';
    const options: NotificationOptions = {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192x192.png',
      badge: data.badge || '/icons/icon-96x96.png',
      data: {
        url: data.data?.url || '/',
      },
      actions: [
        { action: 'explore', title: 'Voir' },
        { action: 'close', title: 'Ignorer' },
      ],
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    console.error('[SW] Error processing push event', e);
  }
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;

  notification.close();

  if (action === 'close') {
    return;
  }

  const urlToOpen = new URL(notification.data.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});