import { log } from './log.js';
/**
 * Contextual workflows — auto-load the right tools, panels, and controls
 * based on what the project is.
 *
 * Each workflow describes:
 *   - which preset folders to add (with the controls relevant to that domain)
 *   - which keyboard shortcuts to bind
 *   - what extra subsystems to enable (e.g. 3D gizmos for a 3D workflow)
 *
 * Usage:
 *   const ui = createGhostPanel({ workflow: 'animation', ... });
 *   // or
 *   ui.applyWorkflow('shader', { uniforms: { ... } });
 *
 * Workflows can also auto-detect themselves from createGhostPanel options
 * (e.g. if `scene` is provided, default workflow = '3d').
 */

// ─── AnimationClip → graph-editor import ──────────────────────────────────
// A host whose objects are driven by a Three.js AnimationMixer/AnimationClip
// (hand-rolled, or loaded by GLTFLoader) gets the animation workflow switched
// on by detection — but historically the clip's curves never appeared in the
// Graph Editor, so the object looked "animated but invisible to the editor".
// These helpers pull each *changing* channel of a clip in as a bound track so
// the animation is both visible and editable. We never stop the host's mixer,
// so existing playback is untouched (purely additive).

const _TRACK_COMPS = ['x', 'y', 'z', 'w'];
const _CLIP_TRACK_COLORS = ['#5cd45c', '#5b8cff', '#ffd13b', '#c084fc', '#22d3ee', '#fb7185'];

/** Gather every AnimationClip associated with an object, across common patterns. */
function collectClips(object) {
  if (!object) return [];
  const out = [];
  const ud = object.userData || {};
  const push = (arr) => {
    if (Array.isArray(arr)) arr.forEach(c => { if (c && Array.isArray(c.tracks)) out.push(c); });
  };
  push(ud.animations);
  push(ud.clips);
  push(object.animations);
  push(ud.gltf?.animations);
  // Mixer-stashed clips: read the clips off the mixer's active actions. These
  // are Three.js internals (`_actions`, `action._clip`) but have been stable
  // for years and are the only way to recover clips when a host keeps just the
  // mixer on userData.
  const mixer = ud.mixer;
  if (mixer && Array.isArray(mixer._actions)) {
    mixer._actions.forEach(a => { const c = a?._clip; if (c && Array.isArray(c.tracks)) out.push(c); });
  }
  return [...new Set(out)];
}

/**
 * Resolve a KeyframeTrack name (e.g. '.position', 'Head.quaternion',
 * 'material.opacity') to { bindObj, propPath } relative to `object`. Handles
 * the single-target leading-dot form and node-prefixed GLTF form.
 */
function resolveTrackTarget(object, rawName) {
  let path = String(rawName || '').replace(/^\./, '');
  if (!path) return null;
  const dot = path.indexOf('.');
  if (dot > 0) {
    const head = path.slice(0, dot);
    const rest = path.slice(dot + 1);
    // If `head` names a child node in the hierarchy, bind to that child and use
    // the remainder as the property path. Otherwise `head` is a property of the
    // object itself (e.g. 'material'), so keep the full path.
    const child = object.getObjectByName?.(head);
    if (child && object[head] === undefined) return { bindObj: child, propPath: rest };
  }
  return { bindObj: object, propPath: path };
}

/**
 * Convert an AnimationClip's tracks into bound graph-editor tracks and add the
 * changing ones to `editor`. Skips constant channels (clutter) and quaternion
 * tracks (per-component quaternion editing isn't meaningful in a scalar f-curve
 * editor). Dedupes by track name via `seen`. Returns the number added.
 */
function importClipTracks(editor, object, name, clip, seen, colorRef) {
  if (!editor || !object || !clip || !Array.isArray(clip.tracks)) return 0;
  const existing = new Set((editor.getTracksFull?.() || []).map(t => t.name));
  const label = name || object.name || 'object';
  let added = 0;
  for (const kt of clip.tracks) {
    if (!kt?.name) continue;
    if (/quaternion/i.test(kt.name)) continue; // not scalar-editable here
    const target = resolveTrackTarget(object, kt.name);
    if (!target) continue;
    const times = kt.times || [];
    const values = kt.values || [];
    if (!times.length || !values.length) continue;
    const size = typeof kt.getValueSize === 'function'
      ? kt.getValueSize() : Math.max(1, Math.round(values.length / times.length));
    for (let c = 0; c < size; c++) {
      let min = Infinity, max = -Infinity;
      const keys = [];
      for (let k = 0; k < times.length; k++) {
        const v = values[k * size + c];
        keys.push({ time: times[k], value: v, easing: 'linear' });
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min < 1e-6) continue; // constant component — don't clutter
      const compPath = size > 1 ? `${target.propPath}.${_TRACK_COMPS[c] ?? c}` : target.propPath;
      const trackName = `${label} · ${compPath}`;
      if (existing.has(trackName) || seen.has(trackName)) continue;
      seen.add(trackName);
      editor.addTrackBound({
        name: trackName,
        color: _CLIP_TRACK_COLORS[(colorRef.i++) % _CLIP_TRACK_COLORS.length],
        binding: { object: target.bindObj, path: compPath },
        keys,
      });
      added++;
    }
  }
  return added;
}

