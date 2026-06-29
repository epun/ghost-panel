/**
 * DialKit-inspired controls — physical-feeling input widgets for Three.js,
 * WebGL, animation curves, and timelines. Themed via the same CSS variables
 * as the rest of Ghost Panel, so they automatically pick up Liquid Glass styling.
 *
 * Reference: https://joshpuckett.me/dialkit
 *
 * Widgets:
 *   - createDial        — rotary knob, drag in an arc to change value
 *   - createCurveEditor — bezier easing/animation curve editor with control points
 *   - createTimeline    — scrubber with play/pause + loop + onUpdate(time)
 *   - createStepper     — discrete +/- buttons for ints / enums
 *   - createXYPad       — 2D position field (e.g. mouse-look or audio pan)
 */

import { icons } from './icons.js';
import { clamp } from './utils.js';

// ─── Math utils ──────────────────────────────────────────────────────────
const lerp  = (a, b, t)   => a + (b - a) * t;
const tau   = Math.PI * 2;

function rowEl(label, tooltip) {
  const el = document.createElement('div');
  el.className = 'dui-row dui-row-block';
  if (tooltip) el.dataset.tooltip = tooltip;
  if (label !== null && label !== undefined) {
    const lbl = document.createElement('label');
    lbl.textContent = label;
    el.appendChild(lbl);
  }
  return el;
}

// ─── DIAL ────────────────────────────────────────────────────────────────
/**
 * Rotary knob. Drag tangentially around the center (or just up/down) to
 * change value. Hold Shift for fine adjustment.
 *
 * opts: { min, max, step, value, onChange, tooltip, size, suffix }
 */
export function createDial(label, opts = {}) {
  const {
    min = 0, max = 1, step = 0.01, value = 0.5,
    onChange = () => {},
    tooltip, size = 56, suffix = '',
    arc = 270, // total sweep degrees (e.g. 270 = ~3/4 circle)
  } = opts;

  const wrap = rowEl(label, tooltip);
  wrap.classList.add('dui-dial-row');

  // Container for dial + value
  const right = document.createElement('div');
  right.className = 'dui-dial-wrap';

  // SVG knob
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const r = size / 2;
  const inset = 6;
  const trackR = r - inset;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('dui-dial-svg');

  // Background ring track
  const tBg = document.createElementNS(SVG_NS, 'circle');
  tBg.setAttribute('cx', r); tBg.setAttribute('cy', r); tBg.setAttribute('r', trackR);
  tBg.setAttribute('fill', 'none');
  tBg.setAttribute('class', 'dui-dial-track-bg');
  svg.appendChild(tBg);

  // Filled progress arc (drawn as <path>)
  const arcPath = document.createElementNS(SVG_NS, 'path');
  arcPath.setAttribute('class', 'dui-dial-track-fill');
  arcPath.setAttribute('fill', 'none');
  svg.appendChild(arcPath);

  // Knob body
  const knob = document.createElementNS(SVG_NS, 'circle');
  knob.setAttribute('cx', r); knob.setAttribute('cy', r);
  knob.setAttribute('r', trackR - 6);
  knob.setAttribute('class', 'dui-dial-knob');
  svg.appendChild(knob);

  // Indicator line on the knob
  const indicator = document.createElementNS(SVG_NS, 'line');
  indicator.setAttribute('class', 'dui-dial-indicator');
  svg.appendChild(indicator);

  right.appendChild(svg);

  // Value display
  const valEl = document.createElement('span');
  valEl.className = 'dui-dial-value';
  right.appendChild(valEl);

  wrap.appendChild(right);

  // ── State ──
  let current = clamp(parseFloat(value), min, max);

  // Convert value → angle (in radians, 0 at the bottom)
  const sweep = (arc * Math.PI) / 180;
  const startAngle = (Math.PI * 1.5) - sweep / 2; // bottom-center anchor

  function valueToAngle(v) {
    const t = (v - min) / (max - min);
    return startAngle + t * sweep;
  }
  function angleToValue(angle) {
    let a = angle - startAngle;
    // Normalize into [0, 2π) range relative to startAngle
    while (a < 0) a += tau;
    while (a > tau) a -= tau;
    const t = clamp(a / sweep, 0, 1);
    return lerp(min, max, t);
  }

  function decimalsFor(s) {
    const str = String(s);
    const i = str.indexOf('.');
    return i < 0 ? 0 : str.length - i - 1;
  }
  const decimals = decimalsFor(step);

  function update(fire = true) {
    current = Math.round(clamp(current, min, max) / step) * step;
    const a = valueToAngle(current);
    // Indicator line from center to edge
    const cx = r, cy = r;
    const ex = cx + Math.cos(a) * (trackR - 4);
    const ey = cy + Math.sin(a) * (trackR - 4);
    const ix = cx + Math.cos(a) * (trackR - 18);
    const iy = cy + Math.sin(a) * (trackR - 18);
    indicator.setAttribute('x1', ix); indicator.setAttribute('y1', iy);
    indicator.setAttribute('x2', ex); indicator.setAttribute('y2', ey);

    // Progress arc
    const a0 = startAngle;
    const a1 = a;
    const largeArc = (a1 - a0) > Math.PI ? 1 : 0;
    const sx = cx + Math.cos(a0) * trackR;
    const sy = cy + Math.sin(a0) * trackR;
    const ex2 = cx + Math.cos(a1) * trackR;
    const ey2 = cy + Math.sin(a1) * trackR;
    arcPath.setAttribute('d', `M ${sx} ${sy} A ${trackR} ${trackR} 0 ${largeArc} 1 ${ex2} ${ey2}`);

    valEl.textContent = current.toFixed(decimals) + suffix;
    if (fire) onChange(current);
  }
  update(false);

  // ── Drag interaction ──
  // Vertical drag: 100px = full range. Hold Shift = 5× finer.
  let dragging = false, startY = 0, startValue = 0;
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startValue = current;
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('dui-dial-dragging');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY; // up = increase
    const sensitivity = (max - min) / (e.shiftKey ? 500 : 100);
    current = startValue + dy * sensitivity;
    update();
  });
  svg.addEventListener('pointerup', (e) => {
    dragging = false;
    svg.releasePointerCapture(e.pointerId);
    svg.classList.remove('dui-dial-dragging');
  });
  // Double-click to reset to mid-range
  svg.addEventListener('dblclick', () => {
    current = (min + max) / 2; update();
  });
  // Scroll wheel for fine adjustment
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * step * (e.shiftKey ? 1 : 5);
    current = current + delta;
    update();
  }, { passive: false });

  return {
    element: wrap,
    getValue: () => current,
    setValue: (v) => { current = parseFloat(v); update(false); },
    dispose: () => wrap.remove(),
  };
}

