import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { buildInfo } from './build-info'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_APP_BASE_PATH || '/'
  return {
    base,
    define: buildInfo(env),
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/icon-192.svg', 'icons/icon-512.svg'],
        manifest: {
          name: env.VITE_APP_NAME || 'TaskStride',
          short_name: env.VITE_APP_NAME || 'TaskStride',
          description: 'A focused workspace for Google Tasks.',
          theme_color: '#5b5bd6',
          background_color: '#f6f7f9',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          navigateFallback: 'index.html',
          // These navigations must reach the network: /cdn-cgi/ is where Cloudflare Access sets
          // its session cookie after a sign-in, and /api/ serves the authorization backend.
          // Answering them with the cached app shell would lock the edge session out for good.
          navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//]
        }
      })
    ]
  }
})