// ─── Built-in workflow registry ──────────────────────────────────────────
export const WORKFLOWS = {

  // ── 3D scene workflow ──
  // Transform of selected objects happens IN THE CANVAS via the gizmo
  // (drag the handles, or G/R/S to switch mode, Esc to deselect). The panel
  // shows only what the canvas can't: tool mode toggle, special gizmo picker,
  // camera params, and light intensities.
  '3d': {
    label: '3D Scene',
    description: 'Canvas gizmos + scene tree + lights + camera. Transform lives in the viewport.',
    setup(ui, opts = {}) {
      // The Move/Rotate/Scale switcher lives in the contextual toolbar
      // pinned to the Inspector's left edge (appears only on selection).
      // Putting it here too was redundant. Keyboard shortcuts G/R/S +
      // X/Y/Z (modal transform) cover power users; the contextual toolbar
      // covers mouse users.

      // Special Gizmos used to live here. We dropped the folder — the
      // standard Move/Rotate/Scale toolbar covers the day-to-day, and
      // host apps that actually want one of the extra gizmos can call
      // `ui.gizmos.attach(name, target)` directly from their own UI.

      // Camera, like Lighting, is now selection-gated: selecting any
      // registered camera in the outliner pops the contextual "Camera
      // Settings" folder with FOV, lens mm, focal object, etc. Having a
      // separate always-visible Camera folder here was just a redundant
      // FOV slider.
    },
  },

  // ── Animation / motion graphics ──
  // Loads full Blender-style F-Curve / Dope Sheet graph editor with keyframes,
  // transport, and optional AI-prompt-driven editing.
  'animation': {
    label: 'Animation',
    description: 'Keyframes, F-curves, dope sheet, transport, prompt-driven edits.',
    teardown(ui) {
      // Detach the spacebar handler when the workflow is disabled
      if (ui._animationKeyHandler) {
        window.removeEventListener('keydown', ui._animationKeyHandler);
        ui._animationKeyHandler = null;
      }
      // Stop importing late-registered clips into a torn-down editor.
      ui._animClipImportUnsub?.();
      ui._animClipImportUnsub = null;
      ui._graphEditor?.dispose();
      ui._graphEditor = null;
    },
    async setup(ui, opts = {}) {
      // Dynamic import so the animation module doesn't load until needed
      const mod = await import('./animation.js');

      // ── Spacebar = play / pause ──
      // No bottom transport toolbar: it duplicated the Graph Editor's own
      // transport. Keep playback control accessible without UI chrome via
      // the standard space-key convention.
      ui._animationKeyHandler = (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
        if (e.code === 'Space') {
          e.preventDefault();
          const ed = ui._graphEditor;
          if (!ed) return;
          if (ed.isPlaying?.()) ed.pause();
          else ed.play();
        }
      };
      window.addEventListener('keydown', ui._animationKeyHandler);

      // Collapsed by default: the editor is tall, and most sessions open
      // the panel just to peek at one property — having it pre-expanded
      // pushes everything else off-screen.
      const graphFolder = ui.addFolder('Graph Editor', { collapsed: true });
      const duration = opts.duration ?? 4;
      const tracks = opts.tracks || [
        // Sensible defaults so the user sees something on first paint
        { name: 'position.x', color: '#ff5050', keys: [
          { time: 0, value: 0 }, { time: duration, value: 5, easing: 'easeInOut' },
        ]},
        { name: 'position.y', color: '#50ff50', keys: [
          { time: 0, value: 0 }, { time: duration, value: 2, easing: 'easeIn' },
        ]},
        { name: 'rotation.z', color: '#5080ff', keys: [
          { time: 0, value: 0 }, { time: duration / 2, value: Math.PI, easing: 'easeOut' },
          { time: duration, value: 0, easing: 'easeIn' },
        ]},
      ];
      const editor = mod.createGraphEditor({
        tracks,
        duration,
        // Timing settings the exporters read back via getSettings(). Default to
        // 30fps and infinite looping (the prior hard-coded export behavior).
        fps: opts.fps ?? 30,
        loop: opts.loop ?? true,
        height: opts.height ?? 280,
        onUpdate: opts.onUpdate || (() => {}),
        onChange: opts.onChange || (() => {}),
        onPrompt: opts.onPrompt,
        getBindableTargets: opts.getBindableTargets || (() => {
          const om = ui.objectManager;
          if (!om?.getNames) return [];
          return om.getNames().map(n => ({ name: n, object: om.getObject?.(n) })).filter(t => t.object);
        }),
        getSelected: opts.getSelected || (() => ui.objectManager?.activeName || null),
      });
      graphFolder.addRaw(editor.element);
      ui._graphEditor = editor;

      // ── Auto-import existing AnimationClips as bound tracks ──
      // Objects animated by a clip/mixer were detectable enough to switch this
      // workflow on, yet their curves never showed in the editor. Pull each
      // changing channel in so the animation is visible AND editable. We don't
      // stop the host mixer, so current playback is unaffected.
      const _seenClipTracks = new Set();
      const _clipColor = { i: 0 };
      const importFor = (name, object) => {
        collectClips(object).forEach(clip =>
          importClipTracks(editor, object, name, clip, _seenClipTracks, _clipColor));
      };
      // Sweep objects already registered (hosts that register before setup).
      const om = ui.objectManager;
      if (om?.objects) {
        for (const [name, entry] of Object.entries(om.objects)) importFor(name, entry?.object);
      }
      // React to LATE registration — the common case: hosts register objects
      // after createGhostPanel returns, so the animated node isn't in the
      // manager when this setup runs. Replace any handler from a prior setup()
      // so re-running the workflow doesn't stack subscriptions.
      ui._animClipImportUnsub?.();
      ui._animClipImportUnsub = om?.on
        ? om.on('register', (name, object) => importFor(name, object))
        : null;

      // Sync the graph editor with the Outliner: when an object is removed
      // from the scene, drop every track bound to it (covers dopesheet,
      // f-curve, and the bind picker — they all read from state.tracks).
      if (ui.objectManager?.on && editor.pruneTracksFor) {
        ui.objectManager.on('remove', (_name, object) => editor.pruneTracksFor(object));
      }
    },
  },

  // ── Shader workflow ──
  // Uniform editors, time/resolution, render target inspector
  'shader': {
    label: 'Shader',
    description: 'Uniform editors, time, resolution, frame inspector.',
    setup(ui, opts = {}) {
      const sysFolder = ui.addFolder('System', { collapsed: true });
      sysFolder.addInfo(`Frame: 0 | FPS: 0`, 'frame-info');
      sysFolder.addSlider('Time', {
        min: 0, max: 60, value: 0, step: 0.01,
        tooltip: 'Manually scrub the shader\'s u_time uniform',
      });
      sysFolder.addCheckbox('Auto-advance time', {
        value: true,
        tooltip: 'Increment u_time every frame (uncheck to freeze)',
      });

      // Uniforms — the caller provides a map of { name: { type, value, owner?, ... } }
      // When a uniform declares an `owner` (Object3D / material / name), the
      // folder only appears in the panel while that owner is selected — the
      // same selection-gating contract used by Material / Properties.
      const uniforms = opts.uniforms || {};
      if (Object.keys(uniforms).length > 0) {
        // Build a name → owners map so the predicate can resolve quickly.
        const owners = new Set();
        Object.values(uniforms).forEach(u => { if (u?.owner) owners.add(u.owner); });
        const uf = ui.addFolder('Uniforms', owners.size ? {
          showWhen: () => {
            const name = ui.objectManager?.activeName;
            if (!name) return false;
            const obj = ui.objectManager.getObject(name);
            if (!obj) return false;
            // Match by exact reference, by name, or by the mesh's material.
            for (const owner of owners) {
              if (owner === obj) return true;
              if (owner === obj?.material) return true;
              if (typeof owner === 'string' && owner === name) return true;
            }
            return false;
          },
        } : {});
        Object.entries(uniforms).forEach(([name, u]) => {
          if (u.type === 'float' || u.type === 'f') {
            uf.addSlider(name, {
              min: u.min ?? 0, max: u.max ?? 1, value: u.value ?? 0, step: u.step ?? 0.01,
              tooltip: u.tooltip || `float uniform ${name}`,
              onChange: u.onChange || (() => {}),
            });
          } else if (u.type === 'vec3' || u.type === 'color') {
            if (u.type === 'color') {
              uf.addColor(name, { value: u.value || '#ffffff', onChange: u.onChange || (() => {}), tooltip: u.tooltip });
            } else {
              uf.addVec3(name, {
                min: u.min ?? -1, max: u.max ?? 1, step: u.step ?? 0.01,
                value: u.value || { x: 0, y: 0, z: 0 },
                onChange: u.onChange || (() => {}),
                tooltip: u.tooltip,
              });
            }
          } else if (u.type === 'bool' || u.type === 'b') {
            uf.addCheckbox(name, { value: !!u.value, onChange: u.onChange || (() => {}), tooltip: u.tooltip });
          } else if (u.type === 'int') {
            uf.addStepper(name, {
              min: u.min ?? 0, max: u.max ?? 100, step: 1, value: u.value ?? 0,
              onChange: u.onChange || (() => {}),
              tooltip: u.tooltip,
            });
          }
        });
      }

      // Show UV / Show Normals / Show Depth / Wireframe live in the
      // contextual mini toolbar (4 icon buttons under the camera row).
      // See attachContextualInspector() in contextual.js.
    },
  },

  // ── ASCII art workflow ──
  // Character palette, font size, charset, render-to-text inspector
  'ascii': {
    label: 'ASCII',
    description: 'Charset selection, font, palette, density mapping for ASCII renders.',
    setup(ui, opts = {}) {
      const charset = ui.addFolder('Charset');
      charset.addSelect('Preset', {
        options: ['Standard', 'Dense', 'Sparse', 'Block', 'Braille', 'Custom'],
        value: 'Standard',
        tooltip: 'Pick a character palette ordered by visual density',
        onChange: () => {},
      });
      charset.addText('Custom', {
        value: ' .:-=+*#%@',
        placeholder: 'Characters dark → bright',
        tooltip: 'Override with a custom character ramp',
      });

      const grid = ui.addFolder('Grid');
      // Columns + Rows paired side-by-side (semantic siblings).
      grid.addPairedNumbers([
        { label: 'Columns', value: 120, min: 20, max: 400, step: 1, tooltip: 'Horizontal character count' },
        { label: 'Rows',    value: 60,  min: 10, max: 200, step: 1, tooltip: 'Vertical character count' },
      ]);
      grid.addSlider('Font Size', { min: 4, max: 32, value: 10, step: 0.5, tooltip: 'Pixel size of each character', suffix: 'px' });
      grid.addSlider('Line Height', { min: 0.5, max: 2, value: 1, step: 0.05, tooltip: 'Vertical spacing multiplier' });

      const color = ui.addFolder('Color');
      color.addColor('Foreground', { value: '#ffffff', tooltip: 'Character color' });
      color.addColor('Background', { value: '#000000', tooltip: 'Background color' });
      color.addCheckbox('Color from source', { value: false, tooltip: 'Take each char\'s color from the source image' });
      color.addCheckbox('Invert',           { value: false, tooltip: 'Invert dark/bright mapping' });

      const fx = ui.addFolder('FX', { collapsed: true });
      fx.addSlider('Glow', { min: 0, max: 2, value: 0, step: 0.01, tooltip: 'Add a CRT-style glow halo' });
      fx.addSlider('Scanline', { min: 0, max: 1, value: 0, step: 0.01, tooltip: 'Horizontal scanline overlay' });
    },
  },

  // ── 2D canvas / generative art ──
  '2d': {
    label: '2D Canvas',
    description: 'Generative art controls: size, palette, noise, animation.',
    setup(ui, opts = {}) {
      // Workflow-level folders are scene-wide settings (canvas size,
      // palette, noise). When the user selects an object they want to
      // see THAT object's properties, not these — so hide each on
      // selection. Mirrors the 3D pattern where the inspector focuses
      // on the selected object's affordances.
      const noSelection = () => !ui.objectManager?.activeName;

      const canvas = ui.addFolder('Canvas', { showWhen: noSelection });
      canvas.addPairedNumbers([
        { label: 'Width',  value: 1024, unit: 'px', min: 64, max: 4096, step: 16 },
        { label: 'Height', value: 1024, unit: 'px', min: 64, max: 4096, step: 16 },
      ]);
      canvas.addColor('Background', { value: '#0a0a0a' });

      const palette = ui.addFolder('Palette', { showWhen: noSelection });
      ['Primary', 'Secondary', 'Accent', 'Highlight'].forEach((name, i) => {
        const defaults = ['#ff5577', '#5577ff', '#ffaa44', '#44ffaa'];
        palette.addColor(name, { value: defaults[i] });
      });

      const noise = ui.addFolder('Noise', { showWhen: noSelection });
      noise.addSlider('Scale',     { min: 0.01, max: 2, value: 0.4, step: 0.01 });
      noise.addSlider('Octaves',   { min: 1, max: 8, value: 4, step: 1 });
      noise.addSlider('Lacunarity',{ min: 1, max: 4, value: 2, step: 0.1 });
      noise.addNumber('Seed', { min: 0, max: 9999, step: 1, value: 0 });
    },
  },

  // ── Audio / DSP workflow ──
  // ── Web elements / DOM workflow ──
  // Inspect and animate real DOM elements: x/y/rotation/width/height/opacity
  // all bind through `createWebAdapter` so they show up in the Outliner,
  // respond to the mini toolbar + G/R/S keys, and are tween-able from the
  // graph editor. Host code drives registration via `ui._registerWebElement`
  // or by calling `createWebAdapter` directly.
  'web': {
    label: 'Web Elements',
    description: 'Inspect & animate DOM elements (CSS transforms + opacity).',
    setup(ui, opts = {}) {
      // Page-level controls only show when nothing is selected. Once
      // the user clicks an element the inspector focuses on per-element
      // properties (Properties, Typography), same as the 3D pattern.
      const noSelection = () => !ui.objectManager?.activeName;
      const page = ui.addFolder('Page', { showWhen: noSelection });
      // The Background picker defaults to painting <body>. Many hosts
      // cover body with a full-bleed container (canvas, fixed stage,
      // app shell) — in that case body's background is invisible and
      // the picker appears broken. Two escape hatches:
      //   opts.backgroundTargets — array of selectors or elements to
      //     also paint. Most ergonomic: `['.stage', myCanvasEl]`.
      //   opts.onBackgroundChange — full takeover. Receives the new
      //     color string; called on every change. Use when you want
      //     completely custom routing (e.g. setting a CSS variable).
      const resolveTargets = () => {
        const list = opts.backgroundTargets || [];
        return list.map(t => typeof t === 'string' ? document.querySelector(t) : t)
                   .filter(Boolean);
      };
      page.addColor('Background', {
        value: opts.background || '#0a0a0a',
        tooltip: 'Document background color',
        onChange: opts.onBackgroundChange || ((c) => {
          document.body.style.background = c;
          for (const el of resolveTargets()) el.style.background = c;
        }),
      });
      page.addCheckbox('Show Hit Targets', {
        value: false,
        tooltip: 'Outline every registered element so they\'re easy to click',
        onChange: (v) => {
          document.querySelectorAll('[data-ghost-panel-adapter]').forEach(el => {
            el.style.outline = v ? '1px dashed hsl(0 0% 100% / 0.4)' : '';
          });
        },
      });

      // Keep the DOM in sync with the object registry. The base
      // ObjectManager.remove() is registry-only (unlike the 3D
      // SceneObjectManager, which also detaches the mesh), so a web
      // adapter removed via outliner-× OR undo-of-add would otherwise
      // leave its real DOM node orphaned on the page — visible but
      // unselectable. Detach on remove, stash where it lived, and
      // re-attach on (re-)register so undo/redo and delete/restore round
      // trip. Guarded so workflow re-runs don't stack duplicate
      // listeners.
      if (!ui._webDomSync && ui.objectManager?.on) {
        ui._webDomSync = true;
        ui.objectManager.on('remove', (_name, obj) => {
          const el = obj && obj._el;
          if (!el || !el.parentNode) return;
          obj._detachedParent = el.parentNode;
          obj._detachedNext = el.nextSibling;
          el.parentNode.removeChild(el);
        });
        ui.objectManager.on('register', (_name, obj) => {
          const el = obj && obj._el;
          if (!el || el.parentNode) return; // already in the DOM (host-mounted)
          const parent = (obj._detachedParent && obj._detachedParent.isConnected)
            ? obj._detachedParent : document.body;
          const next = (obj._detachedNext && obj._detachedNext.parentNode === parent)
            ? obj._detachedNext : null;
          parent.insertBefore(el, next);
        });
      }

      // Click-to-select on the page — opt-in via the workflow so it only
      // hijacks pointer events when the user actually asked for web mode.
      import('./web-adapter.js').then(({ enableWebSelection }) => {
        ui._disableWebSelection = enableWebSelection(ui);
      });

      // ── Add-menu factories for the Web workflow ──
      // Without these, Shift+A shows an empty menu on any web host. Each
      // factory spawns a styled DOM element, wraps it with
      // createWebAdapter (so it's inspectable + animatable + draggable
      // via the 2D gizmo), then registers + selects it. Styles are inline
      // so this works in ANY web host, not just the demo (which carries
      // its own .el CSS). Registration is idempotent — the add-menu
      // replaces factories by id, so a workflow re-run won't duplicate.
      Promise.all([
        import('./web-adapter.js'),
        import('./icons.js'),
      ]).then(([{ createWebAdapter }, { icons }]) => {
        if (!ui._addMenu) return;

        let _webAddCount = 0;
        // Append a freshly-styled element to <body>, give it the
        // transform contract createWebAdapter relies on (fixed +
        // transform-origin 0 0), and compute a centred-with-scatter
        // spawn point. innerWidth/innerHeight fall back to 1280×720 for
        // hidden/headless tabs (preview, backgrounded window) where they
        // read 0 — without that guard a new element lands at 0,0.
        function place(el, w, h) {
          _webAddCount += 1;
          const W = innerWidth || 1280, H = innerHeight || 720;
          const jitter = (_webAddCount % 6) * 28;
          Object.assign(el.style, {
            position: 'fixed', top: '0', left: '0',
            // NB: no permanent `will-change` here. A standing will-change on
            // every spawned element keeps a compositor layer alive for the
            // life of the element, which costs memory and can slow rendering
            // more than it helps. The 2D gizmo sets will-change only for the
            // duration of an active drag and clears it on release (see
            // gizmo-2d.js _beginDrag/_endDrag), which is what the hint is for.
            transformOrigin: '0 0',
            cursor: 'grab', userSelect: 'none', boxSizing: 'border-box',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
            fontWeight: '600', letterSpacing: '-0.02em',
          });
          document.body.appendChild(el);
          return {
            x: Math.max(8, W * 0.5 - w / 2 + jitter),
            y: Math.max(8, H * 0.5 - h / 2 + jitter),
          };
        }
        function finish(el, w, h, name) {
          const { x, y } = place(el, w, h);
          const adapter = createWebAdapter(el, { name, x, y, baseWidth: w, baseHeight: h });
          ui.objectManager.register(adapter.name, adapter);
          ui.objectManager.select(adapter.name);
          ui.refreshSceneObjects?.();
          return adapter;
        }

        ui._addMenu.register({
          id: 'web-card', label: 'Card', category: 'Web', workflows: ['web'], icon: icons.rectangle,
          build: ({ name }) => {
            const el = document.createElement('div');
            el.textContent = 'Card';
            // Solid fill (not a gradient) so the inspector's Fill color
            // picker is truthful — getComputedStyle().backgroundColor only
            // reports solid colors, so a gradient would seed Fill as
            // transparent and editing it would wipe the look.
            Object.assign(el.style, {
              width: '220px', height: '140px', borderRadius: '18px',
              background: '#3b6fe0',
              color: '#fff', fontSize: '16px',
              boxShadow: '0 18px 40px hsl(220 80% 30% / 0.45)',
            });
            return finish(el, 220, 140, name);
          },
        });
        ui._addMenu.register({
          id: 'web-button', label: 'Button', category: 'Web', workflows: ['web'], icon: icons.buttonPill,
          build: ({ name }) => {
            const el = document.createElement('button');
            el.textContent = 'Button';
            Object.assign(el.style, {
              width: '160px', height: '48px', borderRadius: '24px', border: '0',
              background: '#22b07d',
              color: '#fff', fontSize: '15px',
              boxShadow: '0 14px 30px hsl(160 70% 30% / 0.45)',
            });
            return finish(el, 160, 48, name);
          },
        });
        ui._addMenu.register({
          id: 'web-text', label: 'Text', category: 'Web', workflows: ['web'], icon: icons.textT,
          build: ({ name }) => {
            const el = document.createElement('div');
            el.textContent = 'Text';
            Object.assign(el.style, {
              padding: '4px 8px', color: '#fff', fontSize: '32px',
              background: 'transparent', whiteSpace: 'nowrap',
            });
            return finish(el, 140, 44, name);
          },
        });
      });
    },
  },

  'audio': {
    label: 'Audio',
    description: 'Volume, EQ bands, effect sends, frequency analyzer.',
    setup(ui, opts = {}) {
      const master = ui.addFolder('Master');
      master.addDial('Volume',  { min: 0, max: 1, value: 0.7, suffix: '' });
      master.addDial('Pan',     { min: -1, max: 1, value: 0, step: 0.01 });
      master.addXYPad('Position', { value: { x: 0.5, y: 0.5 }, tooltip: 'Stereo + depth position' });

      const eq = ui.addFolder('EQ');
      ['Low', 'Mid', 'High'].forEach(band => {
        eq.addDial(band, { min: -24, max: 24, value: 0, step: 0.1, suffix: 'dB' });
      });

      const sends = ui.addFolder('Sends');
      sends.addSlider('Reverb',  { min: 0, max: 1, value: 0.2 });
      sends.addSlider('Delay',   { min: 0, max: 1, value: 0.1 });
      sends.addSlider('Chorus',  { min: 0, max: 1, value: 0 });
    },
  },
};

