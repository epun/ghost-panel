/**
 * Control widget factories. Each widget creates DOM, wires events, and returns
 * a handle with { element, getValue, setValue, dispose }. All widgets follow
 * the same shape so they can be managed uniformly.
 */

import { icons } from './icons.js';
import { clamp, clamp01 } from './utils.js';

function row(labelText, tooltip) {
  const el = document.createElement('div');
  el.className = 'dui-row';
  if (tooltip) el.dataset.tooltip = tooltip;
  if (labelText !== null && labelText !== undefined) {
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    el.appendChild(lbl);
  }
  return el;
}

/**
 * Position a popover near its trigger element with smart viewport flip.
 *
 * Default placement is BELOW the trigger. If the popover would overflow
 * the bottom of the viewport, it flips to sit ABOVE the trigger instead.
 * Horizontally clamped so it never bleeds off the left or right edges.
 *
 * Used by the color picker, easing dropdown, and the typography combo
 * popovers — anywhere a popover anchored to a row can land at the
 * bottom of a panel and end up partly off-screen.
 *
 *   positionPopoverNear(popover, trigger, { gap: 6, preferAbove: false });
 */
export function positionPopoverNear(popover, trigger, opts = {}) {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;       // viewport edge margin
  // Make the popover measurable. It must already be visible/displayed
  // (callers should add the visible class first). We temporarily clear
  // any cached transform so the measurement is its natural size.
  const tr = trigger.getBoundingClientRect();
  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  const vpH = window.innerHeight;
  const vpW = window.innerWidth;
  // Vertical: prefer below, fall back to above if it won't fit.
  const fitsBelow = tr.bottom + gap + ph + margin <= vpH;
  const fitsAbove = tr.top - gap - ph - margin >= 0;
  let top;
  if (opts.preferAbove && fitsAbove) top = tr.top - gap - ph;
  else if (fitsBelow)                 top = tr.bottom + gap;
  else if (fitsAbove)                 top = tr.top - gap - ph;
  else {
    // Neither side fits — pin to the side with more room and let the
    // popover's own max-height + overflow take it from there.
    const roomBelow = vpH - tr.bottom;
    const roomAbove = tr.top;
    if (roomBelow >= roomAbove) top = tr.bottom + gap;
    else                        top = Math.max(margin, tr.top - gap - ph);
  }
  // Horizontal: clamp to viewport.
  let left = tr.left;
  if (left + pw > vpW - margin) left = vpW - pw - margin;
  if (left < margin) left = margin;
  popover.style.position = 'fixed';
  popover.style.top  = `${Math.max(margin, Math.min(top,  vpH - margin))}px`;
  popover.style.left = `${left}px`;
}

/** Slider + number input pair, kept in sync. */
/**
 * dialkit-style slider — a horizontal track with a filled portion. Drag
 * anywhere on the track (not just the handle) to scrub the value, with a
 * 3-pixel click-vs-drag threshold borrowed from dialkit's interaction model.
 * The inline value is double-click editable for precise entry. Discrete
 * tick marks render when (max - min) / step ≤ 10.
 */
export function createSlider(label, opts = {}) {
  const {
    min = 0, max = 1, step = 0.01, value = 0,
    onChange = () => {}, suffix = '',
  } = opts;

  const el = row(label, opts.tooltip);
  el.classList.add('dui-slider-row');

  // Container = track with filled-portion overlay, scale ticks, current-
  // value indicator, and numeric readout. Ticks + indicator stay subtle
  // until hover/active so the resting state reads clean.
  const slider = document.createElement('div');
  slider.className = 'dui-slider';
  slider.tabIndex = 0;
  // Inline label + value live inside the slider chrome (dialkit-style).
  // Both use mix-blend-mode: difference in CSS so they stay readable as
  // the fill bar slides under them — no white-on-white washout when the
  // user drags past the value text.
  //
  // Escape the label so user-provided strings can't smuggle markup in.
  const safeLabel = String(label ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  slider.innerHTML = `
    <div class="dui-slider-fill"></div>
    <div class="dui-slider-ticks"></div>
    <div class="dui-slider-indicator"></div>
    <span class="dui-slider-label">${safeLabel}</span>
    <span class="dui-slider-value"></span>
  `;
  const fillEl    = slider.querySelector('.dui-slider-fill');
  const ticksEl   = slider.querySelector('.dui-slider-ticks');
  const indicator = slider.querySelector('.dui-slider-indicator');
  const valueEl   = slider.querySelector('.dui-slider-value');

  // Scale ticks — for discrete ranges with ≤10 steps, emit one tick per
  // step (so a slider over [0..10, step=1] feels notched). For continuous
  // ranges, emit decile marks (10 evenly-spaced ticks) — same vocabulary
  // as dialkit. Visibility ramps from 0 at rest to 1 on hover/drag via CSS.
  //
  // We INTENTIONALLY skip the first (0%) and last (100%) ticks — those
  // would sit directly under the inline label on the left and the value
  // readout on the right, creating visual clutter under the text. The
  // interior ticks alone communicate the scale clearly.
  const stepCount = Math.round((max - min) / step);
  const discrete = stepCount > 0 && stepCount <= 10;
  const tickCount = discrete ? stepCount : 10;
  for (let i = 1; i < tickCount; i++) {
    const t = document.createElement('span');
    t.className = 'dui-slider-tick';
    t.style.left = `${(i / tickCount) * 100}%`;
    ticksEl.appendChild(t);
  }

  const decimals = (() => {
    const s = String(step);
    const i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  })();
  let current = clamp(parseFloat(value), min, max);
  function paint() {
    const t = (current - min) / (max - min || 1);
    const pct = Math.max(0, Math.min(1, t)) * 100;
    fillEl.style.width = `${pct}%`;
    indicator.style.left = `${pct}%`;
    valueEl.textContent = current.toFixed(decimals) + (suffix ? ` ${suffix}` : '');
    // Indicator-vs-value overlap: when the slider's value text and the
    // indicator collide visually, dim the indicator so the number stays
    // readable. The text has higher z-index AND mix-blend-mode: difference
    // so it already paints on top; the alpha cut just keeps the indicator
    // from competing for attention as the bar slides into the readout.
    syncIndicatorDim();
  }
  // Compare bounding boxes — only meaningful once the slider is in the
  // DOM. The first paint runs synchronously during construction (before
  // append), so the rects are zero; the rAF below handles that case.
  // We use the indicator's OWN bounding rect (not a recomputed screen
  // position from the percentage) because the indicator has
  // `transform: translate(-50%, -50%)` baked into its layout — the
  // computed-from-percentage value drifts ~half-the-indicator-width
  // from the actual paint position otherwise.
  function syncIndicatorDim() {
    const ir = indicator.getBoundingClientRect();
    const vr = valueEl.getBoundingClientRect();
    if (!ir.width || !vr.width) return;
    // Treat the indicator and value as overlapping whenever their
    // horizontal extents touch. The value text usually sits flush
    // with the right edge of the slider; the indicator at 95%+ value
    // commonly lands inside the text's bounding box.
    const overlaps = ir.right > vr.left - 2 && ir.left < vr.right + 2;
    indicator.classList.toggle('dui-slider-indicator-dim', overlaps);
  }
  // Re-sync the dim state on the next frame so the first paint catches
  // up once the slider is attached and getBoundingClientRect returns
  // real numbers.
  requestAnimationFrame(syncIndicatorDim);
  function set(v, fire = true) {
    const snapped = Math.round((v - min) / step) * step + min;
    const clamped = clamp(snapped, min, max);
    if (clamped === current) return;
    current = clamped;
    paint();
    if (fire) onChange(current);
  }
  paint();

  // Drag-anywhere track behavior with click-vs-drag threshold.
  const CLICK_THRESHOLD = 3;
  let dragStart = null;
  function pointerToValue(clientX) {
    const r = slider.getBoundingClientRect();
    const t = (clientX - r.left) / r.width;
    return min + clamp(t, 0, 1) * (max - min);
  }
  slider.addEventListener('pointerdown', (e) => {
    // Skip the drag for clicks on the value readout / inline editor —
    // those are typing targets, not dragging targets. Without this, clicking
    // the number to type would also jump the slider position along the track.
    if (e.target.closest('.dui-slider-editor, .dui-slider-value')) return;
    slider.setPointerCapture(e.pointerId);
    slider.classList.add('dui-slider-active');
    dragStart = { x: e.clientX, moved: false };
    set(pointerToValue(e.clientX));
  });
  slider.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    if (!dragStart.moved && Math.abs(e.clientX - dragStart.x) >= CLICK_THRESHOLD) {
      dragStart.moved = true;
      slider.classList.add('dui-slider-dragging');
    }
    if (dragStart.moved) set(pointerToValue(e.clientX));
  });
  function endDrag(e) {
    if (!dragStart) return;
    dragStart = null;
    slider.classList.remove('dui-slider-active', 'dui-slider-dragging');
    try { slider.releasePointerCapture(e.pointerId); } catch {}
  }
  slider.addEventListener('pointerup',   endDrag);
  slider.addEventListener('pointercancel', endDrag);

  // Arrow-key fine-tune when focused.
  slider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')  { e.preventDefault(); set(current - step); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { e.preventDefault(); set(current + step); }
    if (e.key === 'Home') { e.preventDefault(); set(min); }
    if (e.key === 'End')  { e.preventDefault(); set(max); }
  });

  // Single-click the value readout to type a precise value.
  //
  // Why mousedown.preventDefault? Without it, the browser's default
  // mousedown behavior moves focus to the nearest focusable ancestor
  // (the slider has tabIndex=0). That happens BEFORE our click handler
  // runs, so by the time we create the editor and call .focus() on it,
  // the slider already owns focus — and a subsequent focus event on
  // the slider will fire blur on the editor, which commits and removes
  // it instantly. preventDefault on mousedown keeps focus where it is,
  // letting our editor.focus() call actually stick.
  //
  // Stopping propagation also keeps the slider's pointerdown handler
  // (the drag-start) from running on the same press.
  valueEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  valueEl.addEventListener('mousedown',   (e) => { e.preventDefault(); e.stopPropagation(); });
  valueEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'dui-slider-editor';
    editor.value = String(current);
    valueEl.replaceWith(editor);
    editor.focus(); editor.select();
    const commit = () => {
      const v = parseFloat(editor.value);
      editor.replaceWith(valueEl);
      if (Number.isFinite(v)) set(v);
      else paint();
    };
    editor.addEventListener('blur', commit, { once: true });
    editor.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter')  { ev.preventDefault(); editor.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); editor.replaceWith(valueEl); paint(); }
    });
  });

  el.appendChild(slider);

  return {
    element: el,
    getValue: () => current,
    setValue: (v) => set(v, false),
    dispose: () => el.remove(),
  };
}

