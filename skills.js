/**
 * Skills — declarative, composable units of UI + behavior.
 *
 * A workflow (3D, 2D, animation, shader, ascii, audio, ...) is a BUNDLE of
 * skills. A skill is a self-contained capability: a set of properties, a
 * tool, or a behavior. Skills can be:
 *
 *   • Auto-detected from the project (scene contents, registered systems)
 *   • Manually enabled / disabled by the user
 *   • Suggested by the system based on usage patterns
 *   • Introspected and augmented by AI agents
 *
 * This is what the imperative `workflow.setup()` functions were doing —
 * but flattened into discrete data-driven units. The benefits:
 *
 *   1. AI agents can `describe()` the available skills and propose new ones.
 *   2. Users can opt in / out of individual capabilities without disabling
 *      a whole workflow.
 *   3. Usage telemetry can recommend skills the user might want.
 *   4. Skills compose — adding a "GLB import" skill works whether you're
 *      in the 3D, animation, or shader workflow.
 */

// ─── Skill schema ───────────────────────────────────────────────────────
//
// A skill is a plain object:
//
//   {
//     id:          'lighting',                    // unique identifier
//     name:        'Lighting',                    // human label
//     category:    '3D',                          // grouping
//     workflows:   ['3d'],                        // workflows that auto-include
//     description: 'Edit intensity/color/...',    // shown in suggestion UI
//     properties:  [                              // schema for introspection
//       { id: 'intensity', type: 'number', min: 0, max: 10 },
//       { id: 'color',     type: 'color' },
//     ],
//     detect(ctx): bool                           // is this skill relevant?
//     apply(ui, ctx): handle | Promise<handle>    // mount the skill's UI
//     teardown?(ui, handle)                       // unmount (optional)
//   }
//
// `ctx` is { scene, camera, renderer, canvas, opts, … } — whatever
// information was passed to createGhostPanel.

export class SkillsRegistry {
  constructor() {
    this.skills = new Map();
    this.appliedHandles = new Map();   // id → handle returned from apply()
    this.usage = new Map();            // id → { uses, lastUsed }
    this.listeners = { change: [] };
  }

  /** Register a skill definition. Idempotent. */
  register(skill) {
    if (!skill?.id) throw new Error('Skill must have an id');
    this.skills.set(skill.id, skill);
    this._emit('change');
    return skill;
  }

  /** Unregister a skill (also tears it down if applied). */
  unregister(id) {
    if (this.appliedHandles.has(id)) this.remove(id);
    this.skills.delete(id);
    this._emit('change');
  }

