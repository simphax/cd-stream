import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Spotify only accepts loopback redirect URIs as an IP literal (127.0.0.1),
// not "localhost", so the dev server binds there explicitly.
export default defineConfig(({ mode }) => {
  // `--mode artifact`: a demo-only build that scripts/inline-artifact.mjs
  // turns into one self-contained HTML file (fonts from Google Fonts).
  const artifact = mode === 'artifact';
  return {
    base: './',
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    resolve: artifact
      ? { alias: [{ find: /^\.\/fonts$/, replacement: fileURLToPath(new URL('./src/fonts.google.ts', import.meta.url)) }] }
      : undefined,
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1200,
      ...(artifact && {
        outDir: 'dist-artifact',
        assetsInlineLimit: 100_000_000,
        cssCodeSplit: false,
        modulePreload: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }),
    },
  };
});