/**
 * Corner-radius control — Figma-style. A uniform value field on top, a
 * mode-toggle on the right, and a 2x2 grid of per-corner inputs below.
 * In "linked" mode (default), changing the uniform field updates all four
 * corners; the per-corner inputs are read-only mirrors. In "unlinked"
 * mode, each corner is independently editable and the uniform field shows
 * "Mixed" when the four corners disagree.
 *
 * onChange receives either a single number (linked) or an object
 * `{ tl, tr, br, bl }` (unlinked) so callers can persist accordingly.
 */
export function createCornerRadius(label, opts = {}) {
  const { value = 0, onChange = () => {} } = opts;
  const initial = (typeof value === 'object' && value)
    ? { tl: +value.tl || 0, tr: +value.tr || 0, br: +value.br || 0, bl: +value.bl || 0 }
    : { tl: +value || 0, tr: +value || 0, br: +value || 0, bl: +value || 0 };

  // Use the standard row() so the label aligns with every other folder
  // control. The widget itself fills the right-hand side.
  const el = row(label, opts.tooltip);
  el.classList.add('dui-cr-row');

  const widget = document.createElement('div');
  widget.className = 'dui-cr';
  // Corner glyphs from the central Phosphor-style icon set — one
  // quadrant of a rounded frame per corner. Linked / unlinked toggle
  // icons share the same vocabulary (full vs dashed frame outline) so
  // the widget reads as one family with the rest of the panel.
  const cornerIcon = (corner) => {
    const map = { tl: 'cornerTL', tr: 'cornerTR', br: 'cornerBR', bl: 'cornerBL' };
    return icons[map[corner]];
  };
  const linkedIcon   = icons.cornerLinked;
  const unlinkedIcon = icons.cornerUnlinked;

  widget.innerHTML = `
    <div class="dui-cr-head">
      <div class="dui-cr-field dui-cr-uniform">
        <span class="dui-cr-icon">${linkedIcon}</span>
        <input class="dui-cr-input" type="text" inputmode="numeric" value="0" />
      </div>
      <button class="dui-cr-toggle" type="button"
              data-tooltip="Toggle independent corners">${linkedIcon}</button>
    </div>
    <div class="dui-cr-grid" hidden>
      <div class="dui-cr-field" data-corner="tl">
        <span class="dui-cr-icon">${cornerIcon('tl')}</span>
        <input class="dui-cr-input" data-corner="tl" type="text" inputmode="numeric" value="0" />
      </div>
      <div class="dui-cr-field" data-corner="tr">
        <span class="dui-cr-icon">${cornerIcon('tr')}</span>
        <input class="dui-cr-input" data-corner="tr" type="text" inputmode="numeric" value="0" />
      </div>
      <div class="dui-cr-field" data-corner="bl">
        <span class="dui-cr-icon">${cornerIcon('bl')}</span>
        <input class="dui-cr-input" data-corner="bl" type="text" inputmode="numeric" value="0" />
      </div>
      <div class="dui-cr-field" data-corner="br">
        <span class="dui-cr-icon">${cornerIcon('br')}</span>
        <input class="dui-cr-input" data-corner="br" type="text" inputmode="numeric" value="0" />
      </div>
    </div>
  `;
  el.appendChild(widget);

  const uniformInput = widget.querySelector('.dui-cr-uniform .dui-cr-input');
  const cornerInputs = Object.fromEntries(['tl','tr','bl','br'].map(
    c => [c, widget.querySelector(`.dui-cr-input[data-corner="${c}"]`)]));
  const toggleBtn = widget.querySelector('.dui-cr-toggle');
  const grid = widget.querySelector('.dui-cr-grid');

  // Accessibility: the corner glyphs are decorative, so each radius field
  // needs a name; rejected (non-numeric) entries revert silently via paint().
  // Give every input a spinbutton role + name and an SR-only live region.
  const _crMsg = (input, name) => {
    input.setAttribute('role', 'spinbutton');
    input.setAttribute('aria-label', name);
    input.setAttribute('aria-valuemin', '0');
    const msg = document.createElement('span');
    msg.className = 'dui-field-msg';
    msg.setAttribute('aria-live', 'polite');
    msg.id = `dui-cr-${++_a11yFieldSeq}`;
    input.setAttribute('aria-describedby', msg.id);
    (input.closest('.dui-cr-field') || input.parentNode)?.appendChild(msg);
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') {
        input.removeAttribute('aria-invalid'); msg.textContent = '';
      }
    });
    return msg;
  };
  const uniformMsg = _crMsg(uniformInput, 'Corner radius');
  const cornerMsg = {
    tl: _crMsg(cornerInputs.tl, 'Top-left radius'),
    tr: _crMsg(cornerInputs.tr, 'Top-right radius'),
    bl: _crMsg(cornerInputs.bl, 'Bottom-left radius'),
    br: _crMsg(cornerInputs.br, 'Bottom-right radius'),
  };

  const state = { ...initial, linked: true };

  function fire() {
    if (state.linked) onChange(state.tl);
    else onChange({ tl: state.tl, tr: state.tr, br: state.br, bl: state.bl });
  }
  function paint() {
    cornerInputs.tl.value = String(state.tl);
    cornerInputs.tr.value = String(state.tr);
    cornerInputs.bl.value = String(state.bl);
    cornerInputs.br.value = String(state.br);
    for (const c of ['tl','tr','bl','br']) cornerInputs[c].setAttribute('aria-valuenow', cornerInputs[c].value);
    const allSame = state.tl === state.tr && state.tr === state.br && state.br === state.bl;
    uniformInput.value = allSame ? String(state.tl) : 'Mixed';
    if (allSame) uniformInput.setAttribute('aria-valuenow', String(state.tl));
    else uniformInput.removeAttribute('aria-valuenow');
    grid.hidden = state.linked;
    toggleBtn.classList.toggle('dui-active', !state.linked);
    toggleBtn.innerHTML = state.linked ? linkedIcon : unlinkedIcon;
    // Greyed-out indicator for the uniform field while unlinked.
    widget.classList.toggle('dui-cr-unlinked', !state.linked);
  }
  paint();

  // Uniform input commit — in linked mode applies to all four corners;
  // in unlinked mode it overrides every corner (same as Figma).
  function commitUniform(raw) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) {
      uniformInput.setAttribute('aria-invalid', 'true');
      uniformMsg.textContent = 'Not a number — reverted.';
      paint(); return;
    }
    uniformInput.removeAttribute('aria-invalid'); uniformMsg.textContent = '';
    state.tl = state.tr = state.br = state.bl = Math.max(0, v);
    paint(); fire();
  }
  uniformInput.addEventListener('change', () => commitUniform(uniformInput.value));
  uniformInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); uniformInput.blur(); }
  });

  // Per-corner commits.
  ['tl','tr','bl','br'].forEach(c => {
    cornerInputs[c].addEventListener('change', () => {
      const v = parseFloat(cornerInputs[c].value);
      if (!Number.isFinite(v)) {
        cornerInputs[c].setAttribute('aria-invalid', 'true');
        cornerMsg[c].textContent = 'Not a number — reverted.';
        paint(); return;
      }
      cornerInputs[c].removeAttribute('aria-invalid'); cornerMsg[c].textContent = '';
      state[c] = Math.max(0, v);
      // Auto-switch into unlinked the moment a corner deviates.
      if (state.linked && (state.tl !== state.tr || state.tr !== state.br || state.br !== state.bl)) {
        state.linked = false;
      }
      paint(); fire();
    });
    cornerInputs[c].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cornerInputs[c].blur(); }
    });
  });

  toggleBtn.addEventListener('click', () => {
    state.linked = !state.linked;
    if (state.linked) {
      // Re-link → snap every corner to the TL value (Figma's behavior).
      state.tr = state.br = state.bl = state.tl;
    }
    paint(); fire();
  });

  return {
    element: el,
    getValue: () => state.linked ? state.tl : { tl: state.tl, tr: state.tr, br: state.br, bl: state.bl },
    setValue: (v) => {
      if (typeof v === 'object' && v) {
        state.tl = +v.tl || 0; state.tr = +v.tr || 0;
        state.br = +v.br || 0; state.bl = +v.bl || 0;
        state.linked = (state.tl === state.tr && state.tr === state.br && state.br === state.bl);
      } else {
        state.tl = state.tr = state.br = state.bl = +v || 0;
        state.linked = true;
      }
      paint();
    },
    dispose: () => el.remove(),
  };
}

