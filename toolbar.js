/**
 * Toolbar — a thin floating bar anchored to one edge of the viewport for
 * controls that don't belong inside a side panel. Same theming as Panel
 * (shadcn / Liquid Glass / Blender) via the standard CSS tokens.
 *
 *   const tb = new Toolbar({ side: 'top' });
 *   tb.addButton('Play', { onClick: () => animate.play(), tooltip: 'Play' });
 *   tb.addDivider();
 *   tb.addText('Frame: 0', 'frame-display');
 *
 * Sides:
 *   'top' / 'bottom' — horizontal bar, full-width
 *   'left' / 'right' — vertical bar, full-height
 *   'floating'       — free-floating, draggable
 */

import { initTooltips } from './tooltip.js';

export class Toolbar {
  constructor(opts = {}) {
    const {
      side = 'top',
      visible = true,
      align = 'center', // 'start' | 'center' | 'end' — alignment along the bar
      offset = 16,      // px from the viewport edge
      compact = true,   // smaller spacing
    } = opts;
    this.side = side;
    this.align = align;
    this.items = [];
    initTooltips();
    this._build({ offset, compact });
    if (visible) this.show();
  }

  _build({ offset, compact }) {
    const el = document.createElement('div');
    el.className = `dui-toolbar dui-toolbar-${this.side}`;
    if (compact) el.classList.add('dui-toolbar-compact');
    el.style[this.side === 'top' || this.side === 'bottom' ? this.side : 'top'] = `${offset}px`;
    el.dataset.align = this.align;
    this.element = el;
    // Stop pointer events from bubbling to canvas/orbit
    ['pointerdown','pointermove','pointerup','wheel','click','dblclick']
      .forEach(evt => el.addEventListener(evt, e => e.stopPropagation()));
    document.body.appendChild(el);
  }

  show() { this.element.classList.add('dui-visible'); }
  hide() { this.element.classList.remove('dui-visible'); }
  toggle() { this.element.classList.toggle('dui-visible'); }

  /**
   * Add an icon button to the toolbar.
   *   opts: { icon, label, onClick, tooltip, active }
   */
  addButton(opts = {}) {
    const btn = document.createElement('button');
    btn.className = 'dui-toolbar-btn';
    if (opts.tooltip) btn.dataset.tooltip = opts.tooltip;
    btn.innerHTML = opts.icon
      ? `<span class="dui-toolbar-icon">${opts.icon}</span>${opts.label ? `<span class="dui-toolbar-label">${opts.label}</span>` : ''}`
      : `<span class="dui-toolbar-label">${opts.label || ''}</span>`;
    if (opts.active) btn.classList.add('dui-active');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onClick?.(btn);
    });
    this.element.appendChild(btn);
    this.items.push(btn);
    return {
      element: btn,
      setActive: (v) => btn.classList.toggle('dui-active', !!v),
      setLabel: (l) => {
        const labelEl = btn.querySelector('.dui-toolbar-label');
        if (labelEl) labelEl.textContent = l;
      },
      setIcon: (i) => {
        const iconEl = btn.querySelector('.dui-toolbar-icon');
        if (iconEl) iconEl.innerHTML = i;
      },
      dispose: () => btn.remove(),
    };
  }

  /** Group of buttons that behave like a radio (one-at-a-time active). */
  addGroup(items = []) {
    const wrap = document.createElement('div');
    wrap.className = 'dui-toolbar-group';
    this.element.appendChild(wrap);
    const handles = items.map((it) => {
      const btn = document.createElement('button');
      btn.className = 'dui-toolbar-btn';
      if (it.tooltip) btn.dataset.tooltip = it.tooltip;
      btn.innerHTML = it.icon
        ? `<span class="dui-toolbar-icon">${it.icon}</span>${it.label ? `<span class="dui-toolbar-label">${it.label}</span>` : ''}`
        : `<span class="dui-toolbar-label">${it.label || ''}</span>`;
      if (it.active) btn.classList.add('dui-active');
      wrap.appendChild(btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handles.forEach(h => h.element.classList.remove('dui-active'));
        btn.classList.add('dui-active');
        it.onClick?.(btn);
      });
      return { element: btn };
    });
    return {
      element: wrap,
      buttons: handles,
      dispose: () => wrap.remove(),
    };
  }

  /** Plain text label / status display. */
  addText(text, id) {
    const el = document.createElement('span');
    el.className = 'dui-toolbar-text';
    if (id) el.dataset.id = id;
    el.textContent = text;
    this.element.appendChild(el);
    return {
      element: el,
      setText: (t) => { el.textContent = t; },
      dispose: () => el.remove(),
    };
  }

  /** Visual divider between groups of items. */
  addDivider() {
    const el = document.createElement('span');
    el.className = 'dui-toolbar-divider';
    this.element.appendChild(el);
    return { element: el, dispose: () => el.remove() };
  }

  /** Drop any DOM element in (escape hatch). */
  addRaw(el) {
    this.element.appendChild(el);
    return { element: el, dispose: () => el.remove() };
  }

  dispose() { this.element.remove(); }
}
