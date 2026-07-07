/**
 * Multi-page site build — the public demo site behind ghostpanel.design.
 *
 *   npm run build:site  → dist-site/website/index.html   (landing page)
 *                       → dist-site/ghost-panel-*.html    (4 runnable demos)
 *
 * Unlike the library build (`vite.config.js`), `three` is bundled here so
 * the demo pages run as plain static files — no import map, no dev server.
 * That's what makes them deployable; served straight from the repo root they
 * 404 because they're Vite entry points, not standalone HTML.
 */
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  // Nothing to copy verbatim; assets are referenced from the HTML and hashed.
  publicDir: false,
  build: {
    outDir: 'dist-site',
    emptyOutDir: true,
    // esnext: the demos use top-level await (dynamic import of the switcher).
    target: 'esnext',
    rollupOptions: {
      input: {
        landing:  resolve(__dirname, 'website/index.html'),
        demo3d:   resolve(__dirname, 'ghost-panel-demo.html'),
        demo2d:   resolve(__dirname, 'ghost-panel-2d-demo.html'),
        demoWeb:  resolve(__dirname, 'ghost-panel-web-demo.html'),
        demoGrid: resolve(__dirname, 'ghost-panel-grid-demo.html'),
      },
    },
  },
});
