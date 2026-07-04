import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE is set by the Pages deploy workflow to "/<repo-name>/".
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
});
