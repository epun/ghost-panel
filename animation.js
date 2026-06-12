/**
 * Animation graph editor — Blender-style F-Curve / Dope Sheet for keyframe
 * editing. Supports multiple tracks, draggable keyframes, transport controls,
 * and an optional "prompt" input for AI-driven edits.
 *
 * Concepts:
 *   Track     — a named property animated over time (e.g. "Camera.position.x")
 *   Keyframe  — { time, value, easing? } — a single sample point on a track
 *   F-Curve   — the interpolated path between keyframes (linear or bezier)
 *
 * Usage:
 *   const editor = createGraphEditor({
 *     tracks: [
 *       { name: 'cam.x', color: '#ff5050', keys: [
 *         { time: 0, value: 0 }, { time: 1, value: 5, easing: 'easeInOut' }
 *       ]},
 *       { name: 'cam.y', color: '#50ff50', keys: [...] },
 *     ],
 *     duration: 2.0,
 *     onUpdate: (time) => { ... },  // each frame while playing
 *     onPrompt: (text) => { ... },  // user typed in the prompt box
 *   });
 *   folder.addRaw(editor.element);
 *
 *   editor.sample('cam.x', 0.5);     // → interpolated value at t=0.5
 *   editor.addKey('cam.x', { time: 1.5, value: 10 });
 */

import { Folder } from './folder.js';
import { positionPopoverNear } from './controls.js';
import { icons } from './icons.js';
import { confirmDialog, alertDialog, promptDialog } from './modal.js';

// ── Math ────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp  = (a, b, t) => a + (b - a) * t;

// ── Property-path helpers (used by Track.writeTo to drive bound values) ──
// Supports dotted paths like 'position.y', 'material.color.r', 'rotation.x'.
// Three.js Vector3/Color have writable r/g/b/x/y/z so assignment works.
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}
function setByPath(obj, path, value) {
  if (!obj || !path) return;
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
    if (cur == null) return;
  }
  cur[parts[parts.length - 1]] = value;
}

// Standard easing functions (the user can also provide their own bezier curve)
const EASINGS = {
  linear:    t => t,
  easeIn:    t => t * t,
  easeOut:   t => 1 - (1 - t) ** 2,
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  hold:      () => 0,    // step (no interp until next key)
};

// ── Track ───────────────────────────────────────────────────────────────
class Track {
  constructor(opts) {
    this.name = opts.name;
    this.color = opts.color || '#cccccc';
    this.keys = (opts.keys || []).slice().sort((a, b) => a.time - b.time);
    this.visible = opts.visible !== false;
    this.locked = opts.locked || false;
    // Binding — when set, the editor writes sample(t) into this property
    // every frame the playhead moves. Path is dot-notation, e.g.:
    //   { object: cube, path: 'position.y' }
    //   { object: light, path: 'intensity' }
    //   { object: material, path: 'color.r' }
    this.binding = opts.binding || null;
  }
  addKey(key) { this.keys.push(key); this.keys.sort((a, b) => a.time - b.time); }
  removeKey(index) { this.keys.splice(index, 1); }

  /** Write current sample to the bound property, if any. */
  writeTo(t) {
    if (!this.binding?.object || !this.binding?.path) return;
    const value = this.sample(t);
    setByPath(this.binding.object, this.binding.path, value);
  }

  /** Sample value at time t, with the active interpolation. */
  sample(t) {
    if (this.keys.length === 0) return 0;
    if (t <= this.keys[0].time) return this.keys[0].value;
    if (t >= this.keys[this.keys.length - 1].time) return this.keys[this.keys.length - 1].value;
    for (let i = 0; i < this.keys.length - 1; i++) {
      const a = this.keys[i], b = this.keys[i + 1];
      if (t >= a.time && t <= b.time) {
        const local = (t - a.time) / (b.time - a.time);
        // Per-key bezier overrides named easing when present:
        //   key.bezier = [x1, y1, x2, y2]  (CSS cubic-bezier convention)
        if (Array.isArray(a.bezier) && a.bezier.length === 4) {
          return lerp(a.value, b.value, sampleBezier(local, a.bezier));
        }
        const ease = EASINGS[a.easing || 'easeInOut'] || EASINGS.linear;
        return lerp(a.value, b.value, ease(local));
      }
    }
    return this.keys[0].value;
  }
}

// ── Easing presets ──────────────────────────────────────────────────────
// CSS cubic-bezier control points: [x1, y1, x2, y2]. The first preset of
// each family matches the named EASINGS above so the UI is consistent.
export const EASING_PRESETS = [
  { id: 'linear',     label: 'Linear',     bezier: [0.0, 0.0, 1.0, 1.0] },
  { id: 'ease',       label: 'Ease',       bezier: [0.25, 0.1, 0.25, 1.0] },
  { id: 'ez-ease',    label: 'EZ Ease',    bezier: [0.4, 0.0, 0.2, 1.0] },
  { id: 'ease-in',    label: 'Ease In',    bezier: [0.42, 0.0, 1.0, 1.0] },
  { id: 'ease-out',   label: 'Ease Out',   bezier: [0.0, 0.0, 0.58, 1.0] },
  { id: 'ease-inout', label: 'Ease InOut', bezier: [0.42, 0.0, 0.58, 1.0] },
  { id: 'cubic-in',   label: 'Cubic In',   bezier: [0.55, 0.055, 0.675, 0.19] },
  { id: 'cubic-out',  label: 'Cubic Out',  bezier: [0.215, 0.61, 0.355, 1.0] },
  { id: 'cubic-inout',label: 'Cubic InOut',bezier: [0.645, 0.045, 0.355, 1.0] },
  { id: 'quad-in',    label: 'Quad In',    bezier: [0.55, 0.085, 0.68, 0.53] },
  { id: 'quad-out',   label: 'Quad Out',   bezier: [0.25, 0.46, 0.45, 0.94] },
  { id: 'back-out',   label: 'Back Out',   bezier: [0.175, 0.885, 0.32, 1.275] },
  { id: 'expo-out',   label: 'Expo Out',   bezier: [0.19, 1.0, 0.22, 1.0] },
  { id: 'sharp',      label: 'Sharp',      bezier: [0.9, 0.0, 0.1, 1.0] },
  { id: 'hold',       label: 'Hold',       bezier: [1.0, 0.0, 1.0, 0.0] },
];