/**
 * Try to auto-detect appropriate workflow(s) from createGhostPanel options
 * AND by scanning the live scene. Returns an ARRAY of workflow names so
 * multiple can be active at once (e.g. a 3D scene that also has a custom
 * shader gets ['3d', 'shader']).
 */
export function detectWorkflows(opts) {
  const found = new Set();

  // From explicit options
  if (opts.scene && opts.camera && opts.renderer) found.add('3d');
  if (opts.uniforms && Object.keys(opts.uniforms).length > 0) found.add('shader');
  if (opts.canvas2d) found.add('2d');
  if (opts.audioContext || opts.audio) found.add('audio');
  if (opts.tracks || opts.duration) found.add('animation');
  if (opts.ascii || opts.charset) found.add('ascii');

  // Web adapters → Web Elements workflow. The host registers DOM
  // elements through createWebAdapter, which tags them with
  // `data-ghost-panel-adapter`. Detect either via that DOM attribute OR
  // via an objectManager entry whose object has `_isWebAdapter: true`
  // (the adapter sets this so we don't need to read DOM here).
  // Detection re-runs on each `register` event, so adapters added
  // AFTER createGhostPanel (which is the common pattern) still light up.
  if (typeof document !== 'undefined' &&
      document.querySelector?.('[data-ghost-panel-adapter]')) {
    found.add('web');
  }
  if (opts.objectManager?.objects) {
    for (const entry of Object.values(opts.objectManager.objects)) {
      const obj = entry?.object || entry;
      if (obj?._isWebAdapter || obj?.element instanceof HTMLElement) {
        found.add('web');
        break;
      }
    }
  }

  // Scan the Three.js scene for ambient signals
  if (opts.scene && typeof opts.scene.traverse === 'function') {
    opts.scene.traverse(node => {
      if (!node) return;
      // Custom shaders → shader workflow
      const m = node.material;
      const materials = Array.isArray(m) ? m : (m ? [m] : []);
      materials.forEach(mat => {
        if (!mat) return;
        const type = mat.type || mat.constructor?.name;
        if (type === 'ShaderMaterial' || type === 'RawShaderMaterial') {
          found.add('shader');
        }
        // ASCII heuristic — a shader with uniforms like `u_chars` or named ascii-ish
        const u = mat.uniforms || {};
        if (u.uChars || u.u_chars || u.charset || u.uCharset || mat.userData?.ascii) {
          found.add('ascii');
        }
      });
      // Animation signals — detect across every common pattern. Hosts
      // wire animation a dozen different ways: AnimationMixer stashed
      // in userData (one pattern), clips attached directly to the
      // node (GLTFLoader's default), an `isAnimated` flag, or a
      // SkinnedMesh that implies a rig. Any one of these lights up
      // the animation workflow so the Graph Editor folder appears.
      if (
        node.userData?.mixer ||
        node.userData?.animations?.length ||
        node.userData?.clips?.length ||
        node.animations?.length ||
        node.isSkinnedMesh ||
        node.isBone ||
        node.type === 'AnimationMixer'
      ) {
        found.add('animation');
      }
      // AudioListener / PositionalAudio
      const ntype = node.type || node.constructor?.name;
      if (ntype === 'AudioListener' || ntype === 'Audio' || ntype === 'PositionalAudio') {
        found.add('audio');
      }
    });
    // If we got at least 3D infrastructure, ensure 3d is included
    if (opts.camera && opts.renderer) found.add('3d');
  }

  // Also honor user-provided list of mixers/animations
  if (Array.isArray(opts.mixers) && opts.mixers.length > 0) found.add('animation');
  // Or a single mixer passed via `opts.mixer` (singular, common in
  // simple GLTF setups where the host keeps one mixer at the top
  // level rather than per-object).
  if (opts.mixer) found.add('animation');
  // Or an animations array next to the scene root — GLTFLoader puts
  // them at `gltf.animations`, projects often forward that here.
  if (Array.isArray(opts.animations) && opts.animations.length > 0) found.add('animation');

  // Inspect any registered object's `userData.gltf.animations` —
  // projects with their own GLTF loader (like Brick Phone Landing's
  // `loadGLTF`) store the entire `gltf` result on `userData.gltf` or
  // an external entry. We accept either flavor: a `gltf` attribute on
  // userData OR the host's object-manager entry shape `{ group, gltf }`.
  if (opts.objectManager?.objects) {
    for (const entry of Object.values(opts.objectManager.objects)) {
      const g = entry?.gltf || entry?.object?.userData?.gltf;
      if (Array.isArray(g?.animations) && g.animations.length > 0) {
        found.add('animation');
        break;
      }
    }
  }

  // Web / DOM projects with CSS animations or WAAPI consumers — the
  // Graph Editor doubles as a CSS keyframe driver via the css-keyframes
  // exporter, so make it available whenever the host activates web mode.
  if (Array.isArray(opts.workflow) && opts.workflow.includes('web')) found.add('animation');

  // ── Universal Graph Editor for any 3D project ──────────────────────
  // Even without pre-loaded animations, the Graph Editor is a general-
  // purpose property animator: a user can bind a track to any property
  // of any registered object via "+ Bind property" and scrub time. So
  // any project that has a Three.js scene benefits from having it
  // available. The folder ships collapsed by default — see
  // workflows.js setup → `ui.addFolder('Graph Editor', { collapsed: true })`
  // — so it doesn't dominate the panel when no animations exist yet.
  // Hosts that explicitly don't want it can pass
  // `workflow: ['3d']` (no animation) to opt out.
  if (found.has('3d')) found.add('animation');

  return [...found];
}