/**
 * Dimensions control — Figma-style paired W / H fields with an
 * aspect-lock toggle on the right.
 *
 * - When `linked` is true (toggle off, "free"), the two fields are
 *   independent.
 * - When `linked` is true (toggle on, "linked"), editing one field
 *   scales the other by the current aspect ratio so the proportions
 *   stay constant.
 *
 * onChange receives `{ width, height }` on every commit.
 */
export function createDimensions(label, opts = {}) {
  const { value = { width: 0, height: 0 }, onChange = () => {}, locked = false } = opts;
  const initial = {
    width:  +value.width  || 0,
    height: +value.height || 0,
  };

  const el = row(label, opts.tooltip);
  el.classList.add('dui-dim-row');

  // Aspect-link icons — Phosphor link / link-break from the shared
  // icon set so the W/H toggle visually matches the corner-radius
  // widget's linked / unlinked button.
  const ICON_LINKED = icons.link;
  const ICON_FREE   = icons.linkBreak;

  const widget = document.createElement('div');
  widget.className = 'dui-dim';
  widget.innerHTML = `
    <div class="dui-dim-fields">
      <div class="dui-paired-cell">
        <span class="dui-paired-icon" aria-hidden="true">W</span>
        <input class="dui-dim-w" type="text" inputmode="numeric" />
      </div>
      <div class="dui-paired-cell">
        <span class="dui-paired-icon" aria-hidden="true">H</span>
        <input class="dui-dim-h" type="text" inputmode="numeric" />
      </div>
    </div>
    <button class="dui-dim-lock" type="button" data-tooltip="Constrain proportions"></button>
  `;
  el.appendChild(widget);

  const wInput   = widget.querySelector('.dui-dim-w');
  const hInput   = widget.querySelector('.dui-dim-h');
  const lockBtn  = widget.querySelector('.dui-dim-lock');
  const state = { ...initial, locked: !!locked };

  // Accessibility: the W/H glyphs are decorative (aria-hidden), so each field
  // needs an explicit name; and a rejected entry (NaN or negative) reverts
  // silently via paint(), which a screen reader can't perceive. Wire a
  // spinbutton role + name + an SR-only live region per field, mirroring the
  // numeric chips elsewhere in the panel.
  const _dimMsg = (input, name) => {
    input.setAttribute('role', 'spinbutton');
    input.setAttribute('aria-label', name);
    input.setAttribute('aria-valuemin', '0');
    const msg = document.createElement('span');
    msg.className = 'dui-field-msg';
    msg.setAttribute('aria-live', 'polite');
    msg.id = `dui-dim-${++_a11yFieldSeq}`;
    input.setAttribute('aria-describedby', msg.id);
    input.closest('.dui-paired-cell')?.appendChild(msg);
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') {
        input.removeAttribute('aria-invalid'); msg.textContent = '';
      }
    });
    return msg;
  };
  const wMsg = _dimMsg(wInput, 'Width');
  const hMsg = _dimMsg(hInput, 'Height');

  function paint() {
    wInput.value = String(round1(state.width));
    hInput.value = String(round1(state.height));
    wInput.setAttribute('aria-valuenow', wInput.value);
    hInput.setAttribute('aria-valuenow', hInput.value);
    lockBtn.classList.toggle('dui-active', state.locked);
    lockBtn.innerHTML = state.locked ? ICON_LINKED : ICON_FREE;
    lockBtn.dataset.tooltip = state.locked ? 'Unlock proportions' : 'Constrain proportions';
  }
  function round1(v) { return Math.round(v * 100) / 100; }
  function fire() { onChange({ width: state.width, height: state.height }); }
  paint();

  function commitWidth(raw) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v < 0) {
      wInput.setAttribute('aria-invalid', 'true');
      wMsg.textContent = 'Enter a non-negative number — reverted.';
      paint(); return;
    }
    wInput.removeAttribute('aria-invalid'); wMsg.textContent = '';
    if (state.locked && state.width > 0) {
      const ratio = state.height / state.width || 1;
      state.height = v * ratio;
    }
    state.width = v;
    paint(); fire();
    wInput.setAttribute('aria-valuenow', String(round1(state.width)));
    hInput.setAttribute('aria-valuenow', String(round1(state.height)));
  }
  function commitHeight(raw) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v < 0) {
      hInput.setAttribute('aria-invalid', 'true');
      hMsg.textContent = 'Enter a non-negative number — reverted.';
      paint(); return;
    }
    hInput.removeAttribute('aria-invalid'); hMsg.textContent = '';
    if (state.locked && state.height > 0) {
      const ratio = state.width / state.height || 1;
      state.width = v * ratio;
    }
    state.height = v;
    paint(); fire();
    wInput.setAttribute('aria-valuenow', String(round1(state.width)));
    hInput.setAttribute('aria-valuenow', String(round1(state.height)));
  }
  wInput.addEventListener('change', () => commitWidth(wInput.value));
  hInput.addEventListener('change', () => commitHeight(hInput.value));
  [wInput, hInput].forEach(i =>
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } }));
  lockBtn.addEventListener('click', () => { state.locked = !state.locked; paint(); });

  return {
    element: el,
    getValue: () => ({ width: state.width, height: state.height, locked: state.locked }),
    setValue: (v) => {
      if (v && typeof v === 'object') {
        if ('width'  in v) state.width  = +v.width  || 0;
        if ('height' in v) state.height = +v.height || 0;
        if ('locked' in v) state.locked = !!v.locked;
      }
      paint();
    },
    dispose: () => el.remove(),
  };
}

