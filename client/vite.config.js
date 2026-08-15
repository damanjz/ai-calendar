import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// The API port is shared with the server via API_PORT so the proxy target and
// the server's bind port can never drift apart. PORT is deliberately NOT used
// here: in some environments it is injected to mean "the port for THIS app",
// which would point the proxy at the client itself.
const apiPort = process.env.API_PORT || 3000

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CLIENT_PORT || 5173),
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      '/health': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