/** Back-compat: single-workflow detection returns the first match. */
export function detectWorkflow(opts) {
  return detectWorkflows(opts)[0] || null;
}

// ─── Multi-workflow management ─────────────────────────────────────────
// The UI keeps a map: workflow id → list of folder names it added. Adding
// the same workflow twice is a no-op. Removing tears down only that
// workflow's folders.

/**
 * Enable (or refresh) a workflow on the UI. If already active, this re-runs
 * setup with new opts (folders are removed and re-added).
 */
export function enableWorkflow(ui, name, opts = {}) {
  const w = WORKFLOWS[name];
  if (!w) {
    log.warn('workflows', `Unknown workflow "${name}". Available: ${Object.keys(WORKFLOWS).join(', ')}`);
    return;
  }
  ui._workflowFolderMap = ui._workflowFolderMap || new Map();

  // Remove existing folders for this workflow first
  if (ui._workflowFolderMap.has(name)) {
    ui._workflowFolderMap.get(name).forEach(fn => ui.panel.removeFolder(fn));
  }

  const before = new Set(Object.keys(ui.panel.folders));
  w.setup(ui, opts);
  const added = Object.keys(ui.panel.folders).filter(n => !before.has(n));
  ui._workflowFolderMap.set(name, added);

  // Maintain a Set of active workflow names
  ui._activeWorkflows = ui._activeWorkflows || new Set();
  ui._activeWorkflows.add(name);
  return ui;
}

