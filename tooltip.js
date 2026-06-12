/**
 * Long-hover tooltip system for Ghost Panel.
 *
 * Any element with a `data-tooltip="..."` attribute gets a styled tooltip
 * after 500ms of hover. One shared tooltip element handles all of them,
 * positioned smartly to stay on-screen.
 *
 * Initialized once globally (idempotent). Auto-binds new elements via a
 * MutationObserver on the document so dynamically-added controls work too.
 */
let initialized = false;
let tipEl;
let timer = null;
let currentTarget = null;
const SHOW_DELAY = 500;
const HIDE_DELAY = 100;

function ensureTooltip() {
  if (initialized) return;
  initialized = true;

  tipEl = document.createElement('div');
  tipEl.className = 'dui-tooltip';
  document.body.appendChild(tipEl);

  // Delegated hover handlers — work for any current/future element
  document.addEventListener('pointerover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target || target === currentTarget) return;
    currentTarget = target;
    clearTimeout(timer);
    timer = setTimeout(() => show(target), SHOW_DELAY);
  });

  document.addEventListener('pointerout', (e) => {
    if (!currentTarget) return;
    const to = e.relatedTarget;
    if (to && currentTarget.contains(to)) return; // moved within same element
    clearTimeout(timer);
    timer = setTimeout(hide, HIDE_DELAY);
    currentTarget = null;
  });

  // Hide on pointerdown so click-through feels natural
  document.addEventListener('pointerdown', hide, { capture: true });
  // Hide on scroll/resize so position never drifts
  window.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('resize', hide);

  // Accessibility: mirror every `data-tooltip` into an `aria-label` for
  // icon-only controls — now, and as new controls mount. Ghost Panel rebuilds
  // folders/inspector frequently and injects most tooltips via innerHTML
  // templates (not attachTooltip), so a MutationObserver is the only way to
  // catch them centrally. The callback is cheap: it only walks added nodes and
  // reacts to data-tooltip changes (attributeFilter), never the whole tree.
  scanAndBridge(document.body);
  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === 'attributes') { bridgeAriaLabel(rec.target); continue; }
      rec.addedNodes.forEach(scanAndBridge);
    }
  });
  mo.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['data-tooltip'],
  });
}

function show(target) {
  const text = target.dataset.tooltip;
  if (!text) return;
  tipEl.textContent = text;
  tipEl.classList.add('dui-tooltip-visible');

  // Position below the target by default, flip above if overflowing.
  // Try to align by anchor side: panels' header buttons go below their own panel.
  const r = target.getBoundingClientRect();
  const tipR = tipEl.getBoundingClientRect();
  const margin = 6;

  let top  = r.bottom + margin;
  let left = r.left + r.width / 2 - tipR.width / 2;

  // Flip above if would overflow viewport
  if (top + tipR.height + 8 > window.innerHeight) {
    top = r.top - tipR.height - margin;
  }
  // Clamp horizontally
  left = Math.max(8, Math.min(left, window.innerWidth - tipR.width - 8));

  tipEl.style.top = `${top}px`;
  tipEl.style.left = `${left}px`;
}

function hide() {
  if (tipEl) tipEl.classList.remove('dui-tooltip-visible');
  clearTimeout(timer);
}

/**
 * Bridge `data-tooltip` → `aria-label` for icon-only controls (accessibility).
 *
 * Ghost Panel labels its icon buttons with a custom visual tooltip, which gives
 * assistive tech NO accessible name. For any tooltip'd control that lacks an
 * accessible name (no visible text, no aria-label/aria-labelledby/title), mirror
 * the tooltip text into `aria-label` so screen-reader users get the same label
 * sighted users get on hover. We never overwrite an author-provided name and
 * never label an element that already has visible text — per the a11y guidance
 * "don't add aria when native semantics already solve the problem". A marker
 * (`data-dui-auto-label`) records the labels WE own, so controls that swap their
 * tooltip at runtime (play↔pause, expand↔collapse) keep their aria-label in sync
 * without us ever clobbering a label the author set deliberately.
 */
function bridgeAriaLabel(el) {
  if (!el || el.nodeType !== 1) return;
  const text = el.dataset?.tooltip;
  if (!text) return;
  const ours = el.hasAttribute('data-dui-auto-label');
  if (!ours) {
    if (el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        el.getAttribute('title')) return;       // author already named it
    if ((el.textContent || '').trim()) return;   // visible text = native name
  }
  el.setAttribute('aria-label', text);
  el.setAttribute('data-dui-auto-label', '');
}

/** Bridge an element and any tooltip'd descendants. */
function scanAndBridge(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches?.('[data-tooltip]')) bridgeAriaLabel(root);
  root.querySelectorAll?.('[data-tooltip]')?.forEach(bridgeAriaLabel);
}

/** Initialize the global tooltip system. Safe to call multiple times. */
export function initTooltips() {
  ensureTooltip();
}

/** Attach a tooltip to any element programmatically. */
export function attachTooltip(el, text) {
  el.dataset.tooltip = text;
  ensureTooltip();
  bridgeAriaLabel(el);
}
