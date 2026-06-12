/**
 * Vite library-mode build.
 *
 *   npm run build  → dist/ghost-panel.js     (ESM, importable as a module)
 *                 → dist/ghost-panel.cjs    (CommonJS, for Node tooling)
 *                 → dist/ghost-panel.umd.js (UMD/IIFE, drop-in <script>)
 *
 * `three` and its `examples/jsm/*` subpaths are marked external so the
 * host project supplies them — keeps versions in sync and shaves ~600 KB
 * off the bundle.
 */
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { ghostPanelPlugin } from './vite-plugin-ghost-panel.js';

export default defineConfig({
  plugins: [ghostPanelPlugin()],
  build: {
    target: 'es2020',
    sourcemap: true,
    minify: false,           // unminified so consumers can inspect / step through
    lib: {
      entry: resolve(__dirname, 'index.js'),
      name: 'GhostPanel',
      formats: ['es', 'cjs', 'umd'],
      fileName: (format) => {
        if (format === 'es')  return 'ghost-panel.js';
        if (format === 'cjs') return 'ghost-panel.cjs';
        return 'ghost-panel.umd.js';
      },
    },
    rollupOptions: {
      // Host owns three. Everything under `three/` (examples/jsm/loaders/*,
      // examples/jsm/controls/*) resolves to whatever the host has installed,
      // so loader-dependent factories (GLB, PLY) work without duplication.
      external: [
        'three',
        /^three\//,
      ],
      output: {
        globals: { three: 'THREE' },
      },
    },
  },
});
