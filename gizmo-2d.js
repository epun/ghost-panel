/**
 * Canvas / DOM gizmo — the 2D counterpart of Three.js `TransformControls`.
 *
 * Shows an overlay with translate / rotate / scale handles pinned to the
 * currently-selected 2D-shape object (Canvas2D circle, web-element adapter,
 * or any duck-type with `x` / `y` / `rotation?` / `width?`/`height?`/`radius?`).
 *
 * Handles:
 *   • X-axis arrow (red)     drag → translate along X
 *   • Y-axis arrow (green)   drag → translate along Y
 *   • Center square (white)  drag → translate freely
 *   • Rotation ring (blue)   drag → set `rotation`
 *   • Scale corners (yellow) drag → set width/height (or radius)
 *
 * Pushes an undo entry on each commit so Cmd+Z restores cleanly.
 */

const NS = 'http://www.w3.org/2000/svg';

export class Gizmo2D {
  constructor(ui) {
    this.ui = ui;
    this.target = null;
    this._drag = null;     // { mode, axis, start: {x,y,rot,w,h,r}, mouseStart }
    this._build();
    this._tick();
  }

  _build() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'dui-gizmo-2d');
    svg.setAttribute('width', '180');
    svg.setAttribute('height', '180');
    svg.setAttribute('viewBox', '-90 -90 180 180');
    svg.style.cssText = 'position:fixed; pointer-events:none; z-index:9995;' +
                         'left:0; top:0; transform-origin:0 0; display:none;';
    // Rotation ring
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('r', '60'); ring.setAttribute('cx', '0'); ring.setAttribute('cy', '0');
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#5b8cff');
    ring.setAttribute('stroke-width', '1.5'); ring.setAttribute('stroke-dasharray', '4 4');
    ring.dataset.handle = 'rotate'; ring.style.pointerEvents = 'stroke';
    ring.style.cursor = 'grab';
    // X-axis arrow
    const xLine = document.createElementNS(NS, 'line');
    xLine.setAttribute('x1', '0'); xLine.setAttribute('y1', '0');
    xLine.setAttribute('x2', '50'); xLine.setAttribute('y2', '0');
    xLine.setAttribute('stroke', '#ff4d4d'); xLine.setAttribute('stroke-width', '2.5');
    xLine.setAttribute('stroke-linecap', 'round');
    xLine.dataset.handle = 'tx'; xLine.style.pointerEvents = 'stroke';
    xLine.style.cursor = 'ew-resize';
    const xHead = document.createElementNS(NS, 'polygon');
    xHead.setAttribute('points', '50,-5 60,0 50,5');
    xHead.setAttribute('fill', '#ff4d4d');
    xHead.dataset.handle = 'tx'; xHead.style.pointerEvents = 'auto';
    xHead.style.cursor = 'ew-resize';
    // Y-axis arrow
    const yLine = document.createElementNS(NS, 'line');
    yLine.setAttribute('x1', '0'); yLine.setAttribute('y1', '0');
    yLine.setAttribute('x2', '0'); yLine.setAttribute('y2', '50');
    yLine.setAttribute('stroke', '#5cd45c'); yLine.setAttribute('stroke-width', '2.5');
    yLine.setAttribute('stroke-linecap', 'round');
    yLine.dataset.handle = 'ty'; yLine.style.pointerEvents = 'stroke';
    yLine.style.cursor = 'ns-resize';
    const yHead = document.createElementNS(NS, 'polygon');
    yHead.setAttribute('points', '-5,50 0,60 5,50');
    yHead.setAttribute('fill', '#5cd45c');
    yHead.dataset.handle = 'ty'; yHead.style.pointerEvents = 'auto';
    yHead.style.cursor = 'ns-resize';
    // Center square (free translate)
    const center = document.createElementNS(NS, 'rect');
    center.setAttribute('x', '-6'); center.setAttribute('y', '-6');
    center.setAttribute('width', '12'); center.setAttribute('height', '12');
    center.setAttribute('fill', '#ffffff'); center.setAttribute('stroke', '#000');
    center.setAttribute('stroke-width', '1');
    center.dataset.handle = 'translate'; center.style.pointerEvents = 'auto';
    center.style.cursor = 'move';
    // Scale corner (single bottom-right corner — symmetric across X & Y)
    const scale = document.createElementNS(NS, 'rect');
    scale.setAttribute('x', '44'); scale.setAttribute('y', '44');
    scale.setAttribute('width', '10'); scale.setAttribute('height', '10');
    scale.setAttribute('fill', '#ffd13b'); scale.setAttribute('stroke', '#000');
    scale.setAttribute('stroke-width', '1');
    scale.dataset.handle = 'scale'; scale.style.pointerEvents = 'auto';
    scale.style.cursor = 'nwse-resize';

    [ring, xLine, xHead, yLine, yHead, scale, center].forEach(h => svg.appendChild(h));
    document.body.appendChild(svg);
    this.element = svg;
    this._handles = [ring, xLine, xHead, yLine, yHead, scale, center];

    // Pointer wiring — use a single delegated handler for all handles.
    this._onDown = (e) => {
      const h = e.target.closest('[data-handle]');
      if (!h || !this.target) return;
      e.preventDefault(); e.stopPropagation();
      const mode = h.dataset.handle;
      this._beginDrag(mode, e);
      h.setPointerCapture?.(e.pointerId);
    };
    this._onMove = (e) => {
      if (!this._drag) return;
      e.preventDefault();
      this._applyDrag(e.clientX, e.clientY);
    };
    this._onUp = (e) => {
      if (!this._drag) return;
      e.preventDefault();
      this._endDrag(true);
    };
    svg.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup',   this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  /** Pin the gizmo to the given target (or null to hide). */
  setTarget(target) {
    // Only show for flat 2D-shape targets, never Three.js Object3Ds (those
    // get the TransformControls gizmo already).
    if (!target || target.position) { this.target = null; this._sync(); return; }
    if (!('x' in target && 'y' in target)) { this.target = null; this._sync(); return; }
    this.target = target;
    this._sync();
    this._reposition();
  }

  /** Synchronize visibility with debug-panel visibility + active target. */
  _sync() {
    const panelVisible = this.ui?.isVisible?.() !== false;
    const show = !!this.target && panelVisible;
    this.element.style.display = show ? 'block' : 'none';
  }

  _reposition() {
    if (!this.target) return;
    const t = this.target;
    // Three anchor conventions live in the same target shape:
    //   • web-adapter (DOM element wrapper) — read the LIVE bounding
    //     rect of the wrapped element. That box already accounts for
    //     any CSS transforms (rotation, scale) the adapter applied, so
    //     the center we compute is the true on-screen center no matter
    //     what the element's transform-origin or composition is. This
    //     also self-corrects if the host applied its own transforms on
    //     top of ours.
    //   • 2D canvas shapes — x/y is the visual center directly (the
    //     demo does `ctx.translate(c.x, c.y)` then draws around (0,0)).
    let cx, cy;
    if (t._el) {
      const r = t._el.getBoundingClientRect();
      cx = r.left + r.width  / 2;
      cy = r.top  + r.height / 2;
    } else {
      cx = t.x;
      cy = t.y;
    }
    const rot = t.rotation || 0;
    this.element.style.left = `${cx - 90}px`;
    this.element.style.top  = `${cy - 90}px`;
    this.element.style.transform = rot ? `rotate(${rot}rad)` : '';
    this.element.style.transformOrigin = '90px 90px';
  }

  _beginDrag(mode, e) {
    const t = this.target;
    this._drag = {
      mode,
      mouseStart: { x: e.clientX, y: e.clientY },
      start: {
        x: t.x, y: t.y,
        rotation: t.rotation || 0,
        width: t.width, height: t.height, radius: t.radius,
      },
      // For rotation, capture the screen-space center NOW (the moment
      // the drag begins). Same anchor logic as _reposition: web-adapter
      // targets read the live bounding rect so the pivot matches the
      // visual center even after prior rotations/scales; 2D canvas
      // shapes treat x/y as the center directly.
      center: (() => {
        if (t._el) {
          const r = t._el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return { x: t.x, y: t.y };
      })(),
    };
    // Surgical will-change: promote the dragged web element to its own
    // compositor layer for the duration of the drag only, so the rapid
    // per-pointermove transform writes stay off the main thread. Cleared in
    // _endDrag — we never leave a standing layer behind.
    if (t._el) t._el.style.willChange = 'transform';
  }

  _applyDrag(mx, my) {
    const d = this._drag, t = this.target;
    if (!d || !t) return;
    const dx = mx - d.mouseStart.x;
    const dy = my - d.mouseStart.y;
    if (d.mode === 'translate') {
      t.x = d.start.x + dx;
      t.y = d.start.y + dy;
    } else if (d.mode === 'tx') {
      t.x = d.start.x + dx;
    } else if (d.mode === 'ty') {
      t.y = d.start.y + dy;
    } else if (d.mode === 'rotate') {
      const a0 = Math.atan2(d.mouseStart.y - d.center.y, d.mouseStart.x - d.center.x);
      const a1 = Math.atan2(my            - d.center.y, mx            - d.center.x);
      t.rotation = d.start.rotation + (a1 - a0);
    } else if (d.mode === 'scale') {
      const d0 = Math.hypot(d.mouseStart.x - d.center.x, d.mouseStart.y - d.center.y) || 1;
      const d1 = Math.hypot(mx - d.center.x, my - d.center.y);
      const factor = Math.max(0.05, d1 / d0);
      if (typeof d.start.radius === 'number') {
        t.radius = d.start.radius * factor;
      } else if (typeof d.start.width === 'number' && typeof d.start.height === 'number') {
        t.width  = d.start.width  * factor;
        t.height = d.start.height * factor;
      }
    }
    this._reposition();
  }

  _endDrag(commit) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    // Drop the temporary compositor layer we promoted in _beginDrag. Done
    // unconditionally (commit or cancel) so will-change never lingers.
    if (this.target?._el) this.target._el.style.willChange = '';
    if (!commit || !this.ui?._undo) return;
    // Build an inverse command capturing only the fields that could have
    // changed in this drag, so coalescing across rapid drags is by-prop.
    const t = this.target;
    const before = { ...d.start };
    const after  = {
      x: t.x, y: t.y,
      rotation: t.rotation,
      width: t.width, height: t.height, radius: t.radius,
    };
    const apply = (snap) => {
      for (const k of Object.keys(snap)) {
        if (snap[k] !== undefined) t[k] = snap[k];
      }
    };
    this.ui._undo.push({
      label: `gizmo2d ${d.mode}`,
      undo: () => apply(before),
      redo: () => apply(after),
    });
  }

  /** Per-frame follow so the gizmo tracks animation / external mutation. */
  _tick() {
    // Cheap visibility re-check — keeps the gizmo in sync with Shift+D
    // toggles without needing to subscribe to a custom event.
    this._sync();
    if (this.target && !this._drag) this._reposition();
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  dispose() {
    cancelAnimationFrame(this._rafId);
    this.element.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup',   this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    this.element.remove();
  }
}
