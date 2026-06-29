/**
 * In-tool modal dialogs — replaces the browser's native `confirm()`,
 * `alert()`, and `prompt()` with versions that look like the rest of
 * the panel. The native dialogs jar against the dark glassy aesthetic
 * and on macOS Safari they freeze the page until dismissed, so even a
 * destructive-action prompt feels heavy.
 *
 * Public API:
 *
 *   await confirmDialog('Delete "Cube" from the scene?', {
 *     confirmLabel: 'Delete',
 *     danger: true,
 *   })   // → boolean
 *
 *   await alertDialog('No bindable targets in the scene.')
 *
 *   await promptDialog('Rename track:', { defaultValue: 'cube.x' })
 *   // → string | null
 *
 * Each call returns a Promise that resolves once the user picks an
 * option, presses Escape (cancel), or clicks the backdrop. Multiple
 * concurrent calls stack — newer modals appear on top of older ones.
 */

import { icons } from './icons.js';
import { log } from './log.js';

let host = null;
function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'dui-modal-host';
  document.body.appendChild(host);
  return host;
}

/** Internal: build the backdrop + card and wire close paths. */
function buildModal({ title, body, footer, danger }) {
  const root = ensureHost();
  // a11y: remember what had focus (the trigger) so we can restore it on close.
  const prevFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'dui-modal-backdrop';
  const card = document.createElement('div');
  card.className = 'dui-modal' + (danger ? ' dui-modal-danger' : '');
  // a11y: expose as a modal dialog with an accessible name from the title so
  // screen readers announce it and treat content behind it as inert.
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const accName = String(title || '').replace(/<[^>]*>/g, '').trim();
  if (accName) card.setAttribute('aria-label', accName);
  card.innerHTML = `
    <div class="dui-modal-title">${title || ''}</div>
    <div class="dui-modal-body"></div>
    <div class="dui-modal-footer"></div>
  `;
  card.querySelector('.dui-modal-body').appendChild(body);
  card.querySelector('.dui-modal-footer').appendChild(footer);
  backdrop.appendChild(card);
  root.appendChild(backdrop);

  // a11y: trap Tab focus inside the dialog while it's open. The listener lives
  // on the card, so it's garbage-collected with the card on teardown.
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = [...card.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter(el => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Animate in on the next frame so the CSS transition fires.
  requestAnimationFrame(() => backdrop.classList.add('dui-modal-visible'));
  return { backdrop, card, prevFocus };
}

/** Internal: tear down the modal with a quick fade, restoring focus. */
function teardown(backdrop, prevFocus) {
  backdrop.classList.remove('dui-modal-visible');
  setTimeout(() => backdrop.remove(), 160);
  // a11y: return focus to the element that opened the dialog (the trigger).
  if (prevFocus && typeof prevFocus.focus === 'function') {
    try { prevFocus.focus(); } catch (e) { log.debug('modal', 'focus failed:', e); }
  }
}

/**
 * Yes / No (or custom-label) confirmation. Resolves to `true` on
 * confirm, `false` on cancel / Esc / backdrop click.
 */
export function confirmDialog(message, opts = {}) {
  const {
    title = 'Are you sure?',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    danger = false,
  } = opts;

  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'dui-modal-message';
    body.textContent = message;

    const footer = document.createElement('div');
    footer.className = 'dui-modal-actions';
    footer.innerHTML = `
      <button class="dui-modal-btn dui-modal-cancel" type="button">${cancelLabel}</button>
      <button class="dui-modal-btn dui-modal-confirm ${danger ? 'dui-modal-btn-danger' : 'dui-modal-btn-primary'}" type="button">${confirmLabel}</button>
    `;
    const { backdrop, prevFocus } = buildModal({ title, body, footer, danger });

    const cancelBtn  = footer.querySelector('.dui-modal-cancel');
    const confirmBtn = footer.querySelector('.dui-modal-confirm');

    function close(v) {
      teardown(backdrop, prevFocus);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter')  { e.preventDefault(); close(true); }
    }
    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
    document.addEventListener('keydown', onKey);
    // Focus the confirm button by default so Enter just-works. Wrapped
    // in a microtask so the button is mounted before focus tries to land.
    setTimeout(() => confirmBtn.focus(), 0);
  });
}

/** One-button informational modal. Resolves when the user acknowledges. */
export function alertDialog(message, opts = {}) {
  const {
    title = 'Heads up',
    label = 'OK',
    icon = icons.warning,
  } = opts;

  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'dui-modal-message';
    body.innerHTML = icon ? `<span class="dui-modal-icon">${icon}</span><span></span>` : '<span></span>';
    body.querySelector('span:last-child').textContent = message;

    const footer = document.createElement('div');
    footer.className = 'dui-modal-actions';
    footer.innerHTML = `<button class="dui-modal-btn dui-modal-btn-primary" type="button">${label}</button>`;
    const { backdrop, prevFocus } = buildModal({ title, body, footer });

    const btn = footer.querySelector('button');
    function close() {
      teardown(backdrop, prevFocus);
      document.removeEventListener('keydown', onKey);
      resolve();
    }
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); }
    }
    btn.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => btn.focus(), 0);
  });
}

/**
 * Text-input prompt. Resolves to the typed string on commit, `null` on
 * cancel / Esc / backdrop click. Pre-fills with `defaultValue` and
 * selects-all so the user can replace it with a single keystroke.
 */
export function promptDialog(message, opts = {}) {
  const {
    title = message,
    defaultValue = '',
    placeholder = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
  } = opts;

  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'dui-modal-message';
    body.innerHTML = `
      <input class="dui-modal-input" type="text" />
    `;
    const input = body.querySelector('input');
    input.value = defaultValue;
    input.placeholder = placeholder;

    const footer = document.createElement('div');
    footer.className = 'dui-modal-actions';
    footer.innerHTML = `
      <button class="dui-modal-btn dui-modal-cancel" type="button">${cancelLabel}</button>
      <button class="dui-modal-btn dui-modal-confirm dui-modal-btn-primary" type="button">${confirmLabel}</button>
    `;
    const { backdrop, prevFocus } = buildModal({ title, body, footer });

    function close(v) {
      teardown(backdrop, prevFocus);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(input.value); }
    });
    footer.querySelector('.dui-modal-cancel').addEventListener('click', () => close(null));
    footer.querySelector('.dui-modal-confirm').addEventListener('click', () => close(input.value));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}
