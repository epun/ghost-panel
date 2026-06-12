/**
 * Web-element adapter — wraps a DOM element so it looks like a 2D scene object
 * to the rest of Ghost Panel (Outliner, mini toolbar, Modal2DTransform, graph
 * editor, undo, copy/paste).
 *
 * Surface (matches the 2D Canvas duck-type used elsewhere):
 *   { name, x, y, rotation, width, height, opacity, visible }
 *
 * x/y/rotation are written to a single composed `transform` string so the
 * element responds in real time. width/height are independent of the
 * element's intrinsic content size — set them to scale the element via
 * `scaleX = width / baseWidth`. This keeps the property layer flat (just
 * numbers) so existing animation tracks / undo commands work unmodified.
 *
 *   const adapter = createWebAdapter(document.getElementById('card'), { name: 'card' });
 *   ui.objectManager.register(adapter.name, adapter);
 */

let _counter = 0;

// Pull a sensible "text content" string off the element. Most use cases
// (cards, pills, buttons) are flat text; if the element wraps richer
// markup we fall back to its textContent so the typography editor still
// has something useful to display.
function extractText(el) {
  if (!el) return '';
  // Single text-node child is the common case (e.g. `<div>Card Element</div>`).
  if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
    return el.childNodes[0].nodeValue.trim();
  }
  return (el.textContent || '').trim();
}
// Line-height computes to "normal" or a px value. Normalize "normal" to
// the multiplier 1.2 (CSS default) so it's editable as a number.
function parseLineHeight(cs) {
  if (!cs) return 1.2;
  const raw = cs.lineHeight;
  if (!raw || raw === 'normal') return 1.2;
  const px = parseFloat(raw);
  const fs = parseFloat(cs.fontSize) || 14;
  return fs ? +(px / fs).toFixed(3) : 1.2;
}
// Letter-spacing computes to "normal" or "<px>px"; we surface it as a px
// signed number, with "normal" → 0.
function parseLetterSpacing(cs) {
  if (!cs) return 0;
  const raw = cs.letterSpacing;
  if (!raw || raw === 'normal') return 0;
  return +parseFloat(raw).toFixed(3) || 0;
}
// The demo elements all use flex centering, so vertical alignment is
// driven by align-items. Map flex-start / center / flex-end onto the
// vocabulary the typography UI uses (top / middle / bottom).
function inferVerticalAlign(cs) {
  const ai = cs?.alignItems || '';
  if (ai === 'flex-end' || ai === 'end')   return 'bottom';
  if (ai === 'center' || ai === 'safe center') return 'middle';
  return 'top';
}

