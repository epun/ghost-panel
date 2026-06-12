/**
 * Demo-environment switcher — a small bottom-left toolbar that hops between
 * the bundled 3D / 2D / web demos. THIS FILE IS DEMO-ONLY: it lives outside
 * `index.js` and is never imported by `createGhostPanel`, so end-user projects
 * that ship Ghost Panel never pay any byte for it.
 *
 *   import { mountDemoSwitcher } from './demo-switcher.js';
 *   mountDemoSwitcher();
 *
 * The mount call also self-gates: if the page is being served from a known
 * production environment (Vite PROD flag, NODE_ENV=production, or an opt-in
 * `window.__DEBUG_UI_PRODUCTION__` boolean), it becomes a no-op.
 */

import { isDev } from './dev-mode.js';
import { svg } from './icons.js';

// Same Phosphor-style glyphs the rest of the tool uses, sized down to
// fit the small bottom chip. 3D = cube, 2D = circle, Web = rectangle,
// Grid = 4-square grid — at a glance the user knows which scene model
// each demo runs.
const DEMOS = [
  { id: '3d',   label: '3D',   href: './ghost-panel-demo.html',      icon: svg('cube',      { size: 13 }) },
  { id: '2d',   label: '2D',   href: './ghost-panel-2d-demo.html',   icon: svg('circle',    { size: 13 }) },
  { id: 'web',  label: 'Web',  href: './ghost-panel-web-demo.html',  icon: svg('rectangle', { size: 13 }) },
  { id: 'grid', label: 'Grid', href: './ghost-panel-grid-demo.html', icon: svg('gridFour',  { size: 13 }) },
];

export function mountDemoSwitcher(opts = {}) {
  if (!isDev()) return null;   // stripped in production
  if (typeof document === 'undefined') return null;

  // Identify which demo is currently loaded — used to highlight the chip.
  const path = location.pathname.split('/').pop();
  const active = DEMOS.find(d => d.href.endsWith(path))?.id;

  const host = document.createElement('div');
  host.className = 'dui-demo-switcher';
  host.dataset.devOnly = 'demo-switcher';
  host.innerHTML = DEMOS.map(d => `
    <a class="dui-demo-switcher-btn${d.id === active ? ' dui-active' : ''}"
       href="${d.href}" data-id="${d.id}"
       data-tooltip="Open the ${d.label} demo">
      <span class="dui-demo-switcher-icon">${d.icon}</span>
      <span class="dui-demo-switcher-label">${d.label}</span>
    </a>
  `).join('');

  // Local stylesheet — keeps the switcher self-contained so it works even
  // before / without Ghost Panel's main stylesheet being injected.
  const style = document.createElement('style');
  style.dataset.devOnly = 'demo-switcher';
  style.textContent = `
    .dui-demo-switcher {
      position: fixed; bottom: 16px; left: 16px; z-index: 99990;
      display: inline-flex; gap: 2px; padding: 4px;
      background: hsl(0 0% 0% / 0.75);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid hsl(0 0% 100% / 0.12);
      border-radius: 999px;
      box-shadow: 0 1px 0 hsl(0 0% 100% / 0.08) inset, 0 8px 24px hsl(0 0% 0% / 0.4);
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      user-select: none;
    }
    .dui-demo-switcher-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      color: hsl(0 0% 100% / 0.72);
      font-size: 12px; font-weight: 500; letter-spacing: -0.01em;
      text-decoration: none;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .dui-demo-switcher-btn:hover {
      background: hsl(0 0% 100% / 0.08);
      color: hsl(0 0% 100%);
    }
    .dui-demo-switcher-btn.dui-active {
      background: hsl(0 0% 100% / 0.18);
      color: hsl(0 0% 100%);
    }
    .dui-demo-switcher-icon { display: inline-flex; align-items: center; line-height: 0; }
    .dui-demo-switcher-icon svg { display: block; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(host);
  return {
    element: host,
    dispose() { host.remove(); style.remove(); },
  };
}
