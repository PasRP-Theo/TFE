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