  /** Update an existing skill's fields (for AI augmentation). */
  update(id, partial) {
    const existing = this.skills.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...partial };
    this.skills.set(id, merged);
    // If applied, re-apply with new definition
    if (this.appliedHandles.has(id)) {
      this.remove(id);
      this.apply(this._ui, id, this._lastCtx);
    }
    this._emit('change');
    return merged;
  }

  list({ workflow, category, applied } = {}) {
    let arr = [...this.skills.values()];
    if (workflow)  arr = arr.filter(s => s.workflows?.includes(workflow));
    if (category)  arr = arr.filter(s => s.category === category);
    if (applied !== undefined) arr = arr.filter(s => this.appliedHandles.has(s.id) === applied);
    return arr;
  }

  get(id) { return this.skills.get(id); }
  isApplied(id) { return this.appliedHandles.has(id); }

  /** Mount a skill's UI. */
  async apply(ui, id, ctx = {}) {
    if (this.appliedHandles.has(id)) return this.appliedHandles.get(id);
    const skill = this.skills.get(id);
    if (!skill?.apply) return null;
    this._ui = ui;
    this._lastCtx = ctx;
    const handle = await skill.apply(ui, ctx);
    this.appliedHandles.set(id, handle ?? {});
    this._markUsed(id);
    this._emit('change');
    return handle;
  }

  /** Unmount a skill's UI. */
  remove(id) {
    const handle = this.appliedHandles.get(id);
    if (handle === undefined) return;
    const skill = this.skills.get(id);
    skill?.teardown?.(this._ui, handle);
    this.appliedHandles.delete(id);
    this._emit('change');
  }

  /**
   * Auto-detect which skills are relevant given a context and apply them.
   * Skills whose detect() returns true are mounted; previously-mounted
   * skills whose detect() now returns false are unmounted (in strict mode).
   */
  async autoApply(ui, ctx = {}, { strict = false } = {}) {
    const detected = [];
    for (const skill of this.skills.values()) {
      const ok = skill.detect ? !!skill.detect(ctx) : true;
      if (ok && !this.appliedHandles.has(skill.id)) {
        await this.apply(ui, skill.id, ctx);
        detected.push(skill.id);
      } else if (!ok && strict && this.appliedHandles.has(skill.id)) {
        this.remove(skill.id);
      }
    }
    return detected;
  }

  /** Bump a skill's usage counter. */
  _markUsed(id) {
    const u = this.usage.get(id) || { uses: 0, lastUsed: 0 };
    u.uses += 1;
    u.lastUsed = Date.now();
    this.usage.set(id, u);
  }

  /**
   * Suggest skills the user might want to add. Combines:
   *   1. Skills whose detect() matches the current ctx but aren't applied
   *   2. Skills with high historical usage in similar projects
   *   3. Skills the user has applied frequently in past sessions (from local storage)
   */
  suggest(ctx = {}, { max = 5 } = {}) {
    const suggestions = [];
    for (const skill of this.skills.values()) {
      if (this.appliedHandles.has(skill.id)) continue;       // already applied
      const detected = skill.detect ? !!skill.detect(ctx) : false;
      const usage = this.usage.get(skill.id);
      const score = (detected ? 100 : 0) + (usage ? usage.uses * 5 : 0);
      if (score > 0) {
        suggestions.push({ skill, score, reason: detected ? 'detected' : 'frequently used' });
      }
    }
    return suggestions.sort((a, b) => b.score - a.score).slice(0, max);
  }

  /**
   * Serialize the registry for introspection. AI agents can use this to
   * understand what's available and propose changes.
   */
  describe({ includeProperties = true } = {}) {
    return {
      skills: [...this.skills.values()].map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        workflows: s.workflows || [],
        description: s.description,
        properties: includeProperties ? (s.properties || []) : undefined,
        applied: this.appliedHandles.has(s.id),
        uses: this.usage.get(s.id)?.uses || 0,
      })),
      categories: [...new Set([...this.skills.values()].map(s => s.category))],
      workflows: [...new Set([...this.skills.values()].flatMap(s => s.workflows || []))],
    };
  }

  /** Subscribe to registry changes. */
  on(event, cb) { (this.listeners[event] ||= []).push(cb); return () => this.off(event, cb); }
  off(event, cb) {
    this.listeners[event] = (this.listeners[event] || []).filter(x => x !== cb);
  }
  _emit(event, ...args) { (this.listeners[event] || []).forEach(cb => cb(...args)); }

  /**
   * Persist usage stats to localStorage so suggestions improve across
   * sessions. Call once at startup; saves on every change.
   */
  enablePersistence(key = 'ghost-panel-skill-usage') {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      for (const [id, val] of Object.entries(saved)) this.usage.set(id, val);
    } catch {}
    this.on('change', () => {
      try {
        const obj = {};
        this.usage.forEach((v, k) => { obj[k] = v; });
        localStorage.setItem(key, JSON.stringify(obj));
      } catch {}
    });
  }
}

// ─── Built-in skill definitions ────────────────────────────────────────
//
// Each workflow declares its core skills as data. Workflows can also be
// MIXED — you can have a 3D scene with a 2D canvas overlay, in which case
// skills from both workflows light up.
//
// Skill definitions are pure data — AI agents and users can introspect,
// modify, and add to this list at runtime via the SkillsRegistry API.

