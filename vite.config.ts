import { defineConfig } from 'vite';

// Spotify only accepts loopback redirect URIs as an IP literal (127.0.0.1),
// not "localhost", so the dev server binds there explicitly.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
