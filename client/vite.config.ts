/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// CSP injectée au build : connect-src/media-src limités au backend (VITE_API_URL).
// Les directives non supportées en <meta> (frame-ancestors…) sont posées par vercel.json.
function cspMetaPlugin(apiUrl: string): Plugin {
  const api = apiUrl ? new URL(apiUrl) : null
  const apiOrigin = api ? api.origin : ''
  const wsOrigin = api ? `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}` : ''
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `media-src 'self' blob: ${apiOrigin}`.trim(),
    `connect-src 'self' ${apiOrigin} ${wsOrigin}`.trim(),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  return {
    name: 'sentys-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="no-referrer" />`,
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = String(env.VITE_API_URL || '').trim()

  return {
    plugins: [
      react(),
      cspMetaPlugin(apiUrl),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['pwa-icon.svg', 'pwa-maskable.svg', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png'],
        manifest: {
          id: '/',
          name: 'Sentys Surveillance',
          short_name: 'Sentys',
          description: 'Surveillance locale de la maison avec cameras et supervision systeme.',
          theme_color: '#08111d',
          background_color: '#08111d',
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
          orientation: 'any',
          scope: '/',
          start_url: '/',
          lang: 'fr',
          icons: [
            {
              src: '/pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff2}'],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        react: path.resolve('./node_modules/react'),
        'react-dom': path.resolve('./node_modules/react-dom'),
      },
    },
    server: {
      proxy: {
        '/api': 'http://localhost:4000',
        '/auth': 'http://localhost:4000',
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
    },
  }
})
