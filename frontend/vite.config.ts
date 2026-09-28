import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'
import type { ProxyOptions } from 'vite'

// `frontendRoute` is where the site serves the app. The plugin proxies the
// bench while you develop, and builds into the app's public and www folders.
// frappeProxy is disabled here because its default proxy picks the backend
// site both from the Host header AND from an `X-Frappe-Site-Name` header the
// frappe-ui client sets to `window.location.hostname` (frappe.app resolves
// the site from that header first — see apps/frappe/frappe/app.py). Either
// one only matches when the browser reaches vite as "local.com"; accessing
// it as "localhost" makes Frappe look for a (nonexistent) "localhost" site
// and return 404. We pin both to the real site below instead.
const proxy: Record<string, ProxyOptions> = {
  '^/(desk|app|login|api|assets|files|private)': {
    target: 'http://local.com:8000',
    changeOrigin: true,
    ws: true,
    configure(proxyServer) {
      proxyServer.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('X-Frappe-Site-Name', 'local.com')
      })
    },
  },
}

export default defineConfig({
  plugins: [frappeui({ frontendRoute: '/dms', frappeProxy: false }), vue()],
  server: {
    port: 8080,
    allowedHosts: ['local.com', 'localhost'],
    proxy,
  },
})
