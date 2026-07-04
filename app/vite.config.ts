import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE is set by the Pages deploy workflow to "/<repo-name>/".
// VITE_USE_POLLING is set by the Docker dev service (docker-compose.yml) so HMR still
// fires across the macOS ↔ container filesystem boundary.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    host: true, // bind 0.0.0.0 so the dev server is reachable from a container / the LAN
    port: 5173,
    watch: process.env.VITE_USE_POLLING ? { usePolling: true } : undefined,
  },
});
