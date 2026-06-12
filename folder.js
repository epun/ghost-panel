import {
  createSlider, createColor, createCheckbox, createText, createSelect,
  createButton, createButtonRow, createFile, createInfo, createVec3,
  createBlenderField, createNumber, createCornerRadius, createDimensions,
  createPairedNumbers, createTrigger, createSequence,
} from './controls.js';
import {
  createDial, createCurveEditor, createTimeline, createStepper, createXYPad,
} from './dialkit.js';

/**
 * A Folder is a collapsible section in a panel.
 * Provides a fluent API for adding controls:
 *   folder.addSlider('Speed', { min, max, value, onChange })
 *         .addColor('Color', { value, onChange })
 *         .addButton('Reset', () => {});
 *
 * Each `add*` method returns the folder for chaining; the underlying control
 * handle is accessible via folder.controls (object keyed by label) or by
 * passing an `id` option.
 */
export class Folder {
  constructor(name, opts = {}) {
    this.name = name;
    this.controls = {};
    this._handles = []; // ordered list for update() calls
    // Optional predicate: when set, the folder is hidden whenever it
    // returns falsy. The host's update() loop checks this each tick, so
    // workflows can gate folders on selection without subscribing manually.
    this.showWhen = opts.showWhen || null;
    this._transient  = !!opts.transient;
    // Opt this folder out of the Folder-level auto-undo wrapper. The
    // contextual layer (Properties / Material / Light / Camera /
    // Typography) routes every onChange through `commitProp` which
    // already pushes a coalesced propEdit entry — wrapping again would
    // double-push. Hosts can set this on any folder whose onChange
    // handlers manage undo themselves.
    this._autoUndo   = opts.autoUndo !== false;
    // Skip the title bar + expand chevron. Useful for sections like the
    // Scene Outliner where the panel itself already labels what's inside,
    // so the folder header would just be redundant chrome.
    this._headerless = !!opts.headerless;
    this._build();
    if (opts.collapsed && !this._headerless) this.collapse();
  }
  /** Force a visibility re-evaluation against `showWhen`. */
  syncVisibility() {
    if (typeof this.showWhen !== 'function') return;
    const show = !!this.showWhen();
    this.element.style.display = show ? '' : 'none';
  }

  _build() {
    this.element = document.createElement('div');
    // `transient` folders are inserted dynamically on selection (Material,
    // Light, Properties, Camera Settings) and get the slide-in animation.
    // Everything else is marked permanent so it never re-animates as the
    // panel re-renders during gizmo drags / hover ticks.
    this.element.className = 'dui-folder' + (this._transient ? '' : ' dui-folder-permanent')
      + (this._headerless ? ' dui-folder-headerless' : '');

    if (!this._headerless) {
      const header = document.createElement('div');
      header.className = 'dui-folder-header';
      header.innerHTML = `<span>${this.name}</span><span class="dui-arrow">▾</span>`;
      header.addEventListener('click', () => this.toggleCollapsed());
      this.element.appendChild(header);
    }

    this.body = document.createElement('div');
    this.body.className = 'dui-folder-body';
    this.element.appendChild(this.body);
  }

  toggleCollapsed() { this.element.classList.toggle('dui-collapsed'); }
  collapse()        { this.element.classList.add('dui-collapsed'); }
  expand()          { this.element.classList.remove('dui-collapsed'); }

  _add(id, handle) {
    if (id) this.controls[id] = handle;
    this._handles.push(handle);
    this.body.appendChild(handle.element);
    return this;
  }