export function createWebAdapter(element, opts = {}) {
  if (!element) throw new Error('createWebAdapter: missing element');
  _counter += 1;
  const initialRect = element.getBoundingClientRect();
  const baseWidth  = opts.baseWidth  ?? initialRect.width  ?? 100;
  const baseHeight = opts.baseHeight ?? initialRect.height ?? 100;

  const cs = getComputedStyle(element);
  const state = {
    x:            opts.x        ?? initialRect.left,
    y:            opts.y        ?? initialRect.top,
    rotation:     opts.rotation ?? 0,
    width:        opts.width    ?? baseWidth,
    height:       opts.height   ?? baseHeight,
    opacity:      opts.opacity  ?? parseFloat(cs.opacity || '1'),
    visible:      opts.visible !== false,
    // Figma-style style props — read seed values from the live element so
    // the picker doesn't reset what the host's stylesheet already provided.
    cornerRadius: opts.cornerRadius ?? (parseFloat(cs.borderTopLeftRadius) || 0),
    // Per-corner radii — the Properties folder uses these to drive the
    // unlinked mode of the corner-radius widget. Seeded from the same
    // computed style so existing styling survives the first adapter pass.
    cornerRadiusTopLeft:     opts.cornerRadiusTopLeft     ?? (parseFloat(cs.borderTopLeftRadius)     || 0),
    cornerRadiusTopRight:    opts.cornerRadiusTopRight    ?? (parseFloat(cs.borderTopRightRadius)    || 0),
    cornerRadiusBottomRight: opts.cornerRadiusBottomRight ?? (parseFloat(cs.borderBottomRightRadius) || 0),
    cornerRadiusBottomLeft:  opts.cornerRadiusBottomLeft  ?? (parseFloat(cs.borderBottomLeftRadius)  || 0),
    fill:         opts.fill         ?? (cs.backgroundColor || '#ffffff'),
    strokeColor:  opts.strokeColor  ?? (cs.borderTopColor  || '#000000'),
    strokeWidth:  opts.strokeWidth  ?? (parseFloat(cs.borderTopWidth) || 0),
    // ── Typography ────────────────────────────────────────────────
    // Seeded from the live element so existing styles survive. We
    // expose these unconditionally — the contextual inspector decides
    // whether to render the Typography folder based on whether the
    // element actually has visible text (see hasTypography below).
    text:           opts.text          ?? extractText(element),
    fontFamily:     opts.fontFamily    ?? (cs.fontFamily || 'inherit'),
    fontWeight:     opts.fontWeight    ?? (parseInt(cs.fontWeight,  10) || 400),
    fontSize:       opts.fontSize      ?? (parseFloat(cs.fontSize)   || 14),
    lineHeight:     opts.lineHeight    ?? parseLineHeight(cs),
    letterSpacing:  opts.letterSpacing ?? parseLetterSpacing(cs),
    textAlign:      opts.textAlign     ?? (cs.textAlign === 'start' ? 'left' : cs.textAlign || 'left'),
    verticalAlign:  opts.verticalAlign ?? inferVerticalAlign(cs),
    fontStyle:      opts.fontStyle     ?? (cs.fontStyle || 'normal'),
    color:          opts.color         ?? (cs.color || '#ffffff'),
  };

  function apply() {
    const scaleX = baseWidth  ? state.width  / baseWidth  : 1;
    const scaleY = baseHeight ? state.height / baseHeight : 1;
    // Center-pivot transform: rotate + scale around the element's own
    // visual center, then translate (x, y) to position the un-scaled
    // top-left. Reading right-to-left, the chain is:
    //   1. translate(-w/2, -h/2)  → center moves to origin
    //   2. scale(sx, sy)          → scales around origin (= center)
    //   3. rotate(r)              → rotates around origin (= center)
    //   4. translate(w/2, h/2)    → center back to original position
    //   5. translate(x, y)        → element moves to (x, y)
    //
    // Result: (x, y) is still the un-scaled top-left position the host
    // wired up, but rotation pivots around the element's center (Figma
    // behavior) instead of swinging it around the top-left corner. The
    // gizmo follows along via getBoundingClientRect (see gizmo-2d.js).
    element.style.transform =
      `translate(${state.x}px, ${state.y}px)` +
      ` translate(${baseWidth / 2}px, ${baseHeight / 2}px)` +
      ` rotate(${state.rotation}rad)` +
      ` scale(${scaleX}, ${scaleY})` +
      ` translate(${-baseWidth / 2}px, ${-baseHeight / 2}px)`;
    element.style.transformOrigin = '0 0';
    element.style.opacity = String(state.opacity);
    element.style.visibility = state.visible ? '' : 'hidden';
    element.style.pointerEvents = state.visible ? '' : 'none';
    // Figma-like surface props.
    // If any per-corner radius diverges from the uniform value, emit the
    // long-hand border-radius (tl tr br bl). Otherwise stick with the
    // uniform shorthand so DevTools stays clean.
    const tl = state.cornerRadiusTopLeft, tr = state.cornerRadiusTopRight,
          br = state.cornerRadiusBottomRight, bl = state.cornerRadiusBottomLeft;
    const allSame = (tl === tr && tr === br && br === bl);
    element.style.borderRadius = allSame
      ? `${state.cornerRadius}px`
      : `${tl}px ${tr}px ${br}px ${bl}px`;
    if (state.strokeWidth > 0) {
      element.style.borderStyle = 'solid';
      element.style.borderWidth = `${state.strokeWidth}px`;
      element.style.borderColor = state.strokeColor;
    } else {
      element.style.borderWidth = '0';
    }
    // Only override background if the user explicitly set fill (so we don't
    // smash a gradient that came from the host's CSS).
    if (opts.fill !== undefined || state.fill !== cs.backgroundColor) {
      element.style.background = state.fill;
    }
    // ── Typography ────────────────────────────────────────────────
    // Writing textContent on every apply() would be expensive (we'd
    // blow away DOM children on every transform tick), so we only
    // touch it when the typography path explicitly changed. The flag
    // gets flipped by the `text` setter and consumed here.
    if (state._textDirty) {
      element.textContent = state.text;
      state._textDirty = false;
    }
    element.style.fontFamily    = state.fontFamily;
    element.style.fontWeight    = String(state.fontWeight);
    element.style.fontSize      = `${state.fontSize}px`;
    element.style.lineHeight    = String(state.lineHeight);
    element.style.letterSpacing = `${state.letterSpacing}px`;
    element.style.textAlign     = state.textAlign;
    element.style.fontStyle     = state.fontStyle;
    element.style.color         = state.color;
    // Vertical alignment piggybacks on the flex container the demo
    // elements use. Map onto align-items so it works without rewriting
    // the host's layout.
    element.style.alignItems =
      state.verticalAlign === 'middle' ? 'center' :
      state.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
  }

  // The adapter exposes the state via getters/setters so the mini toolbar
  // and graph editor can mutate the numbers directly — `apply()` runs on
  // every write, keeping the DOM in sync without a render loop.
  const adapter = {
    name: opts.name || element.id || `el.${String(_counter).padStart(2, '0')}`,
    _el: element,
    _baseWidth: baseWidth,
    _baseHeight: baseHeight,
  };
  [
    'x', 'y', 'rotation', 'width', 'height', 'opacity', 'visible',
    'cornerRadius',
    'cornerRadiusTopLeft', 'cornerRadiusTopRight',
    'cornerRadiusBottomLeft', 'cornerRadiusBottomRight',
    'fill', 'strokeColor', 'strokeWidth',
    // Typography
    'fontFamily', 'fontWeight', 'fontSize', 'lineHeight',
    'letterSpacing', 'textAlign', 'verticalAlign', 'fontStyle', 'color',
  ].forEach(prop => {
    Object.defineProperty(adapter, prop, {
      enumerable: true,
      configurable: true,
      get() { return state[prop]; },
      set(v) { state[prop] = v; apply(); },
    });
  });
  // `text` is special: writing it must also mark the textContent dirty
  // so apply() reaches into the element. Keep it out of the generic loop
  // so we don't bake the dirty-flag dance into every property write.
  Object.defineProperty(adapter, 'text', {
    enumerable: true,
    configurable: true,
    get() { return state.text; },
    set(v) {
      state.text = String(v);
      state._textDirty = true;
      apply();
    },
  });
  // Whether the typography folder should appear in the inspector. A
  // wrapper element with no text (e.g. icon-only divs) doesn't get the
  // panel — keeps the inspector terse.
  adapter.hasTypography = () => !!extractText(element);

  // Marker so the clipboard / workflow-detection code can recognize a web
  // adapter without sniffing the DOM. Non-enumerable-ish (leading _) so the
  // contextual inspector skips it.
  adapter._isWebAdapter = true;

  // DOM-aware clone for copy / paste / duplicate. The generic clipboard
  // path can't structuredClone a live DOM node (or the getter/setter
  // machinery), so it defers here. We deep-clone the element, mount it in
  // the same parent, and wrap it in a fresh adapter seeded from the
  // CURRENT state snapshot — so the copy reproduces every live property
  // (position, fill, corner radii, typography) rather than the stylesheet
  // defaults. The caller offsets x/y so the paste isn't hidden behind the
  // original.
  adapter._cloneAdapter = (newName) => {
    const clone = element.cloneNode(true);
    (element.parentNode || document.body).appendChild(clone);
    // Spread the live state as opts — createWebAdapter reads opts.<prop>
    // first, so every current value (not the computed-style seed) carries
    // over. baseWidth/baseHeight keep the clone's scale math identical.
    return createWebAdapter(clone, {
      ...state,
      name: newName || `${adapter.name} copy`,
      baseWidth, baseHeight,
    });
  };

  // First paint so the element reflects whatever initial state we resolved.
  apply();
  // Stamp the element so click-to-select can find the adapter back.
  element.dataset.ghostPanelAdapter = adapter.name;
  return adapter;
}