// ─── CURVE EDITOR ────────────────────────────────────────────────────────
/**
 * Cubic-bezier easing/animation curve editor with two draggable control
 * points. Sample the curve with handle.sample(t) (t in [0..1]).
 *
 * opts: { value: [x1, y1, x2, y2], onChange, tooltip, height }
 *        Default value is the CSS ease-in-out curve (.42, 0, .58, 1).
 */
export function createCurveEditor(label, opts = {}) {
  const {
    value = [0.42, 0, 0.58, 1],
    onChange = () => {},
    tooltip,
    height = 120,
  } = opts;

  const wrap = rowEl(label, tooltip);
  wrap.classList.add('dui-curve-row');

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'dui-curve');
  // dialkit convention: equal-scale axes with [0,1] centered in [-0.5, 1.5].
  // 4-unit span on each side so curves with overshoot (back-out, elastic,
  // anticipate) render fully without clipping. The 45° identity diagonal
  // is the only orientation cue the user needs.
  svg.setAttribute('viewBox', `0 0 200 200`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.height = `${height}px`;
  svg.style.width = '100%';

  // Coordinate helpers — normalized (nx, ny) where (0,0) → bottom-left of the
  // [0,1] window, (1,1) → top-right. The viewport extends from -0.5..1.5.
  const VIEW = 200;
  const PAD = 10;
  const INNER = VIEW - PAD * 2;
  const UNIT = INNER / 2;       // half the inner span = 1 unit in normalized space
  const toSvg = (nx, ny) => [PAD + (nx + 0.5) * UNIT, PAD + (1.5 - ny) * UNIT];

  // Faint grid at quarter divisions of the [0,1] window. Mirrors dialkit's
  // alpha 0.08 grid + 0.15 reference midline density.
  const gridG = document.createElementNS(SVG_NS, 'g');
  gridG.setAttribute('class', 'dui-curve-grid');
  for (let i = 0; i <= 4; i++) {
    const [vx] = toSvg(i / 4, 0);
    const [, vy] = toSvg(0, i / 4);
    const [, vy1] = toSvg(0, 0);
    const [, vy2] = toSvg(0, 1);
    const [vx1] = toSvg(0, 0);
    const [vx2] = toSvg(1, 0);
    const v = document.createElementNS(SVG_NS, 'line');
    v.setAttribute('x1', vx); v.setAttribute('x2', vx);
    v.setAttribute('y1', vy1); v.setAttribute('y2', vy2);
    gridG.appendChild(v);
    const h = document.createElementNS(SVG_NS, 'line');
    h.setAttribute('x1', vx1); h.setAttribute('x2', vx2);
    h.setAttribute('y1', vy); h.setAttribute('y2', vy);
    gridG.appendChild(h);
  }
  svg.appendChild(gridG);

  // Dashed identity diagonal (linear reference). Renders at 45° because
  // the viewport is equal-scale.
  const diag = document.createElementNS(SVG_NS, 'line');
  diag.setAttribute('class', 'dui-curve-diag');
  {
    const [x1, y1] = toSvg(0, 0);
    const [x2, y2] = toSvg(1, 1);
    diag.setAttribute('x1', x1); diag.setAttribute('y1', y1);
    diag.setAttribute('x2', x2); diag.setAttribute('y2', y2);
  }
  svg.appendChild(diag);

  // Curve path
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', 'dui-curve-path');
  path.setAttribute('fill', 'none');
  svg.appendChild(path);

  // Control point lines
  const line1 = document.createElementNS(SVG_NS, 'line');
  const line2 = document.createElementNS(SVG_NS, 'line');
  line1.setAttribute('class', 'dui-curve-handle-line');
  line2.setAttribute('class', 'dui-curve-handle-line');
  svg.appendChild(line1); svg.appendChild(line2);

  // Anchor points (fixed) + control points (draggable)
  const cp1 = document.createElementNS(SVG_NS, 'circle');
  const cp2 = document.createElementNS(SVG_NS, 'circle');
  cp1.setAttribute('class', 'dui-curve-cp');
  cp2.setAttribute('class', 'dui-curve-cp');
  cp1.setAttribute('r', '4');
  cp2.setAttribute('r', '4');
  svg.appendChild(cp1); svg.appendChild(cp2);

  wrap.appendChild(svg);

  // State: control points in normalized 0..1 space (x can be 0..1, y can be -0.5..1.5)
  let pts = [...value];

  function pxToNorm(px, py) {
    // Inverse of toSvg(): pixel-in-bbox → normalized (nx, ny) in the [0,1]
    // window. Output is allowed to extend past [0,1] for overshoot drags.
    const r = svg.getBoundingClientRect();
    const sx = ((px - r.left) / r.width)  * VIEW;
    const sy = ((py - r.top)  / r.height) * VIEW;
    return [
      (sx - PAD) / UNIT - 0.5,
      1.5 - (sy - PAD) / UNIT,
    ];
  }

  function update(fire = true) {
    // Anchor points fixed at normalized (0,0) and (1,1).
    const A  = toSvg(0, 0);
    const B  = toSvg(1, 1);
    const C1 = toSvg(pts[0], pts[1]);
    const C2 = toSvg(pts[2], pts[3]);

    path.setAttribute('d',
      `M ${A[0]} ${A[1]} C ${C1[0]} ${C1[1]}, ${C2[0]} ${C2[1]}, ${B[0]} ${B[1]}`);

    line1.setAttribute('x1', A[0]); line1.setAttribute('y1', A[1]);
    line1.setAttribute('x2', C1[0]); line1.setAttribute('y2', C1[1]);
    line2.setAttribute('x1', B[0]); line2.setAttribute('y1', B[1]);
    line2.setAttribute('x2', C2[0]); line2.setAttribute('y2', C2[1]);

    cp1.setAttribute('cx', C1[0]); cp1.setAttribute('cy', C1[1]);
    cp2.setAttribute('cx', C2[0]); cp2.setAttribute('cy', C2[1]);

    if (fire) onChange([...pts]);
  }
  update(false);

  function dragPoint(circle, idx) {
    let active = false;
    circle.addEventListener('pointerdown', (e) => {
      active = true;
      circle.setPointerCapture(e.pointerId);
      circle.classList.add('dui-curve-cp-dragging');
    });
    circle.addEventListener('pointermove', (e) => {
      if (!active) return;
      const [nx, ny] = pxToNorm(e.clientX, e.clientY);
      pts[idx]     = clamp(nx, 0, 1);
      pts[idx + 1] = clamp(ny, -0.5, 1.5);
      update();
    });
    circle.addEventListener('pointerup', (e) => {
      active = false;
      circle.releasePointerCapture(e.pointerId);
      circle.classList.remove('dui-curve-cp-dragging');
    });
  }
  dragPoint(cp1, 0);
  dragPoint(cp2, 2);

  /** Sample the cubic-bezier curve at t in [0, 1] */
  function sample(t) {
    // For a 1D cubic bezier from (0,0) to (1,1) with control points
    // (pts[0], pts[1]) and (pts[2], pts[3]) — we want y(t) when x(t) = t.
    // Solve x(t)=t for parameter u, then evaluate y(u). For most curves a
    // few Newton iterations are enough.
    const x1 = pts[0], y1 = pts[1], x2 = pts[2], y2 = pts[3];
    const bx = (u) => 3*(1-u)*(1-u)*u*x1 + 3*(1-u)*u*u*x2 + u*u*u;
    const by = (u) => 3*(1-u)*(1-u)*u*y1 + 3*(1-u)*u*u*y2 + u*u*u;
    const dbx = (u) => 3*(1-u)*(1-u)*x1 + 6*(1-u)*u*(x2-x1) + 3*u*u*(1-x2);
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = bx(u) - t;
      if (Math.abs(x) < 1e-5) break;
      const d = dbx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= x / d;
      u = clamp(u, 0, 1);
    }
    return by(u);
  }

  return {
    element: wrap,
    getValue: () => [...pts],
    setValue: (v) => { pts = [...v]; update(false); },
    sample,
    dispose: () => wrap.remove(),
  };
}

