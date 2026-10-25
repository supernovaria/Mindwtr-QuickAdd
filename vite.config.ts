// Renderer build (also what `npm run dev:web` serves). Main and preload are
// built by scripts/build.mjs with their own inline configs.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname, 'src/renderer');

export default defineConfig({
  root,
  base: './',
  oxc: { jsx: { runtime: 'automatic' } },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [import.meta.dirname] },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'out/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 2000,
  },
});
