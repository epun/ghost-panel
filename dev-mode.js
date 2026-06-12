/**
 * Dev-mode detection. Returns false when the host is plausibly a production
 * build, so debug-only surfaces (the demo switcher, debug overlays, etc.)
 * can self-strip without the user having to wire anything.
 *
 * Detection order (first hit wins):
 *   1. `window.__DEBUG_UI_PRODUCTION__ === true`           — explicit opt-in
 *   2. `import.meta.env.PROD === true` (Vite / esbuild)
 *   3. `process.env.NODE_ENV === 'production'` (Webpack)
 *
 * If none of the above fire, we assume the page is in development.
 *
 * For users who want to fully tree-shake Ghost Panel out of their production
 * bundle, wrap the createGhostPanel call in `initIfDev()` instead — that lazily
 * dynamic-imports the rest of the library only in dev:
 *
 *   import { initIfDev } from 'ghost-panel/dev-mode';
 *   initIfDev(async () => {
 *     const { createGhostPanel } = await import('Ghost Panel');
 *     createGhostPanel({ ... });
 *   });
 */

export function isDev() {
  // Explicit user override — useful when the bundler doesn't expose env flags
  // (e.g. plain script tag deployments).
  if (typeof window !== 'undefined' && window.__DEBUG_UI_PRODUCTION__ === true) {
    return false;
  }
  // Vite / esbuild / Rollup-with-define style: import.meta.env.PROD is
  // statically replaced at build time, so the if-branch is dead-code
  // eliminated in the final bundle.
  try {
    if (import.meta?.env?.PROD === true) return false;
  } catch {}
  // Webpack / Node / CRA style.
  try {
    if (typeof process !== 'undefined'
        && process.env?.NODE_ENV === 'production') return false;
  } catch {}
  return true;
}

/**
 * Run `fn` only when the host is in dev mode. Returns whatever `fn` returns
 * (or null in production). Accepts sync or async functions.
 *
 *   initIfDev(() => createGhostPanel({ title: 'My Tool' }));
 */
export function initIfDev(fn) {
  if (!isDev()) return null;
  try { return fn(); } catch (e) { console.warn('[Ghost Panel] init failed:', e); return null; }
}