// Cubic-bezier sampler — finds y given x via Newton iteration.
function bezierComponent(t, a, b) {
  // (1 - t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3, P0=0 P3=1
  return 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
}
function bezierDeriv(t, a, b) {
  return 3 * (1 - t) * (1 - t) * a
       + 6 * (1 - t) * t * (b - a)
       + 3 * t * t * (1 - b);
}
function sampleBezier(x, [x1, y1, x2, y2]) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const cx = bezierComponent(t, x1, x2) - x;
    if (Math.abs(cx) < 1e-4) break;
    const dx = bezierDeriv(t, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    t -= cx / dx;
  }
  return bezierComponent(t, y1, y2);
}

// ── Editor widget ───────────────────────────────────────────────────────
export function createGraphEditor(opts = {}) {
  const {
    tracks = [],
    duration = 2.0,
    height = 280,
    onUpdate = () => {},
    onChange = () => {},
    onPrompt = null,    // (text, helpers) => Promise|void
  } = opts;

  const root = document.createElement('div');
  root.className = 'dui-graph-editor';

  // ── Layout: header / [trackList | graph] / [transport / prompt] ──
  const header = document.createElement('div');
  header.className = 'dui-graph-header';
  header.innerHTML = `
    <button class="dui-graph-tab dui-active" data-mode="fcurve">F-Curve</button>
    <button class="dui-graph-tab" data-mode="dopesheet">Dope Sheet</button>
    <div class="dui-graph-spacer"></div>
    <button class="dui-graph-mini-btn" data-act="bindprop"
            data-tooltip="Bind a new track to a scene property (object + path)">+ Bind property</button>
    <button class="dui-graph-mini-btn" data-act="normalize"
            data-tooltip="Normalize all curves to fit [0..1]">Normalize</button>
    <button class="dui-graph-mini-btn" data-act="addtrack"
            data-tooltip="Add a new unbound track">+ Track</button>
  `;
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'dui-graph-body';
  root.appendChild(body);

  const trackListEl = document.createElement('div');
  trackListEl.className = 'dui-graph-tracks';
  body.appendChild(trackListEl);

  const graphWrap = document.createElement('div');
  graphWrap.className = 'dui-graph-canvas-wrap';
  body.appendChild(graphWrap);

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'dui-graph-svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  graphWrap.appendChild(svg);

  // Transport / prompt
  const footer = document.createElement('div');
  footer.className = 'dui-graph-footer';
  footer.innerHTML = `
    <button class="dui-graph-transport" data-act="jumpStart" data-tooltip="Jump to start">${icons.skipBack}</button>
    <button class="dui-graph-transport" data-act="prev" data-tooltip="Previous keyframe">${icons.caretLeft}</button>
    <button class="dui-graph-transport dui-graph-play" data-act="play" data-tooltip="Play / pause">${icons.play}</button>
    <button class="dui-graph-transport" data-act="next" data-tooltip="Next keyframe">${icons.caretRight}</button>
    <button class="dui-graph-transport" data-act="jumpEnd" data-tooltip="Jump to end">${icons.skipForward}</button>
    <span class="dui-graph-frame-info"></span>
  `;
  root.appendChild(footer);

  // ── Easing scratchpad ──
  // Shown only when a keyframe is selected. Lets the user pick from preset
  // easing curves or fine-tune the bezier via control points + tangent
  // handles on the F-curve itself.
  const scratchpad = document.createElement('div');
  scratchpad.className = 'dui-graph-scratchpad';
  scratchpad.style.display = 'none';
  scratchpad.innerHTML = `
    <div class="dui-graph-scratchpad-header">
      <span class="dui-graph-scratchpad-title">Key easing</span>
      <span class="dui-graph-scratchpad-info"></span>
    </div>
    <div class="dui-graph-scratchpad-body">
      <svg class="dui-graph-scratchpad-curve" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
      <!-- Dropdown trigger replaces the old grid of preset buttons. The
           full list lives in a popover so the scratchpad stays compact
           — we used to show ~17 buttons inline which dwarfed everything
           else in the panel. -->
      <div class="dui-easing-picker">
        <button class="dui-easing-trigger" type="button">
          <svg viewBox="0 0 24 24" class="dui-easing-trigger-preview" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.6"
                  d="M 2 22 C 8 22, 16 2, 22 2"/>
          </svg>
          <span class="dui-easing-trigger-label">Ease InOut</span>
          <svg viewBox="0 0 12 12" class="dui-easing-trigger-chevron" aria-hidden="true">
            <path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor"
                  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  root.appendChild(scratchpad);
  const padCurve     = scratchpad.querySelector('.dui-graph-scratchpad-curve');
  const padInfo      = scratchpad.querySelector('.dui-graph-scratchpad-info');
  const easingPicker = scratchpad.querySelector('.dui-easing-picker');
  const easingTrigger = easingPicker.querySelector('.dui-easing-trigger');
  const easingPreview = easingPicker.querySelector('.dui-easing-trigger-preview path');
  const easingLabel   = easingPicker.querySelector('.dui-easing-trigger-label');

  // Lazy-built popover with one row per preset. Opens on trigger click,
  // closes on outside click / Esc / pick.
  let easingPopover = null;
  function buildEasingPopover() {
    const pop = document.createElement('div');
    pop.className = 'dui-easing-popover';
    EASING_PRESETS.forEach(p => {
      const [x1, y1, x2, y2] = p.bezier;
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'dui-easing-option';
      opt.dataset.id = p.id;
      opt.innerHTML = `
        <svg viewBox="0 0 24 24" class="dui-easing-option-preview" aria-hidden="true">
          <path d="M 2 22 C ${2 + x1*20} ${22 - y1*20}, ${2 + x2*20} ${22 - y2*20}, 22 2"
                fill="none" stroke="currentColor" stroke-width="1.6"/>
        </svg>
        <span class="dui-easing-option-label">${p.label}</span>
      `;
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        applyPresetToSelection(p);
        closeEasingPopover();
      });
      pop.appendChild(opt);
    });
    return pop;
  }
  function positionEasingPopover() {
    if (!easingPopover) return;
    // Width is set first (the helper relies on offsetWidth/offsetHeight
    // to decide whether the popover fits below or needs to flip above).
    const r = easingTrigger.getBoundingClientRect();
    easingPopover.style.width = `${Math.max(r.width, 200)}px`;
    positionPopoverNear(easingPopover, easingTrigger, { gap: 4 });
  }
  function openEasingPopover() {
    if (!easingPopover) easingPopover = buildEasingPopover();
    document.body.appendChild(easingPopover);
    positionEasingPopover();
    easingPicker.classList.add('dui-open');
    syncEasingPopoverActive();
    setTimeout(() => {
      document.addEventListener('click', outsideClose, { capture: true });
      document.addEventListener('keydown', escClose);
      window.addEventListener('resize', positionEasingPopover);
      window.addEventListener('scroll', positionEasingPopover, true);
    }, 0);
  }
  function closeEasingPopover() {
    if (!easingPopover) return;
    easingPopover.remove();
    easingPicker.classList.remove('dui-open');
    document.removeEventListener('click', outsideClose, { capture: true });
    document.removeEventListener('keydown', escClose);
    window.removeEventListener('resize', positionEasingPopover);
    window.removeEventListener('scroll', positionEasingPopover, true);
  }
  function outsideClose(e) {
    if (!easingPopover) return;
    if (easingPopover.contains(e.target) || easingTrigger.contains(e.target)) return;
    closeEasingPopover();
  }
  function escClose(e) { if (e.key === 'Escape') closeEasingPopover(); }
  function syncEasingPopoverActive() {
    if (!easingPopover) return;
    const sel = state.selected;
    const key = sel && sel.keyIdx != null ? state.tracks[sel.trackIdx]?.keys[sel.keyIdx] : null;
    const activeId = key?.easing || '';
    easingPopover.querySelectorAll('.dui-easing-option').forEach(o => {
      o.classList.toggle('dui-active', o.dataset.id === activeId);
    });
  }
  easingTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (easingPicker.classList.contains('dui-open')) closeEasingPopover();
    else openEasingPopover();
  });

  function applyPresetToSelection(preset) {
    const sel = state.selected;
    if (!sel || sel.keyIdx == null) return;
    const track = state.tracks[sel.trackIdx];
    const key = track?.keys[sel.keyIdx];
    if (!key) return;
    key.bezier = preset.bezier.slice();
    key.easing = preset.id;
    renderScratchpad();
    render();
    applyBindings(state.time);
    onChange({ type: 'easing', track: track.name, preset: preset.id });
  }

  function renderScratchpad() {
    const sel = state.selected;
    if (!sel || sel.keyIdx == null) {
      scratchpad.style.display = 'none';
      return;
    }
    const track = state.tracks[sel.trackIdx];
    const key = track?.keys[sel.keyIdx];
    if (!key) { scratchpad.style.display = 'none'; return; }
    scratchpad.style.display = '';
    const bz = Array.isArray(key.bezier)
      ? key.bezier
      : (EASING_PRESETS.find(p => p.id === (key.easing || 'ease-inout'))?.bezier || [0.42, 0, 0.58, 1]);
    const [x1, y1, x2, y2] = bz;
    padInfo.textContent = `${track.name} · key ${sel.keyIdx + 1}/${track.keys.length} · cubic-bezier(${x1.toFixed(2)}, ${y1.toFixed(2)}, ${x2.toFixed(2)}, ${y2.toFixed(2)})`;
    // Big curve preview (y is inverted so up = increasing value)
    const points = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      const x = 100 * bezierComponent(t, x1, x2);
      const y = 100 - 100 * bezierComponent(t, y1, y2);
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    padCurve.innerHTML = `
      <line x1="0" y1="100" x2="100" y2="0" class="dui-graph-scratchpad-diag" />
      <polyline points="${points.join(' ')}" class="dui-graph-scratchpad-line" />
      <line x1="0" y1="100" x2="${(x1*100).toFixed(2)}" y2="${(100 - y1*100).toFixed(2)}" class="dui-graph-scratchpad-tan"/>
      <line x1="100" y1="0" x2="${(x2*100).toFixed(2)}" y2="${(100 - y2*100).toFixed(2)}" class="dui-graph-scratchpad-tan"/>
      <circle cx="${(x1*100).toFixed(2)}" cy="${(100 - y1*100).toFixed(2)}" r="3" class="dui-graph-scratchpad-cp" data-cp="1"/>
      <circle cx="${(x2*100).toFixed(2)}" cy="${(100 - y2*100).toFixed(2)}" r="3" class="dui-graph-scratchpad-cp" data-cp="2"/>
    `;
    // Sync the easing dropdown trigger (label + mini curve preview) to
    // match the current keyframe. Also refresh the popover's active row
    // if it happens to be open.
    const matched = EASING_PRESETS.find(p => p.id === (key.easing || '')) || null;
    easingLabel.textContent = matched ? matched.label : 'Custom';
    easingPreview.setAttribute('d',
      `M 2 22 C ${2 + x1*20} ${22 - y1*20}, ${2 + x2*20} ${22 - y2*20}, 22 2`);
    syncEasingPopoverActive();
    // Drag the two control points
    padCurve.querySelectorAll('.dui-graph-scratchpad-cp').forEach(cp => {
      cp.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        cp.setPointerCapture(e.pointerId);
        const which = +cp.dataset.cp;
        const rect = padCurve.getBoundingClientRect();
        const move = (ev) => {
          const nx = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
          const ny = clamp(1 - (ev.clientY - rect.top) / rect.height, -0.5, 1.5);
          if (!Array.isArray(key.bezier)) key.bezier = bz.slice();
          if (which === 1) { key.bezier[0] = nx; key.bezier[1] = ny; }
          else             { key.bezier[2] = nx; key.bezier[3] = ny; }
          key.easing = 'custom';
          renderScratchpad();
          render();
          applyBindings(state.time);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          onChange({ type: 'easing', track: track.name, bezier: key.bezier });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
  }

  // Optional prompt input
  let promptEl = null;
  if (onPrompt) {
    promptEl = document.createElement('div');
    promptEl.className = 'dui-graph-prompt';
    promptEl.innerHTML = `
      <input type="text" placeholder="Describe a change…  e.g. ‘ease the camera into frame from the right over 2s’" />
      <button class="dui-btn" data-tooltip="Apply prompt to the selected tracks">Apply</button>
    `;
    root.appendChild(promptEl);
  }

  // ── State ──
  const state = {
    duration,
    time: 0,
    playing: false,
    mode: 'fcurve',           // 'fcurve' | 'dopesheet'
    tracks: tracks.map(t => new Track(t)),
    selected: null,           // { trackIdx, keyIdx }
    viewMinT: 0,
    viewMaxT: duration,
    pan: 0,
    zoom: 1,
  };

  // ── Render functions ──
  function timeToX(t, w) {
    return ((t - state.viewMinT) / (state.viewMaxT - state.viewMinT)) * w;
  }
  function xToTime(x, w) {
    return state.viewMinT + (x / w) * (state.viewMaxT - state.viewMinT);
  }
  function valueToY(v, minV, maxV, h) {
    const range = maxV - minV || 1;
    return h - ((v - minV) / range) * (h * 0.8) - (h * 0.1);
  }
  function valueRange() {
    let min = Infinity, max = -Infinity;
    state.tracks.forEach(t => t.keys.forEach(k => {
      if (k.value < min) min = k.value;
      if (k.value > max) max = k.value;
    }));
    if (min === Infinity) { min = 0; max = 1; }
    if (min === max) { min -= 0.5; max += 0.5; }
    return [min, max];
  }

  function renderTrackList() {
    trackListEl.innerHTML = '';
    state.tracks.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'dui-graph-track' + (state.selected?.trackIdx === i ? ' dui-active' : '');
      const bindingLabel = t.binding?.path
        ? `<span class="dui-graph-track-binding" data-tooltip="Bound to ${t.binding.object?.name || 'object'}.${t.binding.path}">→ ${t.binding.path}</span>`
        : `<span class="dui-graph-track-binding dui-graph-track-unbound" data-tooltip="Not bound to any property">unbound</span>`;
      row.innerHTML = `
        <span class="dui-graph-track-color" style="background:${t.color}"
              data-tooltip="Change color"></span>
        <button class="dui-graph-track-vis"
                data-tooltip="${t.visible ? 'Hide curve' : 'Show curve'}">${t.visible ? icons.eye : icons.eyeSlash}</button>
        <div class="dui-graph-track-meta">
          <span class="dui-graph-track-name" data-tooltip="Double-click to rename">${t.name}</span>
          ${bindingLabel}
        </div>
        <button class="dui-graph-track-action dui-graph-track-addkey"
                data-tooltip="Add keyframe at playhead">◆</button>
        <button class="dui-graph-track-action dui-graph-track-del"
                data-tooltip="Delete track">×</button>
      `;

      // Select track on row click
      row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.classList.contains('dui-graph-track-color')) return;
        state.selected = { trackIdx: i, keyIdx: null };
        renderTrackList(); render();
      });

      // Visibility toggle
      row.querySelector('.dui-graph-track-vis').addEventListener('click', (e) => {
        e.stopPropagation();
        t.visible = !t.visible;
        renderTrackList(); render();
        onChange({ type: 'visibility', track: t.name });
      });

      // Add keyframe at current playhead.
      // For BOUND tracks, capture the property's LIVE value (so the user
      // can drag/scale/rotate the object and key the new pose). For unbound
      // tracks, fall back to sampling the curve.
      row.querySelector('.dui-graph-track-addkey').addEventListener('click', (e) => {
        e.stopPropagation();
        const live = t.binding?.object && t.binding?.path
          ? getByPath(t.binding.object, t.binding.path)
          : undefined;
        const value = (typeof live === 'number') ? live : t.sample(state.time);
        t.addKey({ time: state.time, value, easing: 'easeInOut' });
        state.selected = { trackIdx: i, keyIdx: t.keys.findIndex(k => k.time === state.time) };
        renderTrackList(); render(); renderScratchpad();
        onChange({ type: 'add', track: t.name });
      });

      // Delete track
      row.querySelector('.dui-graph-track-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog(`The track and all of its keyframes will be removed.`, {
          title: `Delete "${t.name}"?`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        state.tracks.splice(i, 1);
        if (state.selected?.trackIdx === i) state.selected = null;
        renderTrackList(); render();
        onChange({ type: 'deleteTrack', track: t.name });
      });

      // Color picker — click swatch to open color input
      const colorEl = row.querySelector('.dui-graph-track-color');
      colorEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'color';
        input.value = t.color;
        input.style.position = 'fixed';
        input.style.left = '-1000px';
        document.body.appendChild(input);
        input.addEventListener('input', () => {
          t.color = input.value;
          renderTrackList(); render();
        });
        input.addEventListener('change', () => input.remove());
        input.click();
      });

      // Double-click name → rename (styled modal, not window.prompt())
      const nameEl = row.querySelector('.dui-graph-track-name');
      nameEl.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const newName = await promptDialog('Rename track', {
          defaultValue: t.name,
          confirmLabel: 'Rename',
        });
        if (newName && newName.trim()) {
          t.name = newName.trim();
          renderTrackList();
        }
      });

      trackListEl.appendChild(row);
    });
  }

  function render() {
    const rect = graphWrap.getBoundingClientRect();
    const w = Math.max(rect.width, 100);
    const h = Math.max(rect.height, 80);
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = '';

    // ── Grid ──
    const [vMin, vMax] = valueRange();
    const gridG = document.createElementNS(SVG_NS, 'g');
    gridG.setAttribute('class', 'dui-graph-grid');
    // Vertical time gridlines (every ~80px)
    const tStep = Math.max(0.1, (state.viewMaxT - state.viewMinT) / (w / 80));
    for (let t = Math.ceil(state.viewMinT / tStep) * tStep; t <= state.viewMaxT; t += tStep) {
      const x = timeToX(t, w);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      line.setAttribute('y1', 0); line.setAttribute('y2', h);
      gridG.appendChild(line);
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', x + 3); label.setAttribute('y', 12);
      label.setAttribute('class', 'dui-graph-tick');
      label.textContent = t.toFixed(2);
      gridG.appendChild(label);
    }
    // Horizontal zero line
    if (state.mode === 'fcurve') {
      const zeroLine = document.createElementNS(SVG_NS, 'line');
      const y = valueToY(0, vMin, vMax, h);
      zeroLine.setAttribute('x1', 0); zeroLine.setAttribute('x2', w);
      zeroLine.setAttribute('y1', y); zeroLine.setAttribute('y2', y);
      zeroLine.setAttribute('class', 'dui-graph-zero');
      gridG.appendChild(zeroLine);
    }
    svg.appendChild(gridG);

    // ── F-curves or dope sheet rows ──
    state.tracks.forEach((track, ti) => {
      if (!track.visible) return;

      if (state.mode === 'fcurve') {
        // Draw line between keyframes (sampled at 80 points)
        const path = document.createElementNS(SVG_NS, 'path');
        let d = '';
        const samples = 80;
        for (let i = 0; i <= samples; i++) {
          const t = state.viewMinT + (i / samples) * (state.viewMaxT - state.viewMinT);
          const v = track.sample(t);
          const x = timeToX(t, w);
          const y = valueToY(v, vMin, vMax, h);
          d += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
        }
        path.setAttribute('d', d);
        path.setAttribute('class', 'dui-graph-curve');
        path.setAttribute('stroke', track.color);
        svg.appendChild(path);

        // Keyframe diamonds + (when selected) tangent handles
        track.keys.forEach((k, ki) => {
          const x = timeToX(k.time, w);
          const y = valueToY(k.value, vMin, vMax, h);

          // If this key is selected and has a next key, draw bezier handles
          // for the outgoing segment.
          const isSelected = state.selected?.trackIdx === ti && state.selected?.keyIdx === ki;
          if (isSelected && state.mode === 'fcurve' && ki < track.keys.length - 1) {
            const nextK = track.keys[ki + 1];
            const nx = timeToX(nextK.time, w);
            const ny = valueToY(nextK.value, vMin, vMax, h);
            const bz = Array.isArray(k.bezier)
              ? k.bezier
              : (EASING_PRESETS.find(p => p.id === (k.easing || 'ease-inout'))?.bezier || [0.42, 0, 0.58, 1]);
            const [bx1, by1, bx2, by2] = bz;
            // Convert local bezier (0..1) to graph coords. Y axis: bezier y maps
            // to the value transition from k.value → nextK.value.
            const seg = (lx, ly) => ({
              x: x + (nx - x) * lx,
              y: y + (ny - y) * ly,
            });
            const h1 = seg(bx1, by1);
            const h2 = seg(bx2, by2);
            // Lines
            const l1 = document.createElementNS(SVG_NS, 'line');
            l1.setAttribute('x1', x); l1.setAttribute('y1', y);
            l1.setAttribute('x2', h1.x); l1.setAttribute('y2', h1.y);
            l1.setAttribute('class', 'dui-graph-tangent-line');
            svg.appendChild(l1);
            const l2 = document.createElementNS(SVG_NS, 'line');
            l2.setAttribute('x1', nx); l2.setAttribute('y1', ny);
            l2.setAttribute('x2', h2.x); l2.setAttribute('y2', h2.y);
            l2.setAttribute('class', 'dui-graph-tangent-line');
            svg.appendChild(l2);
            // Handle dots
            [{ pt: h1, idx: 0 }, { pt: h2, idx: 1 }].forEach(({ pt, idx }) => {
              const handle = document.createElementNS(SVG_NS, 'circle');
              handle.setAttribute('cx', pt.x); handle.setAttribute('cy', pt.y);
              handle.setAttribute('r', 5);
              handle.setAttribute('class', 'dui-graph-tangent-handle');
              handle.setAttribute('fill', track.color);
              attachTangentDrag(handle, ti, ki, idx, x, y, nx, ny);
              svg.appendChild(handle);
            });
          }

          const dot = document.createElementNS(SVG_NS, 'rect');
          dot.setAttribute('x', x - 5); dot.setAttribute('y', y - 5);
          dot.setAttribute('width', 10); dot.setAttribute('height', 10);
          dot.setAttribute('transform', `rotate(45 ${x} ${y})`);
          dot.setAttribute('class', 'dui-graph-key' + (isSelected ? ' dui-active' : ''));
          dot.setAttribute('fill', track.color);
          dot.dataset.trackIdx = ti;
          dot.dataset.keyIdx = ki;
          attachKeyDrag(dot, ti, ki);
          svg.appendChild(dot);
        });
      } else {
        // Dope sheet: one row per track, keys as dots
        const rowH = (h - 24) / Math.max(state.tracks.length, 1);
        const y = 24 + ti * rowH + rowH / 2;
        const baseLine = document.createElementNS(SVG_NS, 'line');
        baseLine.setAttribute('x1', 0); baseLine.setAttribute('x2', w);
        baseLine.setAttribute('y1', y); baseLine.setAttribute('y2', y);
        baseLine.setAttribute('class', 'dui-graph-dope-line');
        baseLine.setAttribute('stroke', track.color);
        svg.appendChild(baseLine);
        track.keys.forEach((k, ki) => {
          const x = timeToX(k.time, w);
          const dot = document.createElementNS(SVG_NS, 'rect');
          dot.setAttribute('x', x - 5); dot.setAttribute('y', y - 5);
          dot.setAttribute('width', 10); dot.setAttribute('height', 10);
          dot.setAttribute('transform', `rotate(45 ${x} ${y})`);
          dot.setAttribute('class', 'dui-graph-key' + (state.selected?.trackIdx === ti && state.selected?.keyIdx === ki ? ' dui-active' : ''));
          dot.setAttribute('fill', track.color);
          attachKeyDrag(dot, ti, ki);
          svg.appendChild(dot);
        });
      }
    });

    // ── Playhead ──
    const px = timeToX(state.time, w);
    const playLine = document.createElementNS(SVG_NS, 'line');
    playLine.setAttribute('x1', px); playLine.setAttribute('x2', px);
    playLine.setAttribute('y1', 0);  playLine.setAttribute('y2', h);
    playLine.setAttribute('class', 'dui-graph-playhead');
    svg.appendChild(playLine);

    const playLabel = document.createElementNS(SVG_NS, 'rect');
    playLabel.setAttribute('x', px - 18); playLabel.setAttribute('y', 0);
    playLabel.setAttribute('width', 36); playLabel.setAttribute('height', 14);
    playLabel.setAttribute('class', 'dui-graph-playhead-label-bg');
    svg.appendChild(playLabel);

    const playText = document.createElementNS(SVG_NS, 'text');
    playText.setAttribute('x', px); playText.setAttribute('y', 11);
    playText.setAttribute('text-anchor', 'middle');
    playText.setAttribute('class', 'dui-graph-playhead-label');
    playText.textContent = state.time.toFixed(2);
    svg.appendChild(playText);

    // Update frame info
    footer.querySelector('.dui-graph-frame-info').textContent =
      `${state.time.toFixed(2)} / ${state.duration.toFixed(2)}s`;
  }

  // ── Keyframe drag interaction ──
  function attachKeyDrag(dotEl, ti, ki) {
    let dragging = false, startX = 0, startY = 0, startTime = 0, startValue = 0;
    dotEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const key = state.tracks[ti].keys[ki];
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startTime = key.time; startValue = key.value;
      state.selected = { trackIdx: ti, keyIdx: ki };
      dotEl.setPointerCapture(e.pointerId);
      renderTrackList();
      renderScratchpad();
      render();
    });
    dotEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = graphWrap.getBoundingClientRect();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dt = (dx / rect.width) * (state.viewMaxT - state.viewMinT);
      const key = state.tracks[ti].keys[ki];
      key.time = clamp(startTime + dt, 0, state.duration);
      if (state.mode === 'fcurve') {
        const [vMin, vMax] = valueRange();
        const dv = -(dy / rect.height) * (vMax - vMin);
        key.value = startValue + dv;
      }
      state.tracks[ti].keys.sort((a, b) => a.time - b.time);
      // Find the new index after sort
      state.selected.keyIdx = state.tracks[ti].keys.indexOf(key);
      render();
      // Editing a key should immediately update the bound property so the
      // canvas reacts even when the playhead isn't moving.
      applyBindings(state.time);
      onChange({ type: 'move', track: state.tracks[ti].name, key });
    });
    dotEl.addEventListener('pointerup', (e) => {
      dragging = false;
      try { dotEl.releasePointerCapture(e.pointerId); } catch {}
    });
    // Double-click to delete
    dotEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      state.tracks[ti].keys.splice(ki, 1);
      state.selected = null;
      render();
      renderScratchpad();
      onChange({ type: 'delete', track: state.tracks[ti].name });
    });
  }

  // ── Tangent handle drag (selected F-curve key only) ──
  function attachTangentDrag(handleEl, ti, ki, idx, kx, ky, nx, ny) {
    handleEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handleEl.setPointerCapture(e.pointerId);
      const key = state.tracks[ti].keys[ki];
      const fallback = (EASING_PRESETS.find(p => p.id === (key.easing || 'ease-inout'))?.bezier
                      || [0.42, 0, 0.58, 1]);
      if (!Array.isArray(key.bezier)) key.bezier = fallback.slice();
      const onMove = (ev) => {
        // Map screen position back to local 0..1 bezier coords.
        const lx = clamp((ev.clientX - kx) / Math.max(1, (nx - kx)), -0.2, 1.2);
        const ly = (ev.clientY - ky) / Math.max(1, (ny - ky));
        // Note: SVG y grows down; "ly" already inherits that, but bezier y
        // is meant in value-space — and we computed it relative to (ky, ny)
        // so it auto-matches the segment direction. Clamp loosely.
        const cl = clamp(ly, -0.5, 1.5);
        if (idx === 0) { key.bezier[0] = lx; key.bezier[1] = cl; }
        else           { key.bezier[2] = lx; key.bezier[3] = cl; }
        key.easing = 'custom';
        render();
        renderScratchpad();
        applyBindings(state.time);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        onChange({ type: 'easing', track: state.tracks[ti].name, bezier: key.bezier });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // ── Click on graph to add a key OR scrub ──
  svg.addEventListener('pointerdown', (e) => {
    if (e.target !== svg) return;       // ignore clicks on inner elements
    const rect = graphWrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = xToTime(x, rect.width);
    if (e.shiftKey && state.selected?.trackIdx != null) {
      // Shift+click → add a keyframe at this time on the selected track.
      // Capture the LIVE bound value so manual gizmo edits stick.
      const ti = state.selected.trackIdx;
      const track = state.tracks[ti];
      const live = track.binding?.object && track.binding?.path
        ? getByPath(track.binding.object, track.binding.path)
        : undefined;
      const v = (typeof live === 'number') ? live : track.sample(t);
      track.addKey({ time: t, value: v });
      render();
      onChange({ type: 'add', track: track.name });
    } else {
      // Plain click → scrub playhead
      setTime(t);
    }
  });

  // ── Header tabs ──
  header.querySelectorAll('.dui-graph-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      header.querySelectorAll('.dui-graph-tab').forEach(b =>
        b.classList.toggle('dui-active', b === btn));
      render();
    });
  });
  header.querySelector('[data-act="addtrack"]').addEventListener('click', () => {
    state.tracks.push(new Track({
      name: `track.${state.tracks.length + 1}`,
      color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
      keys: [{ time: 0, value: 0 }, { time: state.duration, value: 1 }],
    }));
    renderTrackList(); render();
  });

  // ── + Bind property ──
  // Opens a picker that lets the user choose a registered object and a
  // dotted property path (e.g. position.y, intensity, material.color.r).
  // Creates a new track pre-bound to that property, seeded with the
  // current value at both ends of the timeline.
  header.querySelector('[data-act="bindprop"]').addEventListener('click', async () => {
    if (!opts.getBindableTargets) {
      await alertDialog(
        'Pass `getBindableTargets()` to the graph editor, or use editor.addTrackBound(...) programmatically.',
        { title: 'No bindable targets' });
      return;
    }
    const targets = opts.getBindableTargets();
    if (!targets?.length) {
      await alertDialog('There are no objects in the scene to bind a track to.',
        { title: 'No bindable objects' });
      return;
    }
    openBindPicker(targets);
  });

  function openBindPicker(targets) {
    // Default to whatever the user currently has selected, if anything.
    const selectedName = opts.getSelected?.();
    const defaultIdx = Math.max(0, targets.findIndex(t => t.name === selectedName));

    const pop = document.createElement('div');
    pop.className = 'dui-bind-popup dui-visible';
    pop.innerHTML = `
      <div class="dui-bind-popup-header">
        <div class="dui-bind-popup-title">Bind track to property</div>
        <select class="dui-bind-popup-object"></select>
      </div>
      <div class="dui-bind-popup-search-wrap">
        <input class="dui-bind-popup-search" placeholder="Search property…  (position.y, x, intensity, color.r)" autocomplete="off" spellcheck="false" />
      </div>
      <div class="dui-bind-popup-list"></div>
      <div class="dui-bind-popup-footer">
        <span><kbd>↑↓</kbd> navigate</span>
        <span><kbd>↵</kbd> bind</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    `;
    document.body.appendChild(pop);

    const sel    = pop.querySelector('.dui-bind-popup-object');
    const search = pop.querySelector('.dui-bind-popup-search');
    const list   = pop.querySelector('.dui-bind-popup-list');

    targets.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = t.name || `target_${i}`;
      sel.appendChild(opt);
    });
    sel.value = String(defaultIdx);

    let selectedRow = 0;
    let visiblePaths = [];

    function currentTarget() { return targets[+sel.value]; }

    function renderList() {
      const target = currentTarget()?.object;
      if (!target) { list.innerHTML = ''; return; }
      const q = search.value.trim().toLowerCase();
      const all = inferNumericPaths(target);
      visiblePaths = q ? all.filter(p => p.toLowerCase().includes(q)) : all;
      if (q && !visiblePaths.includes(q)) visiblePaths.unshift(q); // free-form path always available
      if (selectedRow >= visiblePaths.length) selectedRow = Math.max(0, visiblePaths.length - 1);

      list.innerHTML = visiblePaths.map((p, i) => {
        const v = getByPath(target, p);
        const valStr = typeof v === 'number'
          ? v.toFixed(Math.abs(v) < 1 ? 3 : 2)
          : (v === undefined ? '<i>n/a</i>' : '—');
        const cls = (typeof v !== 'number') ? ' dui-disabled' : '';
        return `<div class="dui-bind-popup-item${i === selectedRow ? ' dui-active' : ''}${cls}" data-idx="${i}">
            <span class="dui-bind-popup-path">${p}</span>
            <span class="dui-bind-popup-value">${valStr}</span>
          </div>`;
      }).join('');
      list.querySelectorAll('.dui-bind-popup-item').forEach((row, i) => {
        row.addEventListener('mouseenter', () => { selectedRow = i; highlight(); });
        row.addEventListener('click', () => { selectedRow = i; commit(); });
      });
    }

    function highlight() {
      list.querySelectorAll('.dui-bind-popup-item').forEach((r, i) =>
        r.classList.toggle('dui-active', i === selectedRow));
      const active = list.children[selectedRow];
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function commit() {
      const target = currentTarget();
      const p = visiblePaths[selectedRow];
      if (!target || !p) return;
      const obj = target.object;
      const initial = getByPath(obj, p);
      if (typeof initial !== 'number') return;   // disabled rows are no-ops
      state.tracks.push(new Track({
        name: `${target.name}.${p}`,
        color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
        binding: { object: obj, path: p },
        keys: [{ time: 0, value: initial }, { time: state.duration, value: initial }],
      }));
      renderTrackList(); render();
      onChange({ type: 'add', track: `${target.name}.${p}` });
      close();
    }

    function close() {
      pop.remove();
      document.removeEventListener('click', onDocClick, true);
    }
    function onDocClick(e) { if (!pop.contains(e.target)) close(); }

    sel.addEventListener('change', renderList);
    search.addEventListener('input', () => { selectedRow = 0; renderList(); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter')  { e.preventDefault(); commit(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (visiblePaths.length) { selectedRow = (selectedRow + 1) % visiblePaths.length; highlight(); }
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (visiblePaths.length) { selectedRow = (selectedRow - 1 + visiblePaths.length) % visiblePaths.length; highlight(); }
      }
    });

    renderList();
    setTimeout(() => {
      search.focus();
      document.addEventListener('click', onDocClick, true);
    }, 0);
  }

  /**
   * Scan an object for numeric properties up to depth 3, ranked by
   * "animation usefulness". Covers Three.js conventions (position.x,
   * material.color.r, intensity) AND arbitrary plain-JS objects (the 2D
   * canvas demo's circles have flat `x`, `y`, `hue`, etc.).
   */
  function inferNumericPaths(obj) {
    // Curated paths first — these always rank highest if present.
    const PRIORITY = [
      'position.x','position.y','position.z',
      'rotation.x','rotation.y','rotation.z',
      'scale.x','scale.y','scale.z',
      'intensity','distance','angle','penumbra',
      'fov','near','far','zoom',
      'opacity','radius','width','height',
      'x','y','z','hue','alpha',
      'material.opacity','material.roughness','material.metalness','material.emissiveIntensity',
      'material.color.r','material.color.g','material.color.b',
      'color.r','color.g','color.b',
    ];

    const found = new Set();
    const skipKey = (k) =>
      k.startsWith('_') || k === 'parent' || k === 'children' || k === 'userData'
      || k === 'geometry' || k === 'matrix' || k === 'matrixWorld'
      || k === 'modelViewMatrix' || k === 'normalMatrix'
      || k === 'projectionMatrix' || k === 'projectionMatrixInverse'
      || k === 'matrixWorldInverse' || k === 'uuid' || k === 'id'
      || k === 'layers' || k === 'animations';

    function walk(node, path, depth) {
      if (!node || depth > 3) return;
      if (typeof node !== 'object') return;
      for (const k of Object.keys(node)) {
        if (skipKey(k)) continue;
        const v = node[k];
        const p = path ? `${path}.${k}` : k;
        if (typeof v === 'number' && Number.isFinite(v)) {
          found.add(p);
        } else if (v && typeof v === 'object' && depth < 3
                   && !(v instanceof HTMLElement)
                   && !(typeof Node !== 'undefined' && v instanceof Node)) {
          walk(v, p, depth + 1);
        }
      }
    }
    walk(obj, '', 0);

    // Always surface curated paths that actually exist; everything else after.
    const ranked = [];
    PRIORITY.forEach(p => { if (found.has(p)) { ranked.push(p); found.delete(p); } });
    [...found].sort().forEach(p => ranked.push(p));
    return ranked;
  }
  header.querySelector('[data-act="normalize"]').addEventListener('click', () => {
    state.tracks.forEach(t => {
      const vs = t.keys.map(k => k.value);
      if (!vs.length) return;
      const min = Math.min(...vs), max = Math.max(...vs);
      const range = max - min || 1;
      t.keys.forEach(k => { k.value = (k.value - min) / range; });
    });
    render();
  });

  // ── Transport ──
  let playRAF = null;
  let lastFrame = 0;
  function play()  {
    if (state.playing) return;
    state.playing = true;
    footer.querySelector('.dui-graph-play').innerHTML = icons.pause;
    lastFrame = 0;
    const tick = (now) => {
      if (!state.playing) return;
      if (lastFrame === 0) lastFrame = now;
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      let t = state.time + dt;
      if (t > state.duration) t = t % state.duration;
      setTime(t);
      applyBindings(t);
      onUpdate(t, sampleAll(t));
      playRAF = requestAnimationFrame(tick);
    };
    playRAF = requestAnimationFrame(tick);
  }
  function pause() {
    state.playing = false;
    footer.querySelector('.dui-graph-play').innerHTML = icons.play;
    if (playRAF) cancelAnimationFrame(playRAF);
  }
  function setTime(t, fire = true) {
    state.time = clamp(t, 0, state.duration);
    render();
    applyBindings(state.time);     // canvas reacts immediately on scrub/drag
    if (fire) onChange({ type: 'time', time: state.time });
    if (fire) onUpdate(state.time, sampleAll(state.time));
  }

  /**
   * Walk every track and, if it has a binding, write its current sample
   * to the bound property. Called from setTime (scrub/drag) and from the
   * playback tick, so the canvas reflects the graph editor in real time.
   */
  function applyBindings(t) {
    state.tracks.forEach(track => track.writeTo(t));
  }

  footer.querySelector('[data-act="play"]').addEventListener('click', () =>
    state.playing ? pause() : play());
  footer.querySelector('[data-act="jumpStart"]').addEventListener('click', () => setTime(0));
  footer.querySelector('[data-act="jumpEnd"]').addEventListener('click', () => setTime(state.duration));
  footer.querySelector('[data-act="prev"]').addEventListener('click', () => {
    // Jump to previous keyframe across all visible tracks
    const allTimes = state.tracks
      .filter(t => t.visible)
      .flatMap(t => t.keys.map(k => k.time))
      .sort((a, b) => a - b);
    const prev = allTimes.filter(t => t < state.time - 0.01).pop();
    if (prev !== undefined) setTime(prev);
  });
  footer.querySelector('[data-act="next"]').addEventListener('click', () => {
    const allTimes = state.tracks
      .filter(t => t.visible)
      .flatMap(t => t.keys.map(k => k.time))
      .sort((a, b) => a - b);
    const next = allTimes.find(t => t > state.time + 0.01);
    if (next !== undefined) setTime(next);
  });

  // ── Prompt input ──
  if (promptEl && onPrompt) {
    const input = promptEl.querySelector('input');
    const btn = promptEl.querySelector('button');
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      btn.textContent = '…';
      try {
        await onPrompt(text, {
          tracks: state.tracks,
          duration: state.duration,
          addTrack: (t) => { state.tracks.push(new Track(t)); renderTrackList(); render(); },
          setKeys: (trackName, keys) => {
            const track = state.tracks.find(t => t.name === trackName);
            if (track) { track.keys = keys.slice().sort((a, b) => a.time - b.time); render(); }
          },
        });
      } finally {
        btn.textContent = 'Apply';
      }
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  // ── Init render + re-render on resize ──
  function sampleAll(t) {
    const out = {};
    state.tracks.forEach(track => { out[track.name] = track.sample(t); });
    return out;
  }

  renderTrackList();
  requestAnimationFrame(render);   // wait for DOM layout
  const ro = new ResizeObserver(() => render());
  ro.observe(graphWrap);

  // The f-curve area itself stays at the requested fixed `height` regardless
  // of whether the easing scratchpad is shown — the scratchpad simply
  // extends the editor's total height below it. This preserves the user's
  // working area while a key is selected.
  body.style.height = `${height}px`;
  body.style.flexShrink = '0';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';

  return {
    element: root,
    /** Sample a track at time t. */
    sample(trackName, t) {
      const tr = state.tracks.find(x => x.name === trackName);
      return tr ? tr.sample(t) : null;
    },
    sampleAll,
    addTrack(opts) { state.tracks.push(new Track(opts)); renderTrackList(); render(); },
    removeTrack(name) {
      const i = state.tracks.findIndex(t => t.name === name);
      if (i >= 0) state.tracks.splice(i, 1);
      renderTrackList(); render();
    },
    /**
     * Drop every track bound to the given object reference. Called by the
     * animation workflow when the Outliner deletes an object so that the
     * dopesheet, f-curve, and binding picker all stay in sync.
     */
    pruneTracksFor(object) {
      if (!object) return 0;
      let removed = 0;
      for (let i = state.tracks.length - 1; i >= 0; i--) {
        if (state.tracks[i].binding?.object === object) {
          state.tracks.splice(i, 1);
          removed++;
        }
      }
      if (removed) {
        // Drop selection if it pointed at one of the removed tracks
        if (state.selected && state.selected.trackIdx >= state.tracks.length) {
          state.selected = null;
        }
        renderTrackList(); render();
      }
      return removed;
    },
    /**
     * Set or update a track's property binding. Pass null to unbind.
     *   editor.bind('cube.y', { object: cube, path: 'position.y' });
     *   editor.bind('cube.y', null);
     */
    bind(trackName, binding) {
      const tr = state.tracks.find(x => x.name === trackName);
      if (tr) { tr.binding = binding; renderTrackList(); }
    },
    /**
     * Add a new track AND bind it in one call.
     *   editor.addTrackBound({
     *     name: 'cube.x', color: '#ff5050',
     *     binding: { object: cube, path: 'position.x' },
     *     keys: [{ time:0, value:0 }, { time:1, value:5 }],
     *   });
     */
    addTrackBound(opts) {
      // If keys aren't provided, seed from current property value
      if (!opts.keys && opts.binding?.object && opts.binding?.path) {
        const v = getByPath(opts.binding.object, opts.binding.path);
        if (typeof v === 'number') {
          opts = { ...opts, keys: [{ time: 0, value: v }, { time: state.duration, value: v }] };
        }
      }
      state.tracks.push(new Track(opts));
      renderTrackList(); render();
      return state.tracks[state.tracks.length - 1];
    },
    addKey(trackName, key) {
      const tr = state.tracks.find(x => x.name === trackName);
      if (tr) { tr.addKey(key); render(); }
    },
    play, pause, setTime,
    getTime: () => state.time,
    isPlaying: () => state.playing,
    getTracks: () => state.tracks.map(t => ({
      name: t.name, color: t.color, keys: t.keys.map(k => ({ ...k })),
    })),
    /**
     * Internal-style escape hatch for code that needs the live Track[]
     * (with `binding` refs and `sample()` method). Used by exporters
     * (CSS @keyframes, WAAPI) and the deletion-sync prune logic.
     */
    getTracksFull: () => state.tracks,
    setMode(m) { state.mode = m; render(); },
    dispose() {
      pause(); ro.disconnect(); root.remove();
    },
  };
}

/** Convenience: add the graph editor as a folder body. */
export function addGraphEditor(panel, name, opts) {
  const folder = panel.addFolder(name);
  const editor = createGraphEditor(opts);
  folder.addRaw(editor.element);
  return { folder, editor };
}
