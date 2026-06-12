/**
 * Toast notifications — a single "dynamic island"-style pill at the bottom
 * center of the screen. Used for transient feedback on workflow-agnostic
 * actions (copy / paste / undo / redo) where there's no inline target to
 * highlight.
 *
 *   showToast('Copied circle.01');
 *   showToast('Pasted', { icon: icons.clipboard });   // pass an SVG string from icons.js
 *
 * Multiple rapid calls reuse the same pill — the text just updates and
 * the auto-dismiss timer resets, so spammed actions don't stack vertically.
 */

const DEFAULT_DURATION_MS = 1600;

let host = null;
let pill = null;
let dismissTimer = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'dui-toast-host';
  pill = document.createElement('div');
  pill.className = 'dui-toast';
  host.appendChild(pill);
  document.body.appendChild(host);
  return host;
}

/**
 * Show a toast. `opts.icon` (string) prefixes the message.
 * `opts.duration` overrides the default auto-dismiss timeout.
 */
export function showToast(message, opts = {}) {
  ensureHost();
  const icon = opts.icon ? `<span class="dui-toast-icon">${opts.icon}</span>` : '';
  pill.innerHTML = `${icon}<span class="dui-toast-text">${message}</span>`;
  pill.classList.add('dui-toast-visible');
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    pill.classList.remove('dui-toast-visible');
  }, opts.duration ?? DEFAULT_DURATION_MS);
}

export function hideToast() {
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  if (pill) pill.classList.remove('dui-toast-visible');
}