// ─── TIMELINE ────────────────────────────────────────────────────────────
/**
 * Scrubbable timeline with play/pause/loop. Calls onUpdate(time) each frame
 * while playing, and onChange(time) whenever the playhead moves (drag or
 * programmatic).
 *
 * opts: { duration, value, loop, onChange, onUpdate, tooltip, keyframes }
 *        keyframes: array of numbers in [0, duration] to render as marks
 */
export function createTimeline(label, opts = {}) {
  const {
    duration = 1.0,
    value = 0,
    loop = true,
    onChange = () => {},
    onUpdate = () => {},
    tooltip,
    keyframes = [],
  } = opts;

  const wrap = rowEl(label, tooltip);
  wrap.classList.add('dui-timeline-row');

  // Container for transport + bar
  const inner = document.createElement('div');
  inner.className = 'dui-timeline-inner';

  // Play / pause button
  const playBtn = document.createElement('button');
  playBtn.className = 'dui-timeline-play';
  playBtn.dataset.tooltip = 'Play / pause';
  playBtn.innerHTML = icons.play;
  inner.appendChild(playBtn);

  // Bar track
  const bar = document.createElement('div');
  bar.className = 'dui-timeline-bar';
  inner.appendChild(bar);

  const fill = document.createElement('div');
  fill.className = 'dui-timeline-fill';
  bar.appendChild(fill);

  // Keyframe ticks
  keyframes.forEach(kf => {
    const tick = document.createElement('div');
    tick.className = 'dui-timeline-keyframe';
    tick.style.left = `${(kf / duration) * 100}%`;
    bar.appendChild(tick);
  });

  // Playhead
  const playhead = document.createElement('div');
  playhead.className = 'dui-timeline-playhead';
  bar.appendChild(playhead);

  // Time readout
  const timeEl = document.createElement('span');
  timeEl.className = 'dui-timeline-time';
  inner.appendChild(timeEl);

  wrap.appendChild(inner);

  // State
  let currentTime = clamp(value, 0, duration);
  let playing = false;
  let lastFrame = 0;
  let looping = loop;

  function render() {
    const t = currentTime / duration;
    fill.style.width = `${t * 100}%`;
    playhead.style.left = `${t * 100}%`;
    timeEl.textContent = `${currentTime.toFixed(2)}s`;
  }
  render();

  function setTime(t, fire = true) {
    currentTime = clamp(t, 0, duration);
    render();
    if (fire) onChange(currentTime);
  }

  // Playback loop
  function tick(now) {
    if (!playing) return;
    if (lastFrame === 0) lastFrame = now;
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    currentTime += dt;
    if (currentTime >= duration) {
      if (looping) currentTime = currentTime % duration;
      else { currentTime = duration; pause(); }
    }
    render();
    onUpdate(currentTime);
    onChange(currentTime);
    requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    playing = true;
    playBtn.innerHTML = icons.pause;
    lastFrame = 0;
    requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    playBtn.innerHTML = icons.play;
  }
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playing ? pause() : play();
  });

  // Scrub by clicking/dragging on the bar
  let scrubbing = false;
  function scrubFromEvent(e) {
    const r = bar.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / r.width, 0, 1);
    setTime(t * duration);
  }
  bar.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    bar.setPointerCapture(e.pointerId);
    scrubFromEvent(e);
  });
  bar.addEventListener('pointermove', (e) => {
    if (scrubbing) scrubFromEvent(e);
  });
  bar.addEventListener('pointerup', (e) => {
    scrubbing = false;
    bar.releasePointerCapture(e.pointerId);
  });

  return {
    element: wrap,
    getValue: () => currentTime,
    setValue: (t) => setTime(t, false),
    play, pause,
    isPlaying: () => playing,
    setLoop: (v) => { looping = v; },
    dispose: () => { pause(); wrap.remove(); },
  };
}

