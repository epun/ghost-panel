/**
 * Vitest config — unit tests run in a jsdom environment so modules that touch
 * `localStorage`, `document`, `URL.createObjectURL`, etc. work without a real
 * browser. Kept separate from `vite.config.js` so the library build and its
 * dev-only Ghost Panel plugin don't load during test runs.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      include: [
        'undo-stack.js',
        'object-manager.js',
        'prompt-analytics.js',
        'skills.js',
        'exports.js',
      ],
    },
  },
});