  /**
   * Wrap a value control's `opts` so its onChange auto-records undo.
   *
   * Why this exists:
   *   Every value-emitting control in the inspector (slider, color,
   *   curve, checkbox, select, …) needs Cmd+Z support. Before this
   *   wrapper, each host had to manually intercept every onChange,
   *   snapshot the value at drag start, debounce a commit, and push
   *   an undo entry — easy to forget when adding a new control, which
   *   is exactly how the grid demo shipped with non-undoable sliders.
   *
   * How it works:
   *   - First onChange call snapshots the "before" value (via the
   *     control's getValue() once it's bound).
   *   - Subsequent calls inside a 250ms window are coalesced (one
   *     undo entry per drag, not one per pointer tick).
   *   - On commit, push { undo, redo } that calls both setValue() AND
   *     the user's onChange — so undo restores both the visible
   *     widget position AND the side-effect on host state.
   *   - Equality is array-aware so curve [x1,y1,x2,y2] and vec3
   *     {x,y,z} round-trip cleanly.
   *
   *   Hosts can opt out per-call with `opts.undo: false` (e.g. a
   *   slider that drives a transient preview only). Buttons, triggers,
   *   sequences, and timelines DON'T go through this wrapper — they
   *   represent actions, not value commits.
   */
  _wrapOnChange(label, opts) {
    if (opts?.undo === false) return opts;          // per-control opt-out
    if (this._autoUndo === false) return opts;      // per-folder opt-out
    const userOnChange = opts?.onChange;
    if (typeof userOnChange !== 'function') return opts; // no handler → nothing to wrap
    // Defer ui._undo lookup to call-time so folders added before the
    // back-link is wired still pick it up on the first interaction.
    const undoStack = () => this.panel?.ui?._undo;
    if (!undoStack()) {
      // Even if undo isn't wired yet, return wrapped function so future
      // pushes still land. Cheap closure either way.
    }
    const handleRef = { current: null };
    let pending = null;
    // Track the last-committed value ourselves. We can't poll the
    // control's getValue() inside the wrapper because the control has
    // ALREADY mutated its internal state by the time onChange fires
    // — getValue would return the new value, not the previous one,
    // and "undo" would restore the wrong thing.
    let lastCommitted = (opts && 'value' in opts) ? snapshotOnly(opts.value) : undefined;
    function snapshotOnly(v) {
      return Array.isArray(v) ? v.slice()
        : (v && typeof v === 'object') ? { ...v } : v;
    }
    const snapshot = snapshotOnly;
    const equals = (a, b) => {
      if (a === b) return true;
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      }
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        for (const k of ka) if (a[k] !== b[k]) return false;
        return true;
      }
      return false;
    };
    const wrapped = (v) => {
      const stack = undoStack();
      if (!stack || stack._suppress) {
        // No undo available (or we're inside an undo/redo replay) —
        // just pass through. Still update our local snapshot so the
        // NEXT real interaction has the right "before".
        userOnChange(v);
        lastCommitted = snapshot(v);
        return;
      }
      // First call of a drag-burst → the previous lastCommitted IS the
      // value before this change session started. That's our "before".
      if (pending === null) {
        pending = { before: lastCommitted, timer: null };
      }
      userOnChange(v);
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => {
        const { before } = pending;
        const after = snapshot(v);
        pending = null;
        if (equals(before, after)) return;
        lastCommitted = after;
        stack.push({
          label: `change ${label}`,
          undo: () => {
            stack._suppress = true;
            try { handleRef.current?.setValue?.(before); userOnChange(before); }
            finally { stack._suppress = false; lastCommitted = snapshot(before); }
          },
          redo: () => {
            stack._suppress = true;
            try { handleRef.current?.setValue?.(after); userOnChange(after); }
            finally { stack._suppress = false; lastCommitted = snapshot(after); }
          },
        });
      }, 250);
    };
    // Return new opts referencing wrapped onChange; the caller will bind
    // handleRef once the factory returns.
    return Object.assign({}, opts, { onChange: wrapped, __undoBind: handleRef });
  }
  /** Bind the control handle to the undo wrapper so setValue() can be
   *  called on undo/redo. Called after the factory returns. */
  _bindUndo(opts, handle) {
    if (opts?.__undoBind) opts.__undoBind.current = handle;
    return handle;
  }

  /** Slider control. opts: { min, max, step, value, onChange, id } */
  addSlider(label, opts = {}) {
    const wrapped = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(wrapped, createSlider(label, wrapped)));
  }

  /** Color picker. opts: { value, onChange, id } */
  addColor(label, opts = {}) {
    const wrapped = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(wrapped, createColor(label, wrapped)));
  }

  /** Figma-style corner-radius control (uniform + 4-corner mode toggle).
   *  opts: { value (number | {tl,tr,br,bl}), onChange, id } */
  addCornerRadius(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createCornerRadius(label, w)));
  }

  /** Figma-style dimensions control — paired W / H + aspect lock.
   *  opts: { value: { width, height }, locked, onChange, id } */
  addDimensions(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createDimensions(label, w)));
  }

  /**
   * 2–4 typeable number cells in one row. Each field: { label, value,
   * unit, min, max, step, onChange, tooltip }. Use whenever you have
   * semantically-paired numerics (Near/Far, W/H, Min/Max) so they
   * read as one compact unit instead of two full-width rows.
   *
   *   folder.addPairedNumbers([
   *     { label: 'Near', value: 0.1, onChange: v => cam.near = v },
   *     { label: 'Far',  value: 100, onChange: v => cam.far  = v },
   *   ]);
   */
  addPairedNumbers(fields, opts = {}) {
    const handle = createPairedNumbers(fields);
    return this._add(opts.id || `paired:${fields.map(f => f.label).join(',')}`, handle);
  }

  /** Boolean checkbox. opts: { value, onChange, id } */
  addCheckbox(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createCheckbox(label, w)));
  }

  /** Text input. opts: { value, placeholder, onChange, id } */
  addText(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createText(label, w)));
  }

  /** Plain numeric input — no +/- buttons. opts: { min, max, step, value, suffix, onChange, id } */
  addNumber(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createNumber(label, w)));
  }

  /** Dropdown. opts: { options, value, onChange, id } */
  addSelect(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createSelect(label, w)));
  }

  /** Push button. label, onClick */
  addButton(label, onClick) {
    return this._add(label, createButton(label, onClick));
  }

  /**
   * Animation trigger — hero row with a label + play icon. Fire-and-
   * forget: clicking calls `opts.onTrigger`. If `opts.duration` (in
   * seconds) is set, a progress bar fills under the row for that
   * long, so the user can see the animation is still in flight.
   *
   *   folder.addTrigger('Reveal',  { onTrigger: animateReveal, duration: 1.2 });
   *   folder.addTrigger('Bounce',  { onTrigger: animateBounce, duration: 0.8 });
   *   folder.addTrigger('Reset',   { onTrigger: () => resetScene() });
   */
  addTrigger(label, opts = {}) {
    return this._add(opts.id || label, createTrigger(label, opts));
  }

  /**
   * Sequence — named steps with prev / play / next controls and dot
   * indicators. Each step's `onEnter` fires when the step becomes
   * active; optional `onExit` fires when leaving it. Dots are
   * clickable for direct jumps.
   *
   *   folder.addSequence('Demo flow', {
   *     steps: [
   *       { name: 'Intro',  onEnter: () => fadeIn(),         duration: 0.5 },
   *       { name: 'Reveal', onEnter: () => animateReveal(),  duration: 1.2 },
   *       { name: 'CTA',    onEnter: () => showCTA() },
   *     ],
   *     loop:    false,
   *     startAt: 0,
   *   });
   */
  addSequence(label, opts = {}) {
    return this._add(opts.id || label, createSequence(label, opts));
  }

  /**
   * Multiple buttons in a row. buttons: [{ label, onClick, tooltip }]
   * Returns the button-row HANDLE (with .buttons[] for setActive/setLabel),
   * NOT the folder. Most other add* methods chain — this one is the
   * exception because callers usually need access to the button handles.
   */
  addButtonRow(buttons) {
    const handle = createButtonRow(buttons);
    this._handles.push(handle);
    this.body.appendChild(handle.element);
    return handle;
  }

  /** File upload. opts: { accept, onChange } */
  addFile(label, opts = {}) {
    // File picks are single commits; undo can restore the previous file
    // ref but can't roll back any host-side side-effects (uploads, etc.).
    // Still useful to expose Cmd+Z so callers don't lose context.
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createFile(label, w)));
  }

  /** Read-only info text. */
  addInfo(text, id) {
    return this._add(id, createInfo(text));
  }

  /** Vec3 (3-axis slider group). opts: { min, max, step, value, onChange, id } */
  addVec3(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createVec3(label, w)));
  }

  /**
   * Blender-style number field — single horizontal bar with embedded label,
   * value text, and progress fill. Drag to scrub, click to type.
   * opts: { min, max, step, value, onChange, id }
   */
  addBlenderField(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createBlenderField(label, w)));
  }

  // ── DialKit-inspired controls ──

  /** Rotary dial knob. opts: { min, max, step, value, onChange, arc, suffix, size, id } */
  addDial(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createDial(label, w)));
  }

  /** Cubic-bezier curve/easing editor. opts: { value: [x1,y1,x2,y2], onChange, height, id } */
  addCurveEditor(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createCurveEditor(label, w)));
  }

  /** Timeline with play/pause/loop. opts: { duration, value, loop, onChange, onUpdate, keyframes, id }
   *
   *  NB: timelines emit onUpdate continuously during playback — that's
   *  not user input, it's a playhead tick. Only onChange (which fires on
   *  user-driven scrub commits) goes through the undo wrapper. */
  addTimeline(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createTimeline(label, w)));
  }

  /**
   * Plain typeable number input. Historically this method was a +/-
   * stepper widget, but the visible +/- buttons competed with the value
   * column and looked busy in dense panels. We routed it through the
   * same createNumber path as `addNumber`, so callers everywhere get
   * the inline-labeled input automatically. Arrow Up / Down on the
   * focused field still nudge by `step`, so keyboard users keep the
   * "stepper" affordance — just without the chrome.
   *
   * If you specifically want the old dial-kit stepper widget back,
   * import `createStepper` from `./dialkit.js` and add it via `addRaw`.
   */
  addStepper(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createNumber(label, w)));
  }

  /** 2D position pad. opts: { value: {x,y}, onChange, size, id } */
  addXYPad(label, opts = {}) {
    const w = this._wrapOnChange(label, opts);
    return this._add(opts.id || label, this._bindUndo(w, createXYPad(label, w)));
  }

  /** Blender-style Vec3 — three stacked dui-bfield rows (X / Y / Z). */
  addBlenderVec3(label, opts = {}) {
    const { min = -10, max = 10, step = 0.01,
            value = { x: 0, y: 0, z: 0 } } = opts;
    // Route the compound onChange through the undo wrapper so dragging
    // any of the three axes records a single undo entry. The handle's
    // getValue/setValue (assigned below) lets the wrapper round-trip.
    const wrapped = this._wrapOnChange(label, opts);
    const userOnChange = wrapped.onChange || (() => {});
    const wrap = document.createElement('div');
    wrap.className = 'dui-bvec3';
    if (label) {
      const lbl = document.createElement('div');
      lbl.className = 'dui-bvec3-label';
      lbl.textContent = label;
      wrap.appendChild(lbl);
    }
    const current = { x: value.x, y: value.y, z: value.z };
    const fire = () => userOnChange({ ...current });
    const fx = createBlenderField('X', { min, max, step, value: current.x, onChange: v => { current.x = v; fire(); } });
    const fy = createBlenderField('Y', { min, max, step, value: current.y, onChange: v => { current.y = v; fire(); } });
    const fz = createBlenderField('Z', { min, max, step, value: current.z, onChange: v => { current.z = v; fire(); } });
    wrap.appendChild(fx.element);
    wrap.appendChild(fy.element);
    wrap.appendChild(fz.element);
    const handle = {
      element: wrap,
      getValue: () => ({ ...current }),
      setValue: (v) => {
        current.x = v.x; current.y = v.y; current.z = v.z;
        fx.setValue(v.x); fy.setValue(v.y); fz.setValue(v.z);
      },
      dispose: () => wrap.remove(),
    };
    return this._add(opts.id || label, this._bindUndo(wrapped, handle));
  }

  /** Add a raw DOM element (escape hatch for custom UI). */
  addRaw(el) {
    this.body.appendChild(el);
    return this;
  }

  /** Get a control handle by id (or label). */
  get(id) { return this.controls[id]; }

  /** Remove a control by id. */
  remove(id) {
    const c = this.controls[id];
    if (c) {
      c.dispose();
      delete this.controls[id];
      this._handles = this._handles.filter(h => h !== c);
    }
  }

  /** Remove all controls. */
  clear() {
    this._handles.forEach(h => h.dispose());
    this._handles.length = 0;
    this.controls = {};
  }

  dispose() {
    this.clear();
    this.element.remove();
  }
}