/**
 * Hand the timeline off to the browser's compositor via WAAPI. Reads the
 * tracks bound to web adapters from the graph editor, generates per-element
 * keyframes (transform + opacity + width/height), and calls
 * `element.animate()` on each one. Returns a controller `{ play, pause,
 * setTime, cancel, animations }` so the host can hook it to the editor's
 * transport.
 *
 *   const waapi = playWithWAAPI(ui);
 *   waapi.pause(); waapi.setTime(1.2); waapi.play();
 *
 * Once started, WAAPI runs the animation off the main thread for the
 * properties the compositor can handle — much smoother than per-rAF writes.
 */
export function playWithWAAPI(ui, opts = {}) {
  const editor = ui?._graphEditor;
  if (!editor?.getTracksFull) throw new Error('No animation graph editor active');
  const tracks = editor.getTracksFull();
  const duration = opts.duration
    ?? Math.max(0.001, ...tracks.flatMap(t => t.keys.map(k => k.time)));

  // Group tracks by their bound web-adapter element.
  const byEl = new Map();
  tracks.forEach(t => {
    const obj = t.binding?.object;
    if (!obj?._el) return;
    const path = t.binding.path;
    if (!byEl.has(obj._el)) byEl.set(obj._el, { adapter: obj, byPath: {} });
    byEl.get(obj._el).byPath[path] = t;
  });

  // Build the keyframe array per element.
  const animations = [];
  byEl.forEach((entry, el) => {
    const times = uniqueSorted(Object.values(entry.byPath).flatMap(t => t.keys.map(k => k.time)));
    const baseW = entry.adapter._baseWidth, baseH = entry.adapter._baseHeight;
    const frames = times.map(t => {
      const f = { offset: t / duration };
      const sx = entry.byPath.x        ? entry.byPath.x.sample(t)        : entry.adapter.x;
      const sy = entry.byPath.y        ? entry.byPath.y.sample(t)        : entry.adapter.y;
      const sr = entry.byPath.rotation ? entry.byPath.rotation.sample(t) : entry.adapter.rotation;
      const sw = entry.byPath.width    ? entry.byPath.width.sample(t)    : entry.adapter.width;
      const sh = entry.byPath.height   ? entry.byPath.height.sample(t)   : entry.adapter.height;
      const scaleX = baseW ? sw / baseW : 1;
      const scaleY = baseH ? sh / baseH : 1;
      f.transform = `translate(${sx}px, ${sy}px) rotate(${sr}rad) scale(${scaleX}, ${scaleY})`;
      f.transformOrigin = '0 0';
      if (entry.byPath.opacity) f.opacity = entry.byPath.opacity.sample(t);
      // Per-segment easing — use the bezier from the start key of each segment.
      const meta = mostSpecificKey(entry.byPath, t);
      if (meta?.bezier) f.easing = `cubic-bezier(${meta.bezier.join(',')})`;
      else if (meta?.easing) f.easing = cssEasing(meta.easing);
      return f;
    });
    const anim = el.animate(frames, {
      duration: duration * 1000,
      iterations: opts.loop !== false ? Infinity : 1,
      fill: 'both',
    });
    animations.push(anim);
  });

  const controller = {
    animations,
    play()  { animations.forEach(a => a.play()); },
    pause() { animations.forEach(a => a.pause()); },
    cancel(){ animations.forEach(a => a.cancel()); },
    setTime(t) { animations.forEach(a => { a.currentTime = t * 1000; }); },
    duration,
  };
  return controller;
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}
function mostSpecificKey(byPath, time) {
  // Pick the first track at this time that carries easing/bezier metadata.
  for (const t of Object.values(byPath)) {
    const k = t.keys.find(x => x.time === time);
    if (k && (k.easing || k.bezier)) return k;
  }
  return null;
}
function cssEasing(name) {
  return ({
    linear: 'linear',
    easeIn: 'cubic-bezier(0.42,0,1,1)',
    easeOut: 'cubic-bezier(0,0,0.58,1)',
    easeInOut: 'cubic-bezier(0.42,0,0.58,1)',
  })[name] || 'linear';
}

/**
 * Attach click-to-select behavior to the document. Clicking any element
 * registered with createWebAdapter() (i.e. carrying [data-ghost-panel-adapter])
 * selects it through the ObjectManager. The element itself can still receive
 * its own click handlers — selection happens during the capture phase and
 * doesn't stopPropagation.
 *
 * Returns a dispose function.
 */
export function enableWebSelection(ui, opts = {}) {
  if (!ui?.objectManager) return () => {};
  const exclude = opts.excludeSelector || '.ghost-panel, .dui-add-menu, .dui-context-toolbar, .dui-modal-hint, .dui-toast-host';
  const onClick = (e) => {
    // Skip clicks on Ghost Panel surfaces themselves
    if (e.target.closest(exclude)) return;
    const host = e.target.closest('[data-ghost-panel-adapter]');
    if (!host) return;
    const name = host.dataset.ghostPanelAdapter;
    if (ui.objectManager.has?.(name)) ui.objectManager.select(name);
  };
  window.addEventListener('click', onClick, true);
  return () => window.removeEventListener('click', onClick, true);
}
