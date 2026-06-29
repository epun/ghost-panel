/**
 * Vitest config — unit tests for Ghost Panel's framework-agnostic logic.
 *
 *   npm test            → run the suite once
 *   npm run test:watch  → watch mode
 *   npm run coverage    → run with a v8 coverage report
 *
 * Uses a standalone config (not vite.config.js) so the dev-only
 * ghost-panel Vite plugin and library-build options don't apply to tests.
 * jsdom supplies the DOM/localStorage globals the modules touch.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'text-summary', 'html'],
      include: ['*.js', 'adapters/**/*.js'],
      exclude: [
        'vite.config.js',
        'vitest.config.js',
        'vite-plugin-ghost-panel.js',
        'example.js',
        'demo-switcher.js',
        'dev-mode.js',
      ],
    },
  },
});