export const BUILTIN_SKILLS = [
  // ────────────────────────── 3D WORKFLOW ──────────────────────────
  {
    id: '3d.outliner',
    name: 'Scene Outliner',
    category: '3D',
    workflows: ['3d'],
    description: 'Hierarchical scene navigator with click-to-select and visibility toggles.',
    properties: [
      { id: 'visible', type: 'boolean', per: 'object' },
      { id: 'name',    type: 'string',  per: 'object' },
    ],
    detect: (ctx) => !!ctx.scene && !!ctx.objectManager,
    apply: async (ui) => {
      const { addSceneObjectsFolder } = await import('./three-extensions.js');
      if (ui.scenePanel && ui.objectManager) {
        return addSceneObjectsFolder(ui.scenePanel, ui.objectManager);
      }
    },
  },
  {
    id: '3d.transform-gizmo',
    name: 'Transform Gizmo',
    category: '3D',
    workflows: ['3d'],
    description: 'Click-to-select, drag handles, G/R/S keyboard for translate/rotate/scale.',
    properties: [
      { id: 'mode',     type: 'enum', options: ['translate', 'rotate', 'scale'] },
      { id: 'position', type: 'vec3', per: 'object' },
      { id: 'rotation', type: 'euler', per: 'object' },
      { id: 'scale',    type: 'vec3', per: 'object' },
    ],
    detect: (ctx) => !!ctx.scene && !!ctx.camera && !!ctx.renderer,
    apply: () => ({}),   // gizmo is wired in createGhostPanel core
  },
  {
    id: '3d.material-inspector',
    name: 'Material Inspector',
    category: '3D',
    workflows: ['3d'],
    description: 'Auto-shows color, roughness, metalness, emissive, opacity, wireframe for selected mesh.',
    properties: [
      { id: 'color',        type: 'color' },
      { id: 'roughness',    type: 'number', min: 0, max: 1 },
      { id: 'metalness',    type: 'number', min: 0, max: 1 },
      { id: 'emissive',     type: 'color' },
      { id: 'opacity',      type: 'number', min: 0, max: 1 },
      { id: 'wireframe',    type: 'boolean' },
    ],
    detect: (ctx) => !!ctx.objectManager,
    apply: () => ({}),   // material folder is wired by contextual inspector
  },
  {
    id: '3d.lighting',
    name: 'Lighting',
    category: '3D',
    workflows: ['3d'],
    description: 'Intensity, color, and helpers for scene lights.',
    properties: [
      { id: 'intensity', type: 'number', min: 0, max: 20 },
      { id: 'color',     type: 'color' },
      { id: 'castShadow', type: 'boolean' },
    ],
    detect: (ctx) => {
      let has = false;
      ctx.scene?.traverse?.(n => { if (n.isLight) has = true; });
      return has;
    },
    apply: (ui, ctx) => {
      const lights = [];
      ctx.scene?.traverse?.(n => { if (n.isLight) lights.push(n); });
      if (!lights.length) return null;
      const folder = ui.addFolder('Lighting');
      lights.forEach((l, i) => {
        folder.addSlider(`L${i+1} Intensity`, {
          min: 0, max: 20, value: l.intensity, step: 0.01,
          onChange: v => { l.intensity = v; },
        });
        if (l.color) {
          folder.addColor(`L${i+1} Color`, {
            value: '#' + l.color.getHexString(),
            onChange: c => l.color.set(c),
          });
        }
      });
      return { folder };
    },
    teardown: (ui, handle) => handle?.folder && ui.panel.removeFolder('Lighting'),
  },
  {
    id: '3d.add-object',
    name: 'Add Object (Shift+A)',
    category: '3D',
    workflows: ['3d'],
    description: 'Searchable popup of primitives, lights, cameras, images, helpers.',
    properties: [],
    detect: (ctx) => !!ctx.scene && !!ctx.objectManager,
    apply: () => ({}),   // wired in core
  },

  // ────────────────────────── 2D CANVAS WORKFLOW ──────────────────
  {
    id: '2d.canvas-size',
    name: 'Canvas Size',
    category: '2D',
    workflows: ['2d'],
    description: 'Width / height / pixel ratio / background color of the 2D canvas.',
    properties: [
      { id: 'width',  type: 'number', min: 64, max: 8192 },
      { id: 'height', type: 'number', min: 64, max: 8192 },
      { id: 'bg',     type: 'color' },
    ],
    detect: (ctx) => !!ctx.canvas2d || ctx.workflows?.includes('2d'),
    apply: (ui, ctx) => {
      const folder = ui.addFolder('Canvas');
      const canvas = ctx.canvas2d?.canvas || ctx.canvas;
      // Width + Height pair side-by-side — they're semantic siblings
      // (the canvas's extent) and read as one unit. Same pattern as
      // Near/Far in Camera Settings.
      folder.addPairedNumbers([
        { label: 'Width',  value: canvas?.width  || 1024, unit: 'px', min: 64, max: 8192, step: 16 },
        { label: 'Height', value: canvas?.height || 1024, unit: 'px', min: 64, max: 8192, step: 16 },
      ]);
      folder.addColor('Background', { value: '#0a0a0a' });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Canvas'),
  },
  {
    id: '2d.brush',
    name: 'Brush Tool',
    category: '2D',
    workflows: ['2d'],
    description: 'Size, hardness, opacity, flow for paint-style 2D tools.',
    properties: [
      { id: 'size',     type: 'number', min: 1, max: 256 },
      { id: 'hardness', type: 'number', min: 0, max: 1 },
      { id: 'opacity',  type: 'number', min: 0, max: 1 },
      { id: 'flow',     type: 'number', min: 0, max: 1 },
      { id: 'color',    type: 'color' },
    ],
    detect: (ctx) => !!ctx.canvas2d || ctx.workflows?.includes('2d'),
    apply: (ui) => {
      const folder = ui.addFolder('Brush');
      folder.addDial('Size',     { min: 1, max: 256, value: 24, step: 1, suffix: 'px' });
      folder.addSlider('Hardness',{ min: 0, max: 1, value: 0.8, step: 0.01 });
      folder.addSlider('Opacity', { min: 0, max: 1, value: 1, step: 0.01 });
      folder.addSlider('Flow',    { min: 0, max: 1, value: 1, step: 0.01 });
      folder.addColor('Color',    { value: '#ffffff' });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Brush'),
  },
  {
    id: '2d.layers',
    name: 'Layers',
    category: '2D',
    workflows: ['2d'],
    description: 'Stack of paintable layers with opacity, blend mode, visibility.',
    properties: [
      { id: 'opacity',   type: 'number', min: 0, max: 1, per: 'layer' },
      { id: 'blendMode', type: 'enum', options: ['normal','multiply','screen','overlay','add'] },
      { id: 'visible',   type: 'boolean', per: 'layer' },
    ],
    detect: (ctx) => ctx.layers || ctx.workflows?.includes('2d'),
    apply: (ui) => {
      const folder = ui.addFolder('Layers');
      folder.addInfo('Add tracked layers via ui.skills.update("2d.layers", { context: [...] })');
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Layers'),
  },
  {
    id: '2d.palette',
    name: 'Color Palette',
    category: '2D',
    workflows: ['2d'],
    description: 'Named colors used across the project.',
    properties: [{ id: 'colors', type: 'color[]' }],
    detect: (ctx) => ctx.workflows?.includes('2d'),
    apply: (ui) => {
      const folder = ui.addFolder('Palette');
      ['Primary', 'Secondary', 'Accent', 'Highlight'].forEach((name, i) => {
        const defaults = ['#ff5577', '#5577ff', '#ffaa44', '#44ffaa'];
        folder.addColor(name, { value: defaults[i] });
      });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Palette'),
  },

  // ────────────────────────── SHADER WORKFLOW ─────────────────────
  {
    id: 'shader.uniforms',
    name: 'Uniform Inspector',
    category: 'Shader',
    workflows: ['shader'],
    description: 'Live-editable controls for all shader uniforms (float, vec3, color, bool, int).',
    properties: [],
    detect: (ctx) => {
      let has = false;
      ctx.scene?.traverse?.(n => {
        const ms = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
        ms.forEach(m => { if (m.type === 'ShaderMaterial' || m.type === 'RawShaderMaterial') has = true; });
      });
      return has;
    },
    apply: () => ({}),  // wired by shader workflow setup
  },
  {
    id: 'shader.debug-passes',
    name: 'Debug Visualizers',
    category: 'Shader',
    workflows: ['shader'],
    description: 'Show UV / Normals / Depth / Wireframe overlays.',
    properties: [
      { id: 'showUV',       type: 'boolean' },
      { id: 'showNormals',  type: 'boolean' },
      { id: 'showDepth',    type: 'boolean' },
      { id: 'wireframe',    type: 'boolean' },
    ],
    detect: (ctx) => ctx.scene && ctx.renderer,
    apply: () => ({}),  // wired by shader workflow setup
  },

  // ────────────────────────── ANIMATION WORKFLOW ──────────────────
  {
    id: 'animation.graph-editor',
    name: 'F-Curve Graph Editor',
    category: 'Animation',
    workflows: ['animation'],
    description: 'Blender-style F-curve editor: keyframes, tracks, dope sheet, transport, prompt edits.',
    properties: [
      { id: 'tracks',   type: 'track[]' },
      { id: 'duration', type: 'number' },
      { id: 'time',     type: 'number' },
      { id: 'loop',     type: 'boolean' },
    ],
    detect: (ctx) => {
      if (Array.isArray(ctx.tracks)) return true;
      if (ctx.duration) return true;
      let has = false;
      ctx.scene?.traverse?.(n => { if (n.userData?.mixer || n.userData?.animations?.length) has = true; });
      return has;
    },
    apply: () => ({}),  // wired by animation workflow setup
  },
  {
    id: 'animation.keyframe-recorder',
    name: 'Keyframe Recorder',
    category: 'Animation',
    workflows: ['animation'],
    description: 'Click record, then drag any property — keyframes are written to the active track at the current playhead.',
    properties: [{ id: 'recording', type: 'boolean' }],
    detect: () => false,    // opt-in
    apply: (ui) => {
      const folder = ui.addFolder('Record');
      folder.addCheckbox('Recording', { value: false, tooltip: 'Capture changes to bound properties as keyframes' });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Record'),
  },

  // ────────────────────────── AUDIO WORKFLOW ──────────────────────
  {
    id: 'audio.master',
    name: 'Master Bus',
    category: 'Audio',
    workflows: ['audio'],
    description: 'Volume, pan, stereo + depth position.',
    properties: [
      { id: 'volume', type: 'number', min: 0, max: 1 },
      { id: 'pan',    type: 'number', min: -1, max: 1 },
    ],
    detect: (ctx) => !!ctx.audioContext || ctx.workflows?.includes('audio'),
    apply: (ui) => {
      const folder = ui.addFolder('Master');
      folder.addDial('Volume', { min: 0, max: 1, value: 0.7, step: 0.01 });
      folder.addDial('Pan',    { min: -1, max: 1, value: 0, step: 0.01 });
      folder.addXYPad('Position', { value: { x: 0.5, y: 0.5 } });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Master'),
  },
  {
    id: 'audio.eq',
    name: '3-Band EQ',
    category: 'Audio',
    workflows: ['audio'],
    description: 'Low / Mid / High gain in dB.',
    properties: [
      { id: 'low',  type: 'number', min: -24, max: 24, unit: 'dB' },
      { id: 'mid',  type: 'number', min: -24, max: 24, unit: 'dB' },
      { id: 'high', type: 'number', min: -24, max: 24, unit: 'dB' },
    ],
    detect: (ctx) => !!ctx.audioContext || ctx.workflows?.includes('audio'),
    apply: (ui) => {
      const folder = ui.addFolder('EQ');
      ['Low', 'Mid', 'High'].forEach(band => {
        folder.addDial(band, { min: -24, max: 24, value: 0, step: 0.1, suffix: 'dB' });
      });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('EQ'),
  },

  // ────────────────────────── ASCII WORKFLOW ──────────────────────
  {
    id: 'ascii.charset',
    name: 'Character Set',
    category: 'ASCII',
    workflows: ['ascii'],
    description: 'Preset or custom character ramp ordered dark-to-bright.',
    properties: [
      { id: 'preset', type: 'enum', options: ['Standard','Dense','Sparse','Block','Braille','Custom'] },
      { id: 'custom', type: 'string' },
    ],
    detect: (ctx) => ctx.workflows?.includes('ascii'),
    apply: (ui) => {
      const folder = ui.addFolder('Charset');
      folder.addSelect('Preset', { options: ['Standard','Dense','Sparse','Block','Braille','Custom'], value: 'Standard' });
      folder.addText('Custom',   { value: ' .:-=+*#%@' });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Charset'),
  },
  {
    id: 'ascii.grid',
    name: 'Character Grid',
    category: 'ASCII',
    workflows: ['ascii'],
    description: 'Column / row count, font size, line height.',
    properties: [
      { id: 'cols', type: 'number', min: 20, max: 400 },
      { id: 'rows', type: 'number', min: 10, max: 200 },
      { id: 'fontSize',   type: 'number', min: 4, max: 32, unit: 'px' },
      { id: 'lineHeight', type: 'number', min: 0.5, max: 2 },
    ],
    detect: (ctx) => ctx.workflows?.includes('ascii'),
    apply: (ui) => {
      const folder = ui.addFolder('Grid');
      // Cols + Rows pair — semantic siblings (grid extent), same as
      // canvas Width/Height.
      folder.addPairedNumbers([
        { label: 'Columns', value: 120, min: 20, max: 400, step: 1 },
        { label: 'Rows',    value: 60,  min: 10, max: 200, step: 1 },
      ]);
      folder.addSlider('Font Size',  { min: 4, max: 32, value: 10, step: 0.5, suffix: 'px' });
      folder.addSlider('Line Height',{ min: 0.5, max: 2, value: 1, step: 0.05 });
      return { folder };
    },
    teardown: (ui) => ui.panel.removeFolder('Grid'),
  },
];

// Singleton registry — created at module load, used across createGhostPanel calls.
export const globalRegistry = new SkillsRegistry();
BUILTIN_SKILLS.forEach(s => globalRegistry.register(s));

/**
 * Public AI-agent interface — exposed on `ui.skills`:
 *
 *   ui.skills.describe()                  → JSON of all skills + state
 *   ui.skills.suggest(ctx)                → ranked suggestions
 *   ui.skills.register(skillDef)          → add a new skill
 *   ui.skills.update(id, partialDef)      → mutate a skill
 *   ui.skills.apply(id, ctx?)             → mount
 *   ui.skills.remove(id)                  → unmount
 *   ui.skills.list({ workflow, applied }) → filter the catalog
 *
 * This is the surface AI agents target. The description includes property
 * schemas so an LLM can generate code that reads/writes them.
 */
export function attachSkillsAPI(ui, ctx) {
  const reg = globalRegistry;
  ui.skills = {
    registry: reg,
    describe: (opts) => reg.describe(opts),
    suggest:  (extra) => reg.suggest({ ...ctx, ...(extra || {}) }),
    register: (s) => reg.register(s),
    update:   (id, p) => reg.update(id, p),
    apply:    (id) => reg.apply(ui, id, ctx),
    remove:   (id) => reg.remove(id),
    list:     (q) => reg.list(q),
    autoApply: (extra) => reg.autoApply(ui, { ...ctx, ...(extra || {}) }),
    enablePersistence: (k) => reg.enablePersistence(k),
    /** Hook for AI agents to be notified when the catalog changes. */
    onChange: (cb) => reg.on('change', cb),
  };
  return ui.skills;
}
