/// <reference lib="WebWorker" />

export type {}; // Fix for "Cannot compile under '--isolatedModules'"
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('push', (event) => {
  if (!event.data) {
    console.log('Push event but no data');
    return;
  }

  try {
    const data = event.data.json();
    const title = data.title || 'Nouvelle Notification';
    const options: NotificationOptions & { actions: NotificationAction[] } = {
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
    console.error('Error processing push event', e);
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
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
    })
  );
});