/** Color picker. Value is a hex string like '#ff00aa'. */
/**
 * Color picker — custom popover styled to match the rest of the tool.
 * Click the swatch to open: SV (saturation/value) square, hue strip, hex
 * input. Closes on outside-click or Esc. Emits `onChange(hex)` live as the
 * user drags.
 */
export function createColor(label, opts = {}) {
  const { value = '#ffffff', onChange = () => {} } = opts;
  const el = row(label, opts.tooltip);
  el.classList.add('dui-color-row');

  // Swatch — what the user sees inline. Click → opens the popover.
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'dui-color-swatch';
  swatch.style.flex = '1';
  el.appendChild(swatch);

  let current = normalizeHex(value);
  function paintSwatch() { swatch.style.background = current; }
  paintSwatch();

  // ── Popover (lazily built on first open) ──
  let popover = null;
  let svPicker, svPointer, hueStrip, hueThumb, hexInput;
  let { h, s, v } = hexToHsv(current);

  function buildPopover() {
    popover = document.createElement('div');
    popover.className = 'dui-color-popover';
    popover.innerHTML = `
      <div class="dui-color-sv">
        <div class="dui-color-sv-saturation"></div>
        <div class="dui-color-sv-value"></div>
        <div class="dui-color-sv-pointer"></div>
      </div>
      <div class="dui-color-hue">
        <div class="dui-color-hue-thumb"></div>
      </div>
      <div class="dui-color-hex-row">
        <span class="dui-color-hex-prefix">#</span>
        <input class="dui-color-hex" type="text" maxlength="6" spellcheck="false" />
      </div>
    `;
    document.body.appendChild(popover);
    svPicker  = popover.querySelector('.dui-color-sv');
    svPointer = popover.querySelector('.dui-color-sv-pointer');
    hueStrip  = popover.querySelector('.dui-color-hue');
    hueThumb  = popover.querySelector('.dui-color-hue-thumb');
    hexInput  = popover.querySelector('.dui-color-hex');

    // Drag handlers for the SV square + hue strip
    bindDrag(svPicker, (px, py, r) => {
      s = clamp01((px - r.left) / r.width);
      v = 1 - clamp01((py - r.top) / r.height);
      updateFromHsv();
    });
    bindDrag(hueStrip, (px, _py, r) => {
      h = clamp01((px - r.left) / r.width);
      updateFromHsv();
    });

    hexInput.addEventListener('change', () => {
      const candidate = '#' + hexInput.value.trim().replace(/^#/, '');
      if (/^#[0-9a-fA-F]{6}$/.test(candidate)) {
        current = candidate.toLowerCase();
        ({ h, s, v } = hexToHsv(current));
        applyAll();
        onChange(current);
      } else {
        hexInput.value = current.slice(1);   // revert
      }
    });

    // Outside-click / Esc to close
    const onDocClick = (e) => { if (!popover.contains(e.target) && e.target !== swatch) closePopover(); };
    const onKey = (e) => { if (e.key === 'Escape') closePopover(); };
    popover._listeners = { onDocClick, onKey };
  }

  function openPopover() {
    if (!popover) buildPopover();
    applyAll();
    popover.classList.add('dui-color-popover-visible');
    positionPopoverNear(popover, swatch);
    setTimeout(() => {
      document.addEventListener('click', popover._listeners.onDocClick, true);
      window.addEventListener('keydown', popover._listeners.onKey);
    }, 0);
  }
  function closePopover() {
    if (!popover) return;
    popover.classList.remove('dui-color-popover-visible');
    document.removeEventListener('click', popover._listeners.onDocClick, true);
    window.removeEventListener('keydown', popover._listeners.onKey);
  }
  swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover?.classList.contains('dui-color-popover-visible')) closePopover();
    else openPopover();
  });

  function updateFromHsv() {
    current = hsvToHex(h, s, v);
    applyAll();
    onChange(current);
  }
  function applyAll() {
    paintSwatch();
    if (!popover) return;
    // SV background driven by hue (full-sat gradient over white→hue → black).
    svPicker.style.background = `hsl(${Math.round(h * 360)} 100% 50%)`;
    svPointer.style.left = `${s * 100}%`;
    svPointer.style.top  = `${(1 - v) * 100}%`;
    hueThumb.style.left  = `${h * 100}%`;
    hexInput.value = current.slice(1);
  }

  return {
    element: el,
    getValue: () => current,
    setValue: (v2) => {
      current = normalizeHex(v2);
      ({ h, s, v } = hexToHsv(current));
      applyAll();
    },
    dispose: () => { closePopover(); popover?.remove(); el.remove(); },
  };
}

// ── color math helpers ──
function normalizeHex(c) {
  if (typeof c !== 'string') return '#ffffff';
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + c.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
  return '#ffffff';
}
function hexToRgb(hex) {
  hex = normalizeHex(hex).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}