/** Disable a single workflow. Runs the workflow's `teardown()` if defined. */
export function disableWorkflow(ui, name) {
  if (!ui._workflowFolderMap?.has(name)) return;
  ui._workflowFolderMap.get(name).forEach(fn => ui.panel.removeFolder(fn));
  ui._workflowFolderMap.delete(name);
  ui._activeWorkflows?.delete(name);
  WORKFLOWS[name]?.teardown?.(ui);
}

/** Get currently active workflow names as an array. */
export function getActiveWorkflows(ui) {
  return [...(ui._activeWorkflows || [])];
}

/**
 * Back-compat single-workflow apply: now wraps enableWorkflow, but ALSO
 * disables any previously-active workflows so it behaves like a "switch".
 * Use enableWorkflow/disableWorkflow for additive behavior.
 */
export function applyWorkflow(ui, name, opts = {}) {
  // Disable all currently-active workflows first (back-compat behavior)
  [...(ui._activeWorkflows || [])].forEach(n => disableWorkflow(ui, n));
  enableWorkflow(ui, name, opts);
  ui._activeWorkflow = name; // legacy field
  return ui;
}

/**
 * Run ambient detection on the scene (and any user hints) and synchronize
 * the active workflows to match. Newly-detected workflows are enabled;
 * workflows that no longer apply are NOT auto-disabled (the user may have
 * enabled them manually). Pass { strict: true } to make detection
 * authoritative (auto-disable too).
 */
export function scanAndApply(ui, opts = {}, scanOpts = {}) {
  const detected = detectWorkflows(opts);
  const active = new Set(getActiveWorkflows(ui));
  detected.forEach(name => {
    if (!active.has(name)) enableWorkflow(ui, name, opts);
  });
  if (scanOpts.strict) {
    [...active].forEach(name => {
      if (!detected.includes(name)) disableWorkflow(ui, name);
    });
  }
  return detected;
}

/** Return a list of all built-in workflow names + their descriptions. */
export function listWorkflows() {
  return Object.entries(WORKFLOWS).map(([id, w]) => ({
    id, label: w.label, description: w.description,
  }));
}
