/// <reference lib="WebWorker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

cleanupOutdatedCaches()

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const data = event.data.json()
    const title = data.title || 'Sentys'
    const options = {
      body: data.body || '',
      icon: data.icon || '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url: data.data?.url || '/' },
      actions: [
        { action: 'open', title: 'Voir' },
        { action: 'close', title: 'Ignorer' },
      ],
    } as NotificationOptions
    event.waitUntil(self.registration.showNotification(title, options))
  } catch (e) {
    console.error('[SW] push parse error', e)
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'close') return

  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})