function rgbToHex(r, g, b) {
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
function hexToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r / 255, g / 255, b / 255);
}
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = v - c;
  let [r, g, b] = [0, 0, 0];
  const i = Math.floor(h * 6) % 6;
  if (i === 0) [r, g, b] = [c, x, 0];
  else if (i === 1) [r, g, b] = [x, c, 0];
  else if (i === 2) [r, g, b] = [0, c, x];
  else if (i === 3) [r, g, b] = [0, x, c];
  else if (i === 4) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function bindDrag(el, onMove) {
  function fire(e) {
    const r = el.getBoundingClientRect();
    onMove(e.clientX, e.clientY, r);
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    fire(e);
    const move = (ev) => fire(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

/** Checkbox / boolean toggle. */
export function createCheckbox(label, opts = {}) {
  const { value = false, onChange = () => {} } = opts;
  const el = row(label, opts.tooltip);
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  el.appendChild(input);
  return {
    element: el,
    getValue: () => input.checked,
    setValue: (v) => { input.checked = !!v; },
    dispose: () => el.remove(),
  };
}

/** Text input. */
export function createText(label, opts = {}) {
  const { value = '', placeholder = '', onChange = () => {}, multiline = false } = opts;
  const el = row(label, opts.tooltip);
  // Multiline mode swaps the input for a textarea so the typography
  // editor (and other long-form fields) can display + edit text content
  // across multiple lines. Layout falls back to the `dui-row-block`
  // column flavor so the textarea spans the full row width.
  let input;
  if (multiline) {
    el.classList.add('dui-row-block', 'dui-text-row-multiline');
    input = document.createElement('textarea');
    input.className = 'dui-textarea';
    input.rows = opts.rows || 2;
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener('input', () => onChange(input.value));
    el.appendChild(input);
  } else {
    // Inline label chip + input share one chrome (dialkit-style).
    el.classList.add('dui-text-row');
    const inlineLabel = document.createElement('span');
    inlineLabel.className = 'dui-inline-label';
    inlineLabel.textContent = String(label ?? '');
    el.appendChild(inlineLabel);
    input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener('input', () => onChange(input.value));
    el.appendChild(input);
  }
  return {
    element: el,
    getValue: () => input.value,
    setValue: (v) => { input.value = v; },
    dispose: () => el.remove(),
  };
}

// Monotonic id source for wiring aria-labelledby / aria-describedby pairs.
let _a11yFieldSeq = 0;

/**
 * Wire accessibility onto a numeric text field that auto-clamps and reverts.
 *
 * These fields are typed text inputs that ALSO nudge by `step` with the arrow
 * keys and clamp to [min,max] — which is exactly a `spinbutton`. Without help,
 * a screen reader announces them as an unnamed "edit text" and says nothing
 * when an entry is rejected or silently clamped. We add:
 *
 *   • an accessible NAME, taken from the visible inline label (aria-labelledby
 *     — we reuse the real on-screen text rather than inventing an aria-label);
 *   • spinbutton role + aria-valuemin/max/now so AT announces the range and
 *     every value change (including arrow-key nudges);
 *   • a polite live message linked via aria-describedby that voices what
 *     happened on a bad commit — "Not a number, reverted" or "Clamped to N";
 *   • aria-invalid while the last *typed* entry was non-numeric, cleared the
 *     moment the user starts editing again (or commits a valid value).
 *
 * The message element is visually hidden (it's an announcement channel, not a
 * layout element) — the visible cue for sighted users is a CSS red outline
 * driven by [aria-invalid="true"], which costs zero layout shift.
 *
 * Returns { msgEl, sync(current), report(rawText, parsed, current) }.
 */
function wireNumericFieldA11y(input, labelEl, min, max) {
  const uid = `dui-num-${++_a11yFieldSeq}`;

  if (labelEl) {
    if (!labelEl.id) labelEl.id = `${uid}-lbl`;
    input.setAttribute('aria-labelledby', labelEl.id);
  }

  input.setAttribute('role', 'spinbutton');
  if (Number.isFinite(min)) input.setAttribute('aria-valuemin', String(min));
  if (Number.isFinite(max)) input.setAttribute('aria-valuemax', String(max));

  const msgEl = document.createElement('span');
  msgEl.className = 'dui-field-msg';
  msgEl.id = `${uid}-msg`;
  msgEl.setAttribute('aria-live', 'polite');
  const prior = input.getAttribute('aria-describedby');
  input.setAttribute('aria-describedby', prior ? `${prior} ${msgEl.id}` : msgEl.id);

  // As soon as the user starts editing again, drop the invalid state — they're
  // already fixing it, so a lingering red outline would just be noise.
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') {
      input.removeAttribute('aria-invalid');
      msgEl.textContent = '';
    }
  });

  const lo = Number.isFinite(min) ? min : '−∞'; // −∞
  const hi = Number.isFinite(max) ? max : '∞';       // ∞

  return {
    msgEl,
    sync(current) { input.setAttribute('aria-valuenow', String(current)); },
    report(rawText, parsed, current) {
      const raw = String(rawText).trim();
      if (raw !== '' && !Number.isFinite(parsed)) {
        input.setAttribute('aria-invalid', 'true');
        msgEl.textContent = `Not a number — reverted to ${current}.`;
      } else if (Number.isFinite(parsed) && parsed !== current) {
        input.removeAttribute('aria-invalid');     // clamped is accepted, not invalid
        msgEl.textContent = `Clamped to ${current} (range ${lo}–${hi}).`;
      } else {
        input.removeAttribute('aria-invalid');
        msgEl.textContent = '';
      }
    },
  };
}

/**
 * Plain numeric input — typeable, inline-labeled. Replaces the older
 * stepper widget (which had visible +/- buttons that competed with the
 * value for attention). Arrow Up / Down still nudge by `step` when the
 * field is focused.
 *
 * If a unit is provided it shows in the LABEL parens — e.g.
 *   `createNumber('Lens', { unit: 'mm' })` →  the chip reads "Lens (mm)"
 *   while the value stays a pure number ("57", not "57mm"). This matches
 *   Figma's typography editor and keeps the input column unit-free, so
 *   numbers right-align cleanly across a stack of rows.
 *
 * opts: { min, max, step, value, unit, onChange, tooltip }
 *
 * Back-compat: `suffix` is still accepted — it's treated as `unit` and
 * moves into the label rather than the value. Old call sites get the
 * new look without changes.
 */
export function createNumber(label, opts = {}) {
  const {
    min = -Infinity, max = Infinity, step = 1, value = 0,
    onChange = () => {},
  } = opts;
  // Back-compat: legacy callers pass `suffix` for the unit. Promote it.
  const unit = opts.unit ?? opts.suffix ?? '';
  const baseLabel = String(label ?? '');
  const displayLabel = unit ? `${baseLabel} (${unit})` : baseLabel;

  const el = row(displayLabel, opts.tooltip);
  el.classList.add('dui-number-row');

  // Inline label inside the input chrome (dialkit-style). The external
  // row label is hidden via CSS — this chip is the only label shown.
  const inlineLabel = document.createElement('span');
  inlineLabel.className = 'dui-inline-label';
  inlineLabel.textContent = displayLabel;
  el.appendChild(inlineLabel);

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'dui-number-input';
  input.value = String(value);

  let current = Number(value);
  const a11y = wireNumericFieldA11y(input, inlineLabel, min, max);
  function repaint() { input.value = String(current); a11y.sync(current); }
  function commit() {
    const raw = input.value;
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      current = Math.min(max, Math.max(min, parsed));
    }
    a11y.report(raw, parsed, current);
    repaint();
    onChange(current);
  }
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur(); }
    // Arrow keys nudge by step (without visible +/- buttons).
    if (e.key === 'ArrowUp')   { e.preventDefault(); current = Math.min(max, current + step); repaint(); onChange(current); }
    if (e.key === 'ArrowDown') { e.preventDefault(); current = Math.max(min, current - step); repaint(); onChange(current); }
  });

  a11y.sync(current);
  el.appendChild(input);
  el.appendChild(a11y.msgEl);
  return {
    element: el,
    getValue: () => current,
    setValue: (v) => {
      current = Math.min(max, Math.max(min, Number(v)));
      repaint();
    },
    dispose: () => el.remove(),
  };
}