// ─── STEPPER ─────────────────────────────────────────────────────────────
/**
 * Stepper — −/+ buttons around a value display. Great for discrete ints
 * like "subdivisions" or stepping through enum values.
 */
export function createStepper(label, opts = {}) {
  const {
    min = 0, max = 100, step = 1, value = 0,
    onChange = () => {}, tooltip, suffix = '',
  } = opts;
  const wrap = rowEl(label, tooltip);
  wrap.classList.add('dui-stepper-row');

  const inner = document.createElement('div');
  inner.className = 'dui-stepper';

  const minus = document.createElement('button');
  minus.className = 'dui-stepper-btn';
  minus.innerHTML = '−';
  const plus = document.createElement('button');
  plus.className = 'dui-stepper-btn';
  plus.innerHTML = '+';
  const display = document.createElement('span');
  display.className = 'dui-stepper-value';

  inner.appendChild(minus);
  inner.appendChild(display);
  inner.appendChild(plus);
  wrap.appendChild(inner);

  let current = clamp(value, min, max);
  function update(fire = true) {
    current = clamp(current, min, max);
    display.textContent = current + suffix;
    if (fire) onChange(current);
  }
  update(false);

  minus.addEventListener('click', (e) => { e.stopPropagation(); current -= step; update(); });
  plus.addEventListener('click',  (e) => { e.stopPropagation(); current += step; update(); });

  return {
    element: wrap,
    getValue: () => current,
    setValue: (v) => { current = v; update(false); },
    dispose: () => wrap.remove(),
  };
}

