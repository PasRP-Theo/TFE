/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// This is a placeholder for the manifest injected by vite-plugin-pwa
const manifest = self.__WB_MANIFEST;

self.addEventListener('push', (event) => {
  if (!event.data) {
    console.error('Push event but no data');
    return;
  }

  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: data.icon || '/pwa-192.png',
        badge: '/pwa-192.png',
        vibrate: [200, 100, 200],
        data: data.data,
        actions: [
          { action: 'view', title: 'Voir' },
          { action: 'dismiss', title: 'Ignorer' }
        ]
      })
    );
  } catch (e) {
    console.error('Error parsing push data', e);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view' || !event.action) {
    self.clients.openWindow('/');
  }
});