/**
 * Multiple number inputs in one row — 2 to 4 cells side-by-side.
 *
 *   createPairedNumbers([
 *     { label: 'Near', value: 0.1, onChange: v => cam.near = v },
 *     { label: 'Far',  value: 100, onChange: v => cam.far  = v },
 *   ])
 *
 * Use when fields are semantically siblings (Near/Far, W/H, Min/Max,
 * RGBA channels) — they read as a unit and save the panel height of two
 * full rows. Anything more than 4 starts feeling cramped, so 2 is the
 * sweet spot.
 *
 * Each field accepts the same opts as createNumber except `tooltip` (the
 * inline icon doubles as the tooltip target).
 */
export function createPairedNumbers(fields = []) {
  if (!Array.isArray(fields) || fields.length < 1) {
    throw new Error('createPairedNumbers: needs an array of 1–4 fields');
  }
  const n = Math.min(4, fields.length);
  const el = document.createElement('div');
  el.className = `dui-row dui-row-paired dui-row-pair-${n}`;

  const handles = fields.slice(0, n).map(f => {
    const unit = f.unit ?? f.suffix ?? '';
    const displayLabel = unit ? `${f.label} (${unit})` : String(f.label ?? '');
    const cell = document.createElement('div');
    cell.className = 'dui-paired-cell';
    cell.innerHTML = `
      <span class="dui-inline-label" ${f.tooltip ? `data-tooltip="${f.tooltip}"` : ''}>${displayLabel}</span>
      <input class="dui-paired-input" type="text" inputmode="decimal" />
    `;
    const input = cell.querySelector('.dui-paired-input');
    const labelEl = cell.querySelector('.dui-inline-label');
    const min = f.min ?? -Infinity;
    const max = f.max ?? Infinity;
    const step = f.step ?? 1;
    let current = Number(f.value ?? 0);
    const a11y = wireNumericFieldA11y(input, labelEl, min, max);
    function repaint() { input.value = String(current); a11y.sync(current); }
    function commit() {
      const raw = input.value;
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed)) current = Math.min(max, Math.max(min, parsed));
      a11y.report(raw, parsed, current);
      repaint();
      f.onChange?.(current);
    }
    repaint();
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')     { e.preventDefault(); input.blur(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); current = Math.min(max, current + step); repaint(); f.onChange?.(current); }
      if (e.key === 'ArrowDown') { e.preventDefault(); current = Math.max(min, current - step); repaint(); f.onChange?.(current); }
    });
    cell.appendChild(a11y.msgEl);
    el.appendChild(cell);
    return {
      cell, input,
      getValue: () => current,
      setValue: (v) => { current = Math.min(max, Math.max(min, Number(v))); repaint(); },
    };
  });
  return {
    element: el,
    fields: handles,
    getValue: () => handles.reduce((acc, h, i) => ({ ...acc, [fields[i].label]: h.getValue() }), {}),
    setValue: (vals) => {
      handles.forEach((h, i) => {
        const v = vals?.[fields[i].label];
        if (v !== undefined) h.setValue(v);
      });
    },
    dispose: () => el.remove(),
  };
}

/** Select / dropdown. options: [{ value, label }] or [string, ...]. */
/**
 * Custom dropdown. Replaces native <select> with a popover styled to
 * match the rest of the tool — dark backdrop, hover highlight, check
 * mark on the currently-selected option, smart-flip placement so it
 * never overflows the viewport bottom.
 *
 * Same API surface as before: { options, value, onChange, tooltip }.
 * Options accept either plain strings or { value, label } objects.
 */