// ─── XY PAD ──────────────────────────────────────────────────────────────
/**
 * 2D position field — drag a dot around a square area. Great for camera-
 * look offsets, audio pan, joystick-style input, etc.
 *
 * opts: { value: { x, y }, onChange, size, tooltip }
 */
export function createXYPad(label, opts = {}) {
  const {
    value = { x: 0.5, y: 0.5 },
    onChange = () => {},
    size = 120, tooltip,
  } = opts;

  const wrap = rowEl(label, tooltip);
  wrap.classList.add('dui-xypad-row');

  const pad = document.createElement('div');
  pad.className = 'dui-xypad';
  pad.style.width = `${size}px`;
  pad.style.height = `${size}px`;
  // Crosshair lines
  const hLine = document.createElement('div');
  hLine.className = 'dui-xypad-h';
  const vLine = document.createElement('div');
  vLine.className = 'dui-xypad-v';
  const dot = document.createElement('div');
  dot.className = 'dui-xypad-dot';
  pad.appendChild(hLine); pad.appendChild(vLine); pad.appendChild(dot);

  wrap.appendChild(pad);

  let current = { x: value.x, y: value.y };
  function update(fire = true) {
    current.x = clamp(current.x, 0, 1);
    current.y = clamp(current.y, 0, 1);
    dot.style.left = `${current.x * 100}%`;
    dot.style.top  = `${(1 - current.y) * 100}%`;
    hLine.style.top = `${(1 - current.y) * 100}%`;
    vLine.style.left = `${current.x * 100}%`;
    if (fire) onChange({ ...current });
  }
  update(false);

  let dragging = false;
  function setFromEvent(e) {
    const r = pad.getBoundingClientRect();
    current.x = clamp((e.clientX - r.left) / r.width, 0, 1);
    current.y = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    update();
  }
  pad.addEventListener('pointerdown', (e) => {
    dragging = true;
    pad.setPointerCapture(e.pointerId);
    setFromEvent(e);
  });
  pad.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
  pad.addEventListener('pointerup', (e) => {
    dragging = false;
    pad.releasePointerCapture(e.pointerId);
  });

  return {
    element: wrap,
    getValue: () => ({ ...current }),
    setValue: (v) => { current = { ...v }; update(false); },
    dispose: () => wrap.remove(),
  };
}