export function createSelect(label, opts = {}) {
  const { options = [], value, onChange = () => {} } = opts;
  const norm = options.map(o => typeof o === 'string'
    ? { value: o, label: o }
    : { value: o.value, label: o.label ?? o.value });

  const el = row(label, opts.tooltip);
  el.classList.add('dui-select-row');
  const inlineLabel = document.createElement('span');
  inlineLabel.className = 'dui-inline-label';
  inlineLabel.textContent = String(label ?? '');
  el.appendChild(inlineLabel);

  // Trigger: shows the currently-selected option's label + a chevron.
  // Click anywhere on the row (via the trigger's stretch flex) opens
  // the popover. The trigger is a real <button> so keyboard focus +
  // Enter both work for accessibility.
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dui-select-trigger';
  trigger.innerHTML = `
    <span class="dui-select-value"></span>
    <span class="dui-select-chevron">${icons.caretDown}</span>
  `;
  const valueEl = trigger.querySelector('.dui-select-value');
  el.appendChild(trigger);

  let current = value;
  function paint() {
    const match = norm.find(o => o.value === current);
    valueEl.textContent = match ? match.label : '';
  }
  if (current === undefined && norm.length > 0) current = norm[0].value;
  paint();

  // Popover is built lazily on first open and re-positioned each show
  // (so option lists that change between opens still render correctly).
  let popover = null;
  function buildPopover() {
    const pop = document.createElement('div');
    pop.className = 'dui-combo-popover dui-select-popover';
    norm.forEach(o => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dui-combo-option dui-select-option';
      btn.dataset.value = String(o.value);
      btn.innerHTML = `
        <span class="dui-select-check">${icons.check}</span>
        <span class="dui-combo-option-label">${o.label}</span>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        current = o.value;
        paint();
        onChange(current);
        closePop();
      });
      pop.appendChild(btn);
    });
    return pop;
  }
  function syncCheckmarks() {
    if (!popover) return;
    popover.querySelectorAll('.dui-select-option').forEach(b => {
      b.classList.toggle('dui-active', b.dataset.value === String(current));
    });
  }
  function positionPop() {
    if (!popover) return;
    const r = trigger.getBoundingClientRect();
    popover.style.width = `${Math.max(r.width, 140)}px`;
    positionPopoverNear(popover, trigger, { gap: 4 });
  }
  function openPop() {
    if (!popover) popover = buildPopover();
    document.body.appendChild(popover);
    syncCheckmarks();
    el.classList.add('dui-select-open');
    positionPop();
    setTimeout(() => {
      document.addEventListener('click', outsideClose, { capture: true });
      document.addEventListener('keydown', escClose);
      window.addEventListener('resize', positionPop);
      // Passive: positionPop only reads layout + repositions, never
      // preventDefault — so the browser can keep scrolling on the fast path.
      window.addEventListener('scroll', positionPop, { capture: true, passive: true });
    }, 0);
  }
  function closePop() {
    if (!popover) return;
    popover.remove();
    el.classList.remove('dui-select-open');
    document.removeEventListener('click', outsideClose, { capture: true });
    document.removeEventListener('keydown', escClose);
    window.removeEventListener('resize', positionPop);
    window.removeEventListener('scroll', positionPop, true);
  }
  function outsideClose(e) {
    if (!popover) return;
    if (popover.contains(e.target) || trigger.contains(e.target)) return;
    closePop();
  }
  function escClose(e) { if (e.key === 'Escape') closePop(); }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.classList.contains('dui-select-open')) closePop();
    else openPop();
  });

  return {
    element: el,
    getValue: () => current,
    setValue: (v) => { current = v; paint(); syncCheckmarks(); },
    dispose: () => { closePop(); el.remove(); },
  };
}

/** Single push button. Accepts (label, onClick) or (label, opts) with { onClick, tooltip }. */
export function createButton(label, onClickOrOpts) {
  const opts = typeof onClickOrOpts === 'function'
    ? { onClick: onClickOrOpts }
    : (onClickOrOpts || {});
  const el = document.createElement('button');
  el.className = 'dui-btn';
  el.textContent = label;
  if (opts.tooltip) el.dataset.tooltip = opts.tooltip;
  el.addEventListener('click', () => opts.onClick?.(el));
  return {
    element: el,
    setLabel: (l) => { el.textContent = l; },
    setActive: (v) => el.classList.toggle('dui-active', !!v),
    dispose: () => el.remove(),
  };
}

/** Row of buttons. Each: { label, onClick, tooltip } */
export function createButtonRow(buttons) {
  const el = document.createElement('div');
  el.className = 'dui-btn-row';
  const handles = buttons.map(b => {
    const h = createButton(b.label, { onClick: b.onClick, tooltip: b.tooltip });
    el.appendChild(h.element);
    return h;
  });
  return {
    element: el,
    buttons: handles,
    dispose: () => el.remove(),
  };
}

/**
 * Animation trigger — hero-styled row with a label and a prominent play
 * icon. Clicking calls `onTrigger`. When `duration` is set, a thin
 * progress bar fills under the row for that many seconds so the user
 * can read at-a-glance whether the animation is still running.
 *
 * Use this when the host has a named animation it wants the designer
 * to fire from the panel — reveal animations, page transitions, scene
 * intros, etc. For continuous playback use the graph editor instead.
 *
 * Usage:
 *   folder.addTrigger('Reveal', {
 *     onTrigger: () => animateReveal(),
 *     duration: 1.2,
 *   });
 */
export function createTrigger(label, opts = {}) {
  const { onTrigger, duration, tooltip, icon } = opts;
  const safeLabel = String(label ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const playIcon = icon || `<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor"><path d="M232 128a8 8 0 0 1-4 7l-160 96a8 8 0 0 1-12-7V32a8 8 0 0 1 12-7l160 96a8 8 0 0 1 4 7Z"/></svg>`;
  const el = document.createElement('button');
  el.className = 'dui-trigger';
  el.type = 'button';
  if (tooltip) el.dataset.tooltip = tooltip;
  el.innerHTML = `
    <span class="dui-trigger-icon">${playIcon}</span>
    <span class="dui-trigger-label">${safeLabel}</span>
    <span class="dui-trigger-progress"><span class="dui-trigger-fill"></span></span>
  `;
  const fillEl = el.querySelector('.dui-trigger-fill');
  let playing = false;
  let timeoutId = null;

  function play() {
    // Re-clicking while playing should restart, not stack — feels right
    // for designers iterating ("oh wait, run it again").
    if (timeoutId) clearTimeout(timeoutId);
    playing = true;
    el.classList.add('dui-trigger-playing');
    try { onTrigger?.(); } catch (e) { console.error('[gizmo] trigger handler threw:', e); }
    if (duration && duration > 0) {
      // Width transition drives the progress fill — disable the
      // transition for the reset, then re-enable on next frame so the
      // browser doesn't optimise away the animation.
      fillEl.style.transition = 'none';
      fillEl.style.width = '0%';
      requestAnimationFrame(() => {
        fillEl.style.transition = `width ${duration}s linear`;
        fillEl.style.width = '100%';
      });
      timeoutId = setTimeout(() => {
        playing = false;
        el.classList.remove('dui-trigger-playing');
        fillEl.style.transition = 'none';
        fillEl.style.width = '0%';
        timeoutId = null;
      }, duration * 1000);
    } else {
      // No declared duration — just give a brief visual pulse so the
      // user knows the click registered.
      timeoutId = setTimeout(() => {
        playing = false;
        el.classList.remove('dui-trigger-playing');
        timeoutId = null;
      }, 280);
    }
  }
  el.addEventListener('click', (e) => { e.stopPropagation(); play(); });

  return {
    element: el,
    play,
    isPlaying: () => playing,
    setLabel: (l) => { el.querySelector('.dui-trigger-label').textContent = l; },
    setOnTrigger: (fn) => { opts.onTrigger = fn; },
    dispose: () => { if (timeoutId) clearTimeout(timeoutId); el.remove(); },
  };
}

/**
 * Sequence — a chain of named steps with prev / play / next controls.
 * Each step has an `onEnter` callback that fires when it becomes
 * active. Optional `onExit` fires when leaving. Dots above the buttons
 * show position; clicking a dot jumps to that step.
 *
 * This is the "demo flow" widget — useful for stepping through
 * narrative states of a scene (intro → reveal → CTA → end) without
 * wiring up the full timeline graph editor.
 *
 * Usage:
 *   folder.addSequence('Demo flow', {
 *     steps: [
 *       { name: 'Intro',  onEnter: () => fadeIn(),         duration: 0.5 },
 *       { name: 'Reveal', onEnter: () => animateReveal(),  duration: 1.2 },
 *       { name: 'CTA',    onEnter: () => showCallToAction() },
 *     ],
 *     loop: false,         // wraps next-after-last back to first
 *     startAt: 0,          // initial active step
 *   });
 */
export function createSequence(label, opts = {}) {
  const steps = Array.isArray(opts.steps) ? opts.steps : [];
  const loop = !!opts.loop;
  let idx = Math.max(0, Math.min(steps.length - 1, opts.startAt ?? 0));
  let timeoutId = null;
  let playing = false;

  const safeLabel = String(label ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = document.createElement('div');
  el.className = 'dui-sequence';
  const dotsHtml = steps.map((_, i) =>
    `<span class="dui-seq-dot${i === idx ? ' dui-seq-dot-active' : ''}" data-i="${i}"></span>`
  ).join('');
  el.innerHTML = `
    <div class="dui-sequence-header">
      <span class="dui-sequence-label">${safeLabel}</span>
      <span class="dui-sequence-pos"></span>
    </div>
    <div class="dui-sequence-step"></div>
    <div class="dui-sequence-dots">${dotsHtml}</div>
    <div class="dui-sequence-controls">
      <button type="button" class="dui-seq-btn dui-seq-prev" data-tooltip="Previous step">
        <!-- skip-back: vertical bar on the LEFT + triangle pointing LEFT -->
        <svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor">
          <rect x="40" y="32" width="16" height="192" rx="2"/>
          <path d="M216 36v184a8 8 0 0 1-12.4 6.7l-128-92a8 8 0 0 1 0-13.4l128-92A8 8 0 0 1 216 36Z"/>
        </svg>
      </button>
      <button type="button" class="dui-seq-btn dui-seq-replay" data-tooltip="Replay current">
        <!-- play: right-pointing triangle -->
        <svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor">
          <path d="M232 128a8 8 0 0 1-4 7l-160 96a8 8 0 0 1-12-7V32a8 8 0 0 1 12-7l160 96a8 8 0 0 1 4 7Z"/>
        </svg>
      </button>
      <button type="button" class="dui-seq-btn dui-seq-next" data-tooltip="Next step">
        <!-- skip-forward: triangle pointing RIGHT + vertical bar on the RIGHT -->
        <svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor">
          <path d="M40 36v184a8 8 0 0 0 12.4 6.7l128-92a8 8 0 0 0 0-13.4l-128-92A8 8 0 0 0 40 36Z"/>
          <rect x="200" y="32" width="16" height="192" rx="2"/>
        </svg>
      </button>
    </div>
  `;
  const stepEl = el.querySelector('.dui-sequence-step');
  const posEl  = el.querySelector('.dui-sequence-pos');
  const dotEls = el.querySelectorAll('.dui-seq-dot');

  function paint() {
    const step = steps[idx];
    stepEl.textContent = step?.name || '';
    posEl.textContent = steps.length ? `${idx + 1}/${steps.length}` : '0/0';
    dotEls.forEach((d, i) => d.classList.toggle('dui-seq-dot-active', i === idx));
  }
  paint();

  function fire(prev) {
    const step = steps[idx];
    if (!step) return;
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    // Exit hook on the previous step (e.g. cleanup tweens)
    try { steps[prev]?.onExit?.(); } catch (e) { console.error('[gizmo] sequence onExit threw:', e); }
    // Enter hook on the new step
    playing = true;
    el.classList.add('dui-sequence-playing');
    try { step.onEnter?.(); } catch (e) { console.error('[gizmo] sequence onEnter threw:', e); }
    if (step.duration && step.duration > 0) {
      timeoutId = setTimeout(() => {
        playing = false;
        el.classList.remove('dui-sequence-playing');
        timeoutId = null;
      }, step.duration * 1000);
    } else {
      timeoutId = setTimeout(() => {
        playing = false;
        el.classList.remove('dui-sequence-playing');
        timeoutId = null;
      }, 240);
    }
  }
  function goTo(nextIdx, { fireOnEnter = true } = {}) {
    if (nextIdx < 0 || nextIdx >= steps.length) return;
    const prev = idx;
    idx = nextIdx;
    paint();
    if (fireOnEnter) fire(prev);
  }
  function next() {
    if (idx + 1 < steps.length) goTo(idx + 1);
    else if (loop) goTo(0);
  }
  function prev() {
    if (idx > 0) goTo(idx - 1);
    else if (loop) goTo(steps.length - 1);
  }
  function replay() { fire(idx); }

  el.querySelector('.dui-seq-prev').addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  el.querySelector('.dui-seq-replay').addEventListener('click', (e) => { e.stopPropagation(); replay(); });
  el.querySelector('.dui-seq-next').addEventListener('click', (e) => { e.stopPropagation(); next(); });
  dotEls.forEach((d, i) => d.addEventListener('click', (e) => { e.stopPropagation(); goTo(i); }));

  return {
    element: el,
    next, prev, replay,
    goTo: (i) => goTo(i),
    currentStep: () => steps[idx],
    currentIndex: () => idx,
    isPlaying: () => playing,
    dispose: () => { if (timeoutId) clearTimeout(timeoutId); el.remove(); },
  };
}

/** File upload. Returns the File object to onChange. */
export function createFile(label, opts = {}) {
  const { accept = '*', onChange = () => {} } = opts;
  const lbl = document.createElement('label');
  lbl.className = 'dui-file-label';
  lbl.textContent = label;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept;
  input.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) onChange(f);
  });
  lbl.appendChild(input);
  return {
    element: lbl,
    clear: () => { input.value = ''; },
    dispose: () => lbl.remove(),
  };
}

/** Info text (read-only label). */
export function createInfo(text) {
  const el = document.createElement('div');
  el.className = 'dui-info';
  el.textContent = text;
  return {
    element: el,
    setText: (t) => { el.textContent = t; },
    setColor: (c) => { el.style.color = c; },
    dispose: () => el.remove(),
  };
}

/**
 * Blender-style number field — the iconic single-control widget where the
 * label and value sit inside a horizontal bar with a colored fill showing
 * progress. Drag horizontally to scrub the value. Click without dragging
 * to enter text-input mode.
 */
export function createBlenderField(label, opts = {}) {
  const {
    min = 0, max = 1, step = 0.01, value = 0,
    onChange = () => {},
  } = opts;

  const el = document.createElement('div');
  el.className = 'dui-bfield';
  el.innerHTML = `
    <span class="dui-bfield-arrow dui-bfield-arrow-l">◂</span>
    <span class="dui-bfield-label">${label}</span>
    <span class="dui-bfield-value"></span>
    <span class="dui-bfield-arrow dui-bfield-arrow-r">▸</span>
  `;
  const valueEl = el.querySelector('.dui-bfield-value');
  const leftArrow = el.querySelector('.dui-bfield-arrow-l');
  const rightArrow = el.querySelector('.dui-bfield-arrow-r');

  let current = parseFloat(value);
  const range = max - min;

  function decimalsFor(s) {
    const str = String(s);
    const i = str.indexOf('.');
    return i < 0 ? 0 : str.length - i - 1;
  }
  const decimals = decimalsFor(step);

  function update(fire = true) {
    current = Math.min(max, Math.max(min, current));
    // Round to step
    current = Math.round(current / step) * step;
    valueEl.textContent = current.toFixed(decimals);
    // Fill bar via background gradient
    const t = range > 0 ? (current - min) / range : 0;
    el.style.setProperty('--dui-bfield-fill', `${t * 100}%`);
    if (fire) onChange(current);
  }
  update(false);

  // Drag-to-scrub + click-to-edit
  let pressX = 0, pressed = false, dragging = false, startValue = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('dui-bfield-arrow')) return; // arrows handled separately
    pressed = true; dragging = false;
    pressX = e.clientX;
    startValue = current;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dui-bfield-dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    const dx = e.clientX - pressX;
    if (!dragging && Math.abs(dx) > 3) dragging = true;
    if (dragging) {
      // Drag sensitivity: full panel width drag = full range
      const sensitivity = range / 200;
      current = startValue + dx * sensitivity;
      update();
    }
  });
  el.addEventListener('pointerup', (e) => {
    pressed = false;
    el.classList.remove('dui-bfield-dragging');
    el.releasePointerCapture(e.pointerId);
    if (!dragging) {
      // Click without drag → enter text input mode
      enterTextMode();
    }
    dragging = false;
  });

  // Arrow buttons: increment / decrement
  leftArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    current -= step;
    update();
  });
  rightArrow.addEventListener('click', (e) => {
    e.stopPropagation();
    current += step;
    update();
  });

  function enterTextMode() {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = step; input.min = min; input.max = max;
    input.value = current.toFixed(decimals);
    input.className = 'dui-bfield-edit';
    el.appendChild(input);
    input.focus(); input.select();
    const commit = () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) { current = v; update(); }
      input.remove();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = current; input.blur(); }
    });
  }

  return {
    element: el,
    getValue: () => current,
    setValue: (v) => { current = parseFloat(v); update(false); },
    dispose: () => el.remove(),
  };
}

/** Vec3 — three sliders for x/y/z. */
export function createVec3(label, opts = {}) {
  const {
    min = -10, max = 10, step = 0.01,
    value = { x: 0, y: 0, z: 0 },
    onChange = () => {},
  } = opts;

  const wrap = document.createElement('div');
  if (label) {
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:10px;color:#888;padding:4px 0 2px;';
    lbl.textContent = label;
    wrap.appendChild(lbl);
  }

  const current = { x: value.x, y: value.y, z: value.z };
  function fire() { onChange({ ...current }); }
  const sx = createSlider('X', { min, max, step, value: current.x, onChange: v => { current.x = v; fire(); } });
  const sy = createSlider('Y', { min, max, step, value: current.y, onChange: v => { current.y = v; fire(); } });
  const sz = createSlider('Z', { min, max, step, value: current.z, onChange: v => { current.z = v; fire(); } });
  wrap.appendChild(sx.element);
  wrap.appendChild(sy.element);
  wrap.appendChild(sz.element);

  return {
    element: wrap,
    getValue: () => ({ ...current }),
    setValue: (v) => {
      current.x = v.x; current.y = v.y; current.z = v.z;
      sx.setValue(current.x);
      sy.setValue(current.y);
      sz.setValue(current.z);
    },
    dispose: () => wrap.remove(),
  };
}
