/**
 * Ghost Panel · Natural-Language Panel Augmentation
 *
 * Lets users describe in plain English what they want to control, then
 * adds the right panels, properties, and tools automatically.
 *
 * Access:
 *   ⌘/      → open prompt bar from anywhere
 *   Click the ✦ button in the panel header
 *   ui._augment.prompt("add fog controls")  → programmatic
 *
 * How it works:
 *   1. Scans the currently-selected object (or whole scene) for controllable
 *      properties — numbers, booleans, colors, Vector3s, strings.
 *   2. Parses the user's prompt against a set of intent patterns + the
 *      live property scan to find the best match.
 *   3. Adds the appropriate folder + controls to the panel live.
 *   4. Shows a toast with a "Copy code →" action so the addition can be
 *      pasted into the project permanently.
 *   5. Optionally routes to /__ghost-panel/augment (Vite dev server endpoint)
 *      for AI-backed interpretation of requests it can't match locally.
 */

// ── Property scanner ────────────────────────────────────────────────────────

import { PromptAnalytics } from './prompt-analytics.js';

/**
 * Walk an object's own + prototype properties and return candidates for
 * controls.  Returns an array of { path, label, type, value, meta }.
 *
 * type ∈ 'number' | 'boolean' | 'color' | 'vec3' | 'string' | 'unknown'
 */
export function scanProperties(obj, { depth = 2, prefix = '', exclude = new Set() } = {}) {
  if (!obj || depth === 0) return [];
  const results = [];
  const seen = new Set();

  const SKIP_KEYS = new Set([
    'uuid','id','type','name','parent','children','matrixWorld','matrix',
    'matrixWorldInverse','projectionMatrix','projectionMatrixInverse',
    '_listeners','userData','__proto__','constructor',
  ]);

  function walk(target, path, d) {
    if (!target || typeof target !== 'object' || d === 0) return;
    if (seen.has(target)) return;
    seen.add(target);

    // THREE.Color
    if (isThreeColor(target)) {
      results.push({ path, label: labelOf(path), type: 'color', value: '#' + target.getHexString() });
      return;
    }
    // THREE.Vector3 / Vector2
    if (isThreeVec(target)) {
      results.push({ path, label: labelOf(path), type: 'vec3', value: { x: target.x, y: target.y, z: target.z ?? null } });
      return;
    }
    // THREE.Euler
    if (isThreeEuler(target)) {
      results.push({ path, label: labelOf(path), type: 'euler', value: { x: target.x, y: target.y, z: target.z } });
      return;
    }

    const keys = getAllKeys(target);
    for (const key of keys) {
      if (SKIP_KEYS.has(key) || key.startsWith('_') || exclude.has(key)) continue;
      const fullPath = path ? `${path}.${key}` : key;
      let val;
      try { val = target[key]; } catch { continue; }

      if (typeof val === 'number' && isFinite(val)) {
        results.push({ path: fullPath, label: labelOf(key), type: 'number', value: val, meta: inferNumberMeta(key, val) });
      } else if (typeof val === 'boolean') {
        results.push({ path: fullPath, label: labelOf(key), type: 'boolean', value: val });
      } else if (typeof val === 'string' && val.length < 120) {
        // A string that's actually a CSS color (e.g. '#ff5577', 'rgb(...)')
        // should surface as a color picker, not a text field — and the
        // picker's onChange will write the value straight back.
        const asColor = cssColorIfString(val);
        results.push(asColor
          ? { path: fullPath, label: labelOf(key), type: 'color', value: asColor }
          : { path: fullPath, label: labelOf(key), type: 'string', value: val });
      } else if (val && typeof val === 'object') {
        if (isThreeColor(val)) {
          results.push({ path: fullPath, label: labelOf(key), type: 'color', value: '#' + val.getHexString() });
        } else if (isThreeVec(val)) {
          results.push({ path: fullPath, label: labelOf(key), type: 'vec3', value: { x: val.x, y: val.y, z: val.z ?? null } });
        } else if (isThreeEuler(val)) {
          results.push({ path: fullPath, label: labelOf(key), type: 'euler', value: { x: val.x, y: val.y, z: val.z } });
        } else if (d > 1 && !Array.isArray(val) && !(val instanceof HTMLElement)) {
          walk(val, fullPath, d - 1);
        }
      }
    }
  }

  walk(obj, prefix, depth);
  return results.slice(0, 60); // cap to keep the list sane
}

function isThreeColor(o) { return o && (o.isColor || (typeof o.r === 'number' && typeof o.g === 'number' && typeof o.b === 'number' && 'getHexString' in o)); }
function isThreeVec(o)   { return o && (o.isVector3 || o.isVector2 || (typeof o.x === 'number' && typeof o.y === 'number' && 'set' in o)); }
function isThreeEuler(o) { return o && (o.isEuler || (typeof o.x === 'number' && typeof o.order === 'string')); }

function getAllKeys(obj) {
  const keys = new Set();
  let cur = obj;
  let depth = 0;
  while (cur && cur !== Object.prototype && depth < 4) {
    Object.getOwnPropertyNames(cur).forEach(k => keys.add(k));
    cur = Object.getPrototypeOf(cur);
    depth++;
  }
  return [...keys].filter(k => typeof k === 'string');
}

function labelOf(path) {
  const key = path.split('.').pop();
  return key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim()
    .replace(/^\w/, c => c.toUpperCase());
}

// Pretty display name for an object/folder — keeps the full name (incl. dots,
// e.g. "circle.01") rather than collapsing to the last segment like labelOf.
function objDisplayName(obj) {
  const n = obj?.name;
  if (!n || typeof n !== 'string') return 'Object';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function inferNumberMeta(key, value) {
  const k = key.toLowerCase();
  if (/opacity|alpha|factor|weight|blend|mix|ratio/.test(k)) return { min: 0, max: 1, step: 0.01 };
  if (/roughness|metalness|shininess|reflectivity/.test(k)) return { min: 0, max: 1, step: 0.01 };
  if (/intensity|strength|power|energy/.test(k)) return { min: 0, max: 10, step: 0.1 };
  if (/speed|velocity|rate/.test(k)) return { min: 0, max: 100, step: 0.1 };
  if (/angle|rotation|roll|pitch|yaw/.test(k)) return { min: -Math.PI, max: Math.PI, step: 0.01 };
  if (/scale|size|radius|width|height|depth/.test(k)) return { min: 0, max: 10, step: 0.01 };
  if (/near|far|fov|zoom/.test(k)) return { min: 0.01, max: value < 10 ? 10 : 10000, step: value < 10 ? 0.01 : 1 };
  if (/count|segments|samples|steps/.test(k)) return { min: 0, max: 256, step: 1 };
  if (/time|duration|delay/.test(k)) return { min: 0, max: 60, step: 0.1 };
  // fallback based on current value range
  const abs = Math.abs(value);
  if (abs <= 1) return { min: -1, max: 1, step: 0.01 };
  if (abs <= 10) return { min: -abs * 2, max: abs * 2, step: abs * 0.01 };
  return { min: 0, max: abs * 4, step: abs * 0.01 };
}

// ── Intent matching ──────────────────────────────────────────────────────────

const INTENTS = [
  // Controls
  { id: 'slider',    re: /\bslider|range|drag|scrub\b/i,            hint: 'slider' },
  { id: 'color',     re: /\bcolor|colour|hue|tint|shade|fill\b/i,   hint: 'color picker' },
  { id: 'toggle',    re: /\btoggle|checkbox|on.?off|enable|visible\b/i, hint: 'checkbox' },
  { id: 'button',    re: /\bbutton|trigger|action|click\b/i,        hint: 'button' },
  { id: 'select',    re: /\bselect|dropdown|menu|choice|options\b/i,hint: 'dropdown' },
  { id: 'text',      re: /\btext|string|label|name\b/i,             hint: 'text input' },
  { id: 'vec3',      re: /\bvector|position|xyz|3d\s*coord/i,       hint: 'XYZ' },

  // Object properties — shorthand
  { id: 'material',  re: /\bmaterial|mat\b/i,     hint: 'material controls' },
  { id: 'position',  re: /\bposition|location|move|translate\b/i, hint: 'position XYZ' },
  { id: 'rotation',  re: /\brotation|rotate|angle|orient\b/i,     hint: 'rotation XYZ' },
  { id: 'scale',     re: /\bscale|size|resize\b/i,                hint: 'scale' },
  { id: 'opacity',   re: /\bopacity|transparent|alpha\b/i,        hint: 'opacity slider' },

  // Scene-level
  { id: 'fog',       re: /\bfog\b/i,              hint: 'fog controls' },
  { id: 'light',     re: /\blight|ambient|sun|directional|point.?light\b/i, hint: 'light controls' },
  { id: 'shadow',    re: /\bshadow\b/i,           hint: 'shadow controls' },
  { id: 'background',re: /\bbackground|bg\s*color|skybox\b/i,    hint: 'background' },
  { id: 'camera',    re: /\bcamera|fov|near|far|zoom\b/i,        hint: 'camera controls' },
  { id: 'physics',   re: /\bphysics|gravity|mass|friction\b/i,   hint: 'physics' },

  // Meta
  { id: 'scan',      re: /\bsuggest|what|scan|show.?me|inspect|all|everything|list\b/i, hint: 'scan & suggest' },
];

export function parseIntent(prompt) {
  const matches = INTENTS.filter(i => i.re.test(prompt));
  // Extract quoted property name: 'speed', "roughness", `intensity`
  const propMatch = prompt.match(/['"`](\w[\w.]*?)['"`]/);
  const propName   = propMatch?.[1] ?? null;
  // Extract raw keywords after 'for' / 'on' / 'of', skipping articles (the/a/an/my)
  const forMatch   = prompt.match(/\b(?:for|on|of|to)\s+(?:(?:the|a|an|my|this)\s+)?([\w.]+)/i);
  const targetProp = forMatch?.[1] ?? propName;

  return { intents: matches, targetProp, raw: prompt };
}

// ── Control builder ──────────────────────────────────────────────────────────

/**
 * Given a parsed intent + optional source object, generate a recipe for what
 * to add to the panel.
 *
 * Returns: [{ folderName, controls: [{ method, label, opts, codeHint }] }]
 */
export function buildRecipe(intent, obj, scannedProps = [], ctx = {}) {
  const { intents, targetProp } = intent;
  const ids = new Set(intents.map(i => i.id));
  const recipes = [];
  // ctx may carry scene-level refs: { scene, camera, renderer }
  // NB: parenthesize the ternary — `??` binds tighter than `?:`, so without
  // these parens `ctx.scene ?? obj?.isScene ? obj : null` resolves to `obj`
  // (the selected mesh) whenever ctx.scene is set.
  const scene    = ctx.scene    ?? (obj?.isScene  ? obj : null);
  const camera   = ctx.camera   ?? (obj?.isCamera ? obj : null);
  const renderer = ctx.renderer ?? null;

  // ── scan-and-suggest: return ALL scannable props as controls ──
  if (ids.has('scan') || (intents.length === 0 && !targetProp)) {
    const props = scannedProps.length > 0 ? scannedProps : (obj ? scanProperties(obj) : []);
    if (props.length === 0) return [];
    const folder = { folderName: obj?.name || 'Inspected Properties', controls: [] };
    for (const p of props.slice(0, 20)) {
      folder.controls.push(propToControl(p, obj));
    }
    recipes.push(folder);
    return recipes;
  }

  // ── known scene-level presets ──
  if (ids.has('fog')) {
    const fogSrc = scene ?? obj;   // use scene if available, else whatever was passed
    const fog    = fogSrc?.fog;
    recipes.push({
      folderName: 'Fog',
      controls: [
        { method: 'addColor',  label: 'Fog Color', opts: { value: fog ? '#' + fog.color.getHexString() : '#c9c9c9', onChange: v => { if (fogSrc?.fog) fogSrc.fog.color.set(v); } } },
        { method: 'addSlider', label: 'Near',       opts: { min: 0, max: 100,  value: fog?.near ?? 10,  step: 1, onChange: v => { if (fogSrc?.fog) fogSrc.fog.near = v; } } },
        { method: 'addSlider', label: 'Far',        opts: { min: 0, max: 2000, value: fog?.far  ?? 100, step: 1, onChange: v => { if (fogSrc?.fog) fogSrc.fog.far  = v; } } },
      ],
      codeHint: `const fog = ui.addFolder('Fog');\nfog.addColor('Fog Color', { value: '#c9c9c9', onChange: v => scene.fog.color.set(v) });\nfog.addSlider('Near', { min: 0, max: 100, value: scene.fog.near, onChange: v => scene.fog.near = v });\nfog.addSlider('Far',  { min: 0, max: 2000, value: scene.fog.far,  onChange: v => scene.fog.far  = v });`,
    });
  }

  if (ids.has('background')) {
    const bgIsColor = scene?.background?.isColor;
    recipes.push({
      folderName: 'Background',
      controls: [
        { method: 'addColor',  label: 'Background',  opts: { value: bgIsColor ? '#' + scene.background.getHexString() : '#000000', onChange: v => { if (scene?.background?.isColor) scene.background.set(v); } } },
        { method: 'addSlider',   label: 'Exposure',   opts: { min: 0, max: 4, value: renderer?.toneMappingExposure ?? 1, step: 0.01, onChange: v => { if (renderer) renderer.toneMappingExposure = v; } } },
      ],
      codeHint: `const bg = ui.addFolder('Background');\nbg.addColor('Background', { value: '#000000', onChange: v => { scene.background = new THREE.Color(v); } });\nbg.addSlider('Exposure', { min: 0, max: 4, value: 1, onChange: v => renderer.toneMappingExposure = v });`,
    });
  }

  if (ids.has('position') && obj) {
    const pos = obj.position ?? { x: 0, y: 0, z: 0 };
    recipes.push({
      folderName: `${obj.name || 'Object'} · Position`,
      controls: [
        { method: 'addSlider', label: 'X', opts: { min: -50, max: 50, value: pos.x, step: 0.01, onChange: v => obj.position && (obj.position.x = v) } },
        { method: 'addSlider', label: 'Y', opts: { min: -50, max: 50, value: pos.y, step: 0.01, onChange: v => obj.position && (obj.position.y = v) } },
        { method: 'addSlider', label: 'Z', opts: { min: -50, max: 50, value: pos.z, step: 0.01, onChange: v => obj.position && (obj.position.z = v) } },
      ],
      codeHint: `const pos = ui.addFolder('${obj.name || 'Object'} · Position');\npos.addSlider('X', { min: -50, max: 50, value: obj.position.x, onChange: v => obj.position.x = v });\npos.addSlider('Y', { min: -50, max: 50, value: obj.position.y, onChange: v => obj.position.y = v });\npos.addSlider('Z', { min: -50, max: 50, value: obj.position.z, onChange: v => obj.position.z = v });`,
    });
  }

  if (ids.has('rotation') && obj) {
    const rot = obj.rotation ?? { x: 0, y: 0, z: 0 };
    const R2D = 180 / Math.PI;
    recipes.push({
      folderName: `${obj.name || 'Object'} · Rotation`,
      controls: [
        { method: 'addSlider', label: 'X°', opts: { min: -180, max: 180, value: (rot.x ?? 0) * R2D, step: 0.5, onChange: v => obj.rotation && (obj.rotation.x = v / R2D) } },
        { method: 'addSlider', label: 'Y°', opts: { min: -180, max: 180, value: (rot.y ?? 0) * R2D, step: 0.5, onChange: v => obj.rotation && (obj.rotation.y = v / R2D) } },
        { method: 'addSlider', label: 'Z°', opts: { min: -180, max: 180, value: (rot.z ?? 0) * R2D, step: 0.5, onChange: v => obj.rotation && (obj.rotation.z = v / R2D) } },
      ],
      codeHint: `const rot = ui.addFolder('${obj.name || 'Object'} · Rotation');\nrot.addSlider('Y°', { min:-180, max:180, value: obj.rotation.y*(180/Math.PI), onChange: v => obj.rotation.y = v*(Math.PI/180) });`,
    });
  }

  if (ids.has('scale') && obj) {
    const s = obj.scale ?? { x: 1, y: 1, z: 1 };
    recipes.push({
      folderName: `${obj.name || 'Object'} · Scale`,
      controls: [
        { method: 'addSlider', label: 'Uniform', opts: { min: 0.01, max: 5, value: s.x, step: 0.01, onChange: v => obj.scale?.set(v, v, v) } },
        { method: 'addSlider', label: 'X',       opts: { min: 0.01, max: 5, value: s.x, step: 0.01, onChange: v => obj.scale && (obj.scale.x = v) } },
        { method: 'addSlider', label: 'Y',       opts: { min: 0.01, max: 5, value: s.y, step: 0.01, onChange: v => obj.scale && (obj.scale.y = v) } },
        { method: 'addSlider', label: 'Z',       opts: { min: 0.01, max: 5, value: s.z, step: 0.01, onChange: v => obj.scale && (obj.scale.z = v) } },
      ],
      codeHint: `const sc = ui.addFolder('Scale');\nsc.addSlider('Uniform', { min: 0.01, max: 5, value: 1, onChange: v => obj.scale.set(v, v, v) });`,
    });
  }

  if (ids.has('opacity') && obj?.material) {
    recipes.push({
      folderName: `${obj.name || 'Object'} · Opacity`,
      controls: [
        { method: 'addSlider', label: 'Opacity', opts: { min: 0, max: 1, value: obj.material.opacity ?? 1, step: 0.01, onChange: v => { if (obj.material) { obj.material.opacity = v; obj.material.transparent = v < 1; } } } },
      ],
      codeHint: `const f = ui.addFolder('Opacity');\nf.addSlider('Opacity', { min: 0, max: 1, value: mesh.material.opacity, onChange: v => { mesh.material.opacity = v; mesh.material.transparent = v < 1; } });`,
    });
  }

  if (ids.has('material') && obj?.material) {
    const mat = obj.material;
    const folder = { folderName: `${obj.name || 'Object'} · Material`, controls: [], codeHint: '' };
    if (mat.color)     folder.controls.push({ method: 'addColor',  label: 'Color',     opts: { value: '#' + mat.color.getHexString(), onChange: v => mat.color.set(v) } });
    if ('roughness' in mat) folder.controls.push({ method: 'addSlider', label: 'Roughness', opts: { min: 0, max: 1, value: mat.roughness, step: 0.01, onChange: v => (mat.roughness = v) } });
    if ('metalness' in mat) folder.controls.push({ method: 'addSlider', label: 'Metalness', opts: { min: 0, max: 1, value: mat.metalness, step: 0.01, onChange: v => (mat.metalness = v) } });
    if ('opacity' in mat)   folder.controls.push({ method: 'addSlider', label: 'Opacity',   opts: { min: 0, max: 1, value: mat.opacity,   step: 0.01, onChange: v => { mat.opacity = v; mat.transparent = v < 1; } } });
    if ('wireframe' in mat) folder.controls.push({ method: 'addCheckbox', label: 'Wireframe', opts: { value: mat.wireframe, onChange: v => (mat.wireframe = v) } });
    folder.codeHint = `const mat = ui.addFolder('Material');\nmat.addColor('Color', { value: '#ffffff', onChange: v => mesh.material.color.set(v) });\nmat.addSlider('Roughness', { min: 0, max: 1, value: mesh.material.roughness, onChange: v => mesh.material.roughness = v });`;
    recipes.push(folder);
  }

  if (ids.has('camera')) {
    const cam = camera ?? (obj?.isCamera ? obj : null);
    // Even without a camera ref, still show useful FOV/near/far controls
    recipes.push({
      folderName: 'Camera',
      controls: [
        { method: 'addSlider', label: 'FOV',  opts: { min: 10, max: 120, value: cam?.fov  ?? 60,   step: 1,    onChange: v => { if (cam?.isPerspectiveCamera) { cam.fov = v; cam.updateProjectionMatrix(); } } } },
        { method: 'addSlider', label: 'Near', opts: { min: 0.01, max: 10, value: cam?.near ?? 0.1, step: 0.01, onChange: v => { if (cam) { cam.near = v; cam.updateProjectionMatrix(); } } } },
        { method: 'addSlider', label: 'Far',  opts: { min: 10, max: 10000, value: cam?.far ?? 1000, step: 1,   onChange: v => { if (cam) { cam.far  = v; cam.updateProjectionMatrix(); } } } },
        { method: 'addSlider', label: 'Zoom', opts: { min: 0.1, max: 10,   value: cam?.zoom ?? 1,  step: 0.01, onChange: v => { if (cam) { cam.zoom = v; cam.updateProjectionMatrix(); } } } },
      ],
      codeHint: `const cam = ui.addFolder('Camera');\ncam.addSlider('FOV', { min: 10, max: 120, value: camera.fov, onChange: v => { camera.fov = v; camera.updateProjectionMatrix(); } });`,
    });
  }

  // ── Color: bind a *working* picker to the object's color ──
  // Handles "color picker for the pill", "fill color", "change the colour",
  // etc. We resolve a concrete property path on the selected object so the
  // onChange actually repaints — no inert placeholders.
  if (ids.has('color') && obj && recipes.length === 0) {
    let sink  = null;
    let label = null;
    // 1. Explicit property the user named, if it resolves to a color/string.
    if (targetProp) {
      const resolved = getByPath(obj, targetProp);
      if (isThreeColor(resolved)) {
        sink = { path: targetProp, value: '#' + resolved.getHexString() };
        label = labelOf(targetProp.split('.').pop());
      } else if (typeof resolved === 'string') {
        sink = { path: targetProp, value: cssColorIfString(resolved) ?? cssColorToHex(resolved) };
        label = labelOf(targetProp.split('.').pop());
      }
    }
    // 2. Otherwise (no target, or the target was the object's own name like
    //    "pill") fall back to the object's primary color sink.
    if (!sink) sink = primaryColorSink(obj);

    if (sink) {
      const niceName = objDisplayName(obj);
      recipes.push({
        folderName: niceName,
        controls: [{
          method: 'addColor',
          label: label || `${niceName} Color`,
          opts: { value: sink.value, onChange: v => setByPath(obj, sink.path, v) },
        }],
        codeHint: `ui.addFolder('${niceName}').addColor('${label || 'Color'}', { value: '${sink.value}', onChange: v => obj.${sink.path} = v });`,
      });
    }
  }

  // ── Target a specific named property ──
  if (targetProp && obj && recipes.length === 0) {
    const parts = targetProp.split('.');
    let target = obj;
    for (const p of parts.slice(0, -1)) { target = target?.[p]; }
    const key = parts[parts.length - 1];
    const val = target?.[key];

    if (val !== undefined) {
      const prop = { path: targetProp, label: labelOf(key), type: typeof val === 'boolean' ? 'boolean' : typeof val === 'string' ? 'string' : isThreeColor(val) ? 'color' : isThreeVec(val) ? 'vec3' : 'number', value: isThreeColor(val) ? '#' + val.getHexString() : val };
      recipes.push({
        folderName: 'Controls',
        controls: [propToControl(prop, target)],
        codeHint: `const f = ui.addFolder('Controls');\n// ${targetProp} = ${JSON.stringify(val)}`,
      });
    }
  }

  // ── Generic: anything matching a control type keyword ──
  if (recipes.length === 0 && ids.size > 0) {
    const ctrl = ids.has('color') ? 'addColor'
               : ids.has('toggle') ? 'addCheckbox'
               : ids.has('button') ? 'addButton'
               : ids.has('select') ? 'addSelect'
               : ids.has('text')   ? 'addText'
               : 'addSlider';

    // Use the extracted target name as both folder name and label when available
    // e.g. "color picker for pill" → folder "Pill", label "Pill Color"
    const humanTarget = targetProp ? labelOf(targetProp) : null;
    const folderName  = obj?.name ? objDisplayName(obj) : (humanTarget ?? 'Controls');
    const ctrlLabel   = humanTarget
      ? (ctrl === 'addColor' ? `${humanTarget} Color` : humanTarget)
      : 'New Control';

    // Resolve a real backing property so the control actually *does*
    // something. Priority: explicit target path → object color sink (for
    // color) → object visibility (for toggles).
    let bindPath = null;
    let resolvedValue;
    if (obj && targetProp) {
      const t = getByPath(obj, targetProp);
      if (t !== undefined && t !== null) { resolvedValue = t; bindPath = targetProp; }
    }
    if (bindPath == null && ctrl === 'addColor' && obj) {
      const sink = primaryColorSink(obj);
      if (sink) { resolvedValue = sink.value; bindPath = sink.path; }
    }
    if (bindPath == null && ctrl === 'addCheckbox' && typeof obj?.visible === 'boolean') {
      resolvedValue = obj.visible; bindPath = 'visible';
    }

    const onChange = bindPath ? (v => setByPath(obj, bindPath, v)) : undefined;
    const colorSeed = isThreeColor(resolvedValue) ? '#' + resolvedValue.getHexString()
                    : (typeof resolvedValue === 'string' ? (cssColorIfString(resolvedValue) ?? '#ffffff') : '#ffffff');
    const opts = ctrl === 'addSlider'   ? { min: 0, max: 1, value: typeof resolvedValue === 'number' ? resolvedValue : 0.5, step: 0.01, onChange }
               : ctrl === 'addColor'    ? { value: colorSeed, onChange }
               : ctrl === 'addCheckbox' ? { value: typeof resolvedValue === 'boolean' ? resolvedValue : false, onChange }
               : ctrl === 'addText'     ? { value: typeof resolvedValue === 'string' ? resolvedValue : '', onChange }
               : ctrl === 'addButton'   ? {}
               : { onChange };

    recipes.push({
      folderName,
      _fallback: bindPath == null, // only truly a placeholder if nothing was bound
      controls: [{ method: ctrl, label: ctrlLabel, opts }],
      codeHint: `const f = ui.addFolder('${folderName}');\nf.${ctrl}('${ctrlLabel}', { /* opts */ });`,
    });
  }

  return recipes;
}

function propToControl(prop, obj) {
  switch (prop.type) {
    case 'color':   return { method: 'addColor',    label: prop.label, opts: { value: prop.value, onChange: v => setByPath(obj, prop.path, v) } };
    case 'boolean': return { method: 'addCheckbox', label: prop.label, opts: { value: prop.value, onChange: v => setByPath(obj, prop.path, v) } };
    case 'string':  return { method: 'addText',     label: prop.label, opts: { value: prop.value, onChange: v => setByPath(obj, prop.path, v) } };
    case 'vec3':    return { method: 'addVec3',     label: prop.label, opts: { value: prop.value } };
    default:        return { method: 'addSlider',   label: prop.label, opts: { ...(prop.meta ?? {}), value: prop.value, onChange: v => setByPath(obj, prop.path, v) } };
  }
}

function setByPath(obj, path, value) {
  if (!obj) return;
  const parts = path.split('.');
  let target = obj;
  for (let i = 0; i < parts.length - 1; i++) { target = target?.[parts[i]]; if (!target) return; }
  const key = parts[parts.length - 1];
  const cur = target[key];
  // Mutate Three.js math sinks (Color / Vector* / Euler) IN PLACE via .set()
  // so the material/object keeps the same instance the renderer already holds
  // a reference to — reassigning would orphan it.
  if (cur && typeof cur === 'object' && typeof cur.set === 'function' &&
      (cur.isColor || cur.isVector2 || cur.isVector3 || cur.isVector4 || cur.isEuler)) {
    cur.set(value);
  } else {
    target[key] = value;
  }
  // Apply the render-side effects the built-in material inspector applies, so a
  // custom control actually reaches the canvas instead of only updating the
  // panel. Writing a property alone is invisible when:
  //   • opacity < 1 does nothing unless `transparent` is enabled,
  //   • most material changes need a `needsUpdate` to recompile/upload,
  //   • a texture's pixels or transform changed (its own `needsUpdate`).
  if (target && target.isMaterial) {
    if (key === 'opacity') target.transparent = value < 1;
    target.needsUpdate = true;
  }
  // If we wrote (or replaced) a texture, flag it for re-upload.
  const after = target && target[key];
  if (after && after.isTexture) after.needsUpdate = true;
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  let t = obj;
  for (const p of path.split('.')) { if (t == null) return undefined; t = t[p]; }
  return t;
}

// ── Color helpers ────────────────────────────────────────────────────────────

/** Convert any CSS color string to a #rrggbb hex. Returns '#ffffff' on failure. */
function cssColorToHex(input) {
  if (typeof input !== 'string') return '#ffffff';
  const s = input.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('').toLowerCase();
  try {
    const cx = cssColorToHex._ctx || (cssColorToHex._ctx =
      (typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null));
    if (cx) {
      cx.fillStyle = '#000';
      cx.fillStyle = s;              // browser normalizes; invalid input is ignored
      const out = cx.fillStyle;      // '#rrggbb' or 'rgba(r, g, b, a)'
      if (/^#[0-9a-f]{6}$/i.test(out)) return out.toLowerCase();
      const m = out.match(/rgba?\(([^)]+)\)/i);
      if (m) {
        const [r, g, b] = m[1].split(',').map(n => parseInt(n, 10));
        return '#' + [r, g, b].map(n => (n || 0).toString(16).padStart(2, '0')).join('');
      }
    }
  } catch {}
  return '#ffffff';
}

/** Returns a hex string if `s` looks like a CSS color, else null. */
function cssColorIfString(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (/^#[0-9a-f]{3}$/i.test(t) || /^#[0-9a-f]{6}$/i.test(t)) return cssColorToHex(t);
  if (/^(rgb|hsl)a?\([^)]+\)$/i.test(t)) return cssColorToHex(t);
  return null;
}

function hslToHex(h, s, l) { return cssColorToHex(`hsl(${h} ${s}% ${l}%)`); }

/**
 * Find the property on `obj` that most naturally represents its color and
 * return { path, value } where value is a #hex seed for the picker. This is
 * what "color picker for the pill" / "fill color" bind to so the change
 * actually renders. Returns null if the object has no obvious color sink.
 */
function primaryColorSink(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.material && isThreeColor(obj.material.color))
    return { path: 'material.color', value: '#' + obj.material.color.getHexString() };
  if (isThreeColor(obj.color))
    return { path: 'color', value: '#' + obj.color.getHexString() };
  // Existing CSS-color string props, in render-precedence order.
  for (const key of ['fill', 'color', 'background', 'backgroundColor', 'tint']) {
    if (typeof obj[key] === 'string' && obj[key]) return { path: key, value: cssColorToHex(obj[key]) };
  }
  // Canvas-style object whose fill is derived from a numeric hue: bind a new
  // `fill` override (the draw loop honors `fill` over `hue`).
  if (typeof obj.hue === 'number') return { path: 'fill', value: hslToHex(obj.hue, 70, 55) };
  // Web adapter / element exposing a (possibly empty) fill accessor.
  if ('fill' in obj) return { path: 'fill', value: cssColorToHex(obj.fill) };
  return null;
}

// ── Flexible-add helpers (new-property synthesis + clarifying questions) ──────

// Words that describe HOW to control something, not WHAT — dropped before we
// try to read a property name out of a prompt. Shared by the ranker and the
// new-property name synthesiser so both treat "add a slider for wobble" and
// "wobble" identically.
const AUGMENT_STOP = new Set([
  'add','a','an','the','me','please','control','controls','slider','sliders',
  'picker','color','colour','toggle','checkbox','input','field','for','on',
  'of','to','my','this','that','make','set','show','give','want','need','with','and',
  'new','property','prop','value','some','create',
]);

function tokenizeWords(s) { return String(s).toLowerCase().match(/[a-z0-9]+/g) || []; }
function contentTokens(s) { return tokenizeWords(s).filter(t => !AUGMENT_STOP.has(t)); }
const capitalize = t => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Derive a {name, label} for a brand-new property from free text. "wobble
 * amount" → { name: 'wobbleAmount', label: 'Wobble Amount' }. Falls back to the
 * parsed targetProp when the prompt is all glue words. Returns null if nothing
 * usable remains.
 */
function propNameFromText(text, intent) {
  let toks = contentTokens(text);
  if (toks.length === 0 && intent?.targetProp) toks = tokenizeWords(intent.targetProp).filter(t => !AUGMENT_STOP.has(t));
  if (toks.length === 0) return null;
  toks = toks.slice(0, 4);
  const label = toks.map(capitalize).join(' ');
  const name  = toks[0] + toks.slice(1).map(capitalize).join('');
  return { name, label };
}

/**
 * Guess a control type from a property's name/label. `confident` is false when
 * the name gives no strong signal — that's the cue to ASK the user rather than
 * guess. Numbers are the catch-all, but we only commit to them when a sizing /
 * physics word is present.
 */
function inferTypeFromName(name, label = '') {
  const s = `${name} ${label}`.toLowerCase();
  const hasColorWord  = /(colou?r|tint|shade|hue|swatch)/.test(s);
  const hasFillStroke = /(fill|stroke|paint|ink)/.test(s);
  const hasSizeWord   = /(width|size|weight|thick|count|radius|length)/.test(s);
  if (hasColorWord || (hasFillStroke && !hasSizeWord)) return { type: 'color', confident: true };
  if (/(visible|hidden|enabled?|disabled?|toggle|active|wireframe|loop|mirror|cull|shadow|cast|receive)/.test(s)
      || /\b(is|has|use|show|allow)[A-Z_]/.test(name)) return { type: 'boolean', confident: true };
  if (/(name|label|text|title|caption|font|family|url|src|message|content|placeholder)/.test(s)) return { type: 'string', confident: true };
  if (/(width|height|size|scale|radius|length|count|amount|opacity|alpha|angle|rotation|rotate|speed|intensity|strength|weight|gap|margin|padding|offset|depth|blur|spread|zoom|factor|level|ratio|distance|duration|delay|frequency|phase|thickness|spacing|elevation|pressure|mass|gravity|friction|wobble|jitter|wave)/.test(s)) return { type: 'number', confident: true };
  if (/(^|\s)[xyz](\s|$)/.test(s)) return { type: 'number', confident: true };
  return { type: 'number', confident: false };
}

/** Map a free-text answer ("toggle", "num", "swatch") to a control type, or null. */
function normalizeType(raw) {
  const t = String(raw).toLowerCase().trim();
  if (/^(num|number|numeric|slider|range|float|int|integer|amount|value)s?$/.test(t)) return 'number';
  if (/^(colou?r|tint|swatch|hue|paint)s?$/.test(t)) return 'color';
  if (/^(bool|boolean|toggle|checkbox|switch|flag|on.?off)s?$/.test(t)) return 'boolean';
  if (/^(text|string|label|name|word)s?$/.test(t)) return 'string';
  return null;
}

/** Parse "0 100", "0-1", "-1 to 1" → {min,max,step}; null means "infer". */
function parseRange(raw) {
  const nums = String(raw).match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const min = parseFloat(nums[0]), max = parseFloat(nums[1]);
  if (!isFinite(min) || !isFinite(max) || max <= min) return null;
  const span = max - min;
  const step = span <= 2 ? 0.01 : span <= 20 ? 0.1 : 1;
  return { min, max, step };
}

// ── Apply a recipe to the panel ──────────────────────────────────────────────

export function applyRecipe(ui, recipes, { source = 'user' } = {}) {
  const added = [];
  for (const recipe of recipes) {
    const folder = ui.addFolder(recipe.folderName);
    for (const ctrl of recipe.controls) {
      // Skip if a control with this label is already in the folder
      // (panel.addFolder() deduplicates folders but not controls)
      const ctrlId = ctrl.opts?.id || ctrl.label;
      if (folder.controls?.[ctrlId]) continue;

      try {
        if (ctrl.method === 'addButton') {
          folder[ctrl.method](ctrl.label, ctrl.opts?.onClick ?? (() => {}));
        } else {
          folder[ctrl.method](ctrl.label, ctrl.opts ?? {});
        }
      } catch (e) {
        console.warn(`[Ghost Panel] Could not add control "${ctrl.label}":`, e);
      }
    }
    added.push({ folder, recipe });
  }
  return added;
}

// ── The augmentation engine ──────────────────────────────────────────────────

export class AugmentEngine {
  constructor(ui, opts = {}) {
    this.ui        = ui;
    this.opts      = opts;
    this._inputEl  = null;
    this._lastCode = '';
    this._history  = [];
    this._suggestionEls = [];

    // Prompt analytics — tracks what users ask for so frequently-requested
    // things can be prioritised and built into the core tool.
    this.analytics = new PromptAnalytics({
      telemetry: opts.telemetry !== false,
      endpoint:  opts.analyticsEndpoint,
    });
  }

  /** Open the prompt bar */
  open() {
    if (!this._inputEl) this._buildUI();
    const bar = this._inputEl.parentElement;
    bar.classList.add('dui-augment-bar--open');
    // Trigger button active state
    this._triggerBtn?.classList.add('dui-augment-trigger--active');
    // Focus robustly. The bar animates open via a CSS max-height transition;
    // an element inside an animating/`overflow:hidden` container can refuse
    // focus on the first frame, so we try on the next rAF AND again on a short
    // timeout. Whichever lands first wins; the second is a harmless no-op.
    const focus = () => {
      if (!this._inputEl) return;
      this._inputEl.focus();
      this._inputEl.select();
    };
    requestAnimationFrame(focus);
    setTimeout(focus, 60);
  }

  /** Close the prompt bar */
  close() {
    if (!this._inputEl) return;
    const bar = this._inputEl.parentElement;
    bar.classList.remove('dui-augment-bar--open');
    this._triggerBtn?.classList.remove('dui-augment-trigger--active');
    this._resetAsk();
  }

  /**
   * Open the bar in "question mode": the input becomes the prompt and the chips
   * become tappable answers. `pending` = { question, options:[{label,onPick}],
   * onText?(text) }. Typed answers route to onText; clicking a chip runs onPick.
   */
  _ask(pending) {
    if (!this._inputEl) this._buildUI();
    this._asking  = true;
    this._pending = pending;
    this.open();
    this._inputEl.value = '';
    this._inputEl.placeholder = pending.question;
    this._renderOptionChips(pending.options || []);
  }

  /** Leave question mode and restore the bar's default placeholder + chips. */
  _resetAsk() {
    const was = this._asking;
    this._asking  = false;
    this._pending = null;
    if (this._inputEl && this._defaultPlaceholder != null) {
      this._inputEl.placeholder = this._defaultPlaceholder;
    }
    if (was && this._chipsEl) this._updateSuggestions(this._inputEl?.value || '');
  }

  _renderOptionChips(options) {
    if (!this._chipsEl) return;
    this._chipsEl.innerHTML = '';
    for (const opt of options) {
      const chip = document.createElement('button');
      chip.className = 'dui-augment-chip dui-augment-chip--option';
      chip.type = 'button';
      chip.tabIndex = -1;
      chip.textContent = opt.label;
      // Keep the caret in the input so a typed answer still works after a hover.
      chip.addEventListener('mousedown', e => e.preventDefault());
      chip.addEventListener('click', () => opt.onPick && opt.onPick());
      this._chipsEl.appendChild(chip);
    }
  }

  toggle() {
    const bar = this._inputEl?.parentElement;
    if (!bar || !bar.classList.contains('dui-augment-bar--open')) this.open();
    else this.close();
  }

  /** Run a prompt programmatically */
  async prompt(text) {
    const intent = parseIntent(text);
    const obj    = this._resolveTargetObject(intent.targetProp);

    // ── 1. Smart property match ──────────────────────────────────────────
    // The user typed a property name (e.g. "stroke width", "opacity",
    // "rotation"). If it resolves to a KNOWN property of the target object —
    // either a live-scanned one or a host-declared latent render prop — add a
    // working control bound straight to it. This is the path that makes the
    // input feel "smart": no dead controls, the canvas reacts immediately.
    //
    // We only auto-add on a STRONG, UNAMBIGUOUS hit. A weak/partial match, or a
    // tie between two plausible props (e.g. "stroke" → Stroke Color vs Stroke
    // Width), falls through to the clarify flow below so we can ASK rather than
    // guess wrong.
    let known = null, ranked = null;
    if (obj) {
      known  = this._knownProps(obj);
      ranked = this._rankProps(text, known, intent);
      const best = ranked[0], second = ranked[1];
      const ambiguous = !!(best && second && best.score - second.score <= 80 && second.score >= 150);
      if (best && best.score >= 400 && !ambiguous) {
        const folder = this._addPropControl(obj, best.entry);
        this.analytics.record(text, intent, true);
        this._history.push({ prompt: text, ts: Date.now() });
        return folder ? [{ folder, recipe: null }] : [];
      }
    }

    // ── 2. Intent recipes (presets: fog, camera, material, color, …) ─────
    const scanned = obj ? scanProperties(obj, { depth: 2 }) : [];
    const ctx = {
      scene:    this.ui.scene    ?? this.ui._scene    ?? null,
      camera:   this.ui.camera   ?? this.ui._camera   ?? null,
      renderer: this.ui.renderer ?? this.ui._renderer ?? null,
    };
    const recipes = buildRecipe(intent, obj, scanned, ctx);
    // A "real" recipe wires up at least one working control; a `_fallback`
    // recipe is an inert placeholder. With a live object selected we refuse to
    // add inert placeholders — we'd rather tell the user what they CAN add.
    let real = recipes.filter(r => !r._fallback);

    // Guard the "dump every property" branch. buildRecipe falls into it when a
    // prompt has no recognised intent words AND no named target — fine for an
    // explicit scan ("show me everything", which matches the scan intent), but
    // for a random/unmatched word with an object selected we'd rather suggest
    // real property names than flood the panel. Suppress that lone dump here.
    const dumpOnly = obj && intent.intents.length === 0 && !intent.targetProp;
    if (dumpOnly) real = [];

    if (real.length > 0) {
      this.analytics.record(text, intent, true);
      const added = applyRecipe(this.ui, real);
      this._lastCode = real.map(r => r.codeHint ?? '').filter(Boolean).join('\n\n');
      this._history.push({ prompt: text, recipes: real, ts: Date.now() });
      this._showToast(`Added: ${real.map(r => r.folderName).join(', ')}`,
        this._lastCode ? { label: 'Copy code', action: () => this._copyCode() } : null);
      return added;
    }

    // ── 3. No confident match ────────────────────────────────────────────
    this.analytics.record(text, intent, false);

    // An object is selected but nothing matched strongly. Rather than dropping a
    // dead control (or just suggesting), be flexible: offer to wire up the
    // closest existing properties, or ADD the named property as a new control —
    // asking a follow-up question (type / range) only when we're genuinely
    // unsure. The augment bar itself turns into the question.
    if (obj) {
      this._clarifyOrAdd(obj, text, intent, ranked || this._rankProps(text, this._knownProps(obj), intent));
      return [];
    }

    // No object context at all. Scene-level placeholders are still useful
    // (the user can wire them up in code), so apply whatever fallback recipes
    // we have; otherwise show a help toast.
    if (recipes.length > 0) {
      const added = applyRecipe(this.ui, recipes);
      this._lastCode = recipes.map(r => r.codeHint ?? '').filter(Boolean).join('\n\n');
      this._history.push({ prompt: text, recipes, ts: Date.now() });
      this._showToast(`Added a placeholder for "${text}" — wire it up in code`,
        this._lastCode ? { label: 'Copy code', action: () => this._copyCode() } : null);
      return added;
    }

    this._showToast(`Couldn't match "${text}" — select an object, then type a property like "opacity" or "stroke width"`);
    return [];
  }

  // ── Smart property matching ──────────────────────────────────────────────

  /** Host-declared property descriptors for `obj` (array or fn(obj)=>array). */
  _declaredProps(obj) {
    const p = this.opts.properties;
    if (!p) return [];
    try {
      const list = typeof p === 'function' ? p(obj) : p;
      return Array.isArray(list) ? list.filter(d => d && d.name) : [];
    } catch (e) {
      console.warn('[Ghost Panel] augmentProperties threw:', e);
      return [];
    }
  }

  /**
   * Build a Map<lowercaseName, descriptor> of everything controllable on
   * `obj`. Host-declared descriptors come first (curated + authoritative, and
   * may include LATENT render props that don't exist on the object yet); a
   * live scan then fills in any remaining real properties.
   */
  _knownProps(obj) {
    const map = new Map();
    if (!obj) return map;
    const keyOf = name => (String(name).split('.').pop() || String(name)).toLowerCase();

    for (const d of this._declaredProps(obj)) {
      const current = getByPath(obj, d.name);
      map.set(keyOf(d.name), {
        name:    d.name,
        label:   d.label || labelOf(d.name),
        type:    d.type || (typeof current === 'boolean' ? 'boolean'
                          : typeof current === 'string'  ? 'string' : 'number'),
        value:   current !== undefined ? current : d.default,
        meta:    (d.min != null || d.max != null || d.step != null)
                   ? { min: d.min, max: d.max, step: d.step } : undefined,
        options: d.options,
        default: d.default,
        latent:  current === undefined,
      });
    }

    for (const p of scanProperties(obj, { depth: 2 })) {
      const k = keyOf(p.path);
      if (map.has(k)) continue;
      map.set(k, { name: p.path, label: p.label, type: p.type, value: p.value, meta: p.meta, latent: false });
    }
    return map;
  }

  /**
   * Rank known properties by how well a free-text prompt matches each one.
   * Tokenises the text, drops control-type / glue words, and scores name/label
   * overlap. Returns [{ entry, score }] sorted high→low (only scores > 0).
   */
  _rankProps(text, known, intent) {
    const out = [];
    if (!known || known.size === 0) return out;
    let qTokens = contentTokens(text);
    if (qTokens.length === 0 && intent?.targetProp) {
      qTokens = tokenizeWords(intent.targetProp).filter(t => !AUGMENT_STOP.has(t));
    }
    if (qTokens.length === 0) return out;
    const qJoin = qTokens.join(' ');

    for (const entry of known.values()) {
      const nameTokens  = tokenizeWords(entry.name);
      const labelTokens = tokenizeWords(entry.label);
      const propTokens  = new Set([...nameTokens, ...labelTokens]);
      const nameJoin    = nameTokens.join(' ');
      const labelJoin   = labelTokens.join(' ');
      const lastSeg     = (entry.name.split('.').pop() || '').toLowerCase();

      let score = 0;
      if (qJoin === nameJoin || qJoin === labelJoin || qJoin === lastSeg) {
        score = 1000;                                            // whole-string hit
      } else if (nameJoin.includes(qJoin) || labelJoin.includes(qJoin)) {
        score = 600 - Math.abs(labelJoin.length - qJoin.length); // substring hit
      } else {
        const hits = qTokens.filter(t => propTokens.has(t)).length;
        if (hits === qTokens.length)  score = 400 + hits * 10;   // every query token present
        else if (hits > 0)            score = 100 + hits * 20 - (qTokens.length - hits) * 5;
      }
      if (score > 0) out.push({ entry, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /**
   * Find the single known property a prompt is asking for (≥100 overlap), or
   * null. Thin wrapper over _rankProps kept for the direct-match path/tests.
   */
  _matchProp(text, known, intent) {
    const ranked = this._rankProps(text, known, intent);
    if (ranked.length === 0) {
      // The whole prompt was glue/control words (e.g. just "color"). Fall back
      // to the explicitly-parsed target name if it maps to a known prop.
      const tp = intent?.targetProp ? intent.targetProp.split('.').pop().toLowerCase() : null;
      return tp && known?.has(tp) ? known.get(tp) : null;
    }
    return ranked[0].score >= 100 ? ranked[0].entry : null;
  }

  // ── Flexible add + clarifying questions ──────────────────────────────────

  /**
   * No strong match. Decide whether to ASK ("did you mean…?") or just ADD a new
   * property. If close existing candidates exist, surface them (plus an "add
   * new" escape hatch) as a question. Otherwise synthesise the named property
   * and add it directly — asking for its type/range only if we can't infer them.
   */
  _clarifyOrAdd(obj, text, intent, ranked) {
    const candidates = (ranked || []).filter(r => r.score >= 100).slice(0, 3);
    const np = propNameFromText(text, intent);

    if (candidates.length > 0) {
      const options = candidates.map(c => ({
        label: c.entry.label || labelOf(c.entry.name),
        onPick: () => { this._resetAsk(); this.close(); this._addPropControl(obj, c.entry); },
      }));
      // Offer an "add new" escape hatch unless it would duplicate a candidate.
      if (np && !candidates.some(c => (c.entry.label || '').toLowerCase() === np.label.toLowerCase())) {
        options.push({ label: `+ Add “${np.label}”`, onPick: () => this._beginNewProp(obj, np.name, np.label) });
      }
      this._ask({
        question: candidates.length > 1 ? 'Which property?' : `Add “${candidates[0].entry.label}”?`,
        options,
        onText: (t) => { const n = propNameFromText(t, null); if (n) this._beginNewProp(obj, n.name, n.label); },
      });
      return;
    }

    // Nothing close — be flexible and add the named property as a new control.
    if (np) { this._beginNewProp(obj, np.name, np.label); return; }

    // Truly nothing to go on (prompt was all glue words) → suggest.
    this._suggestProps(obj, this._knownProps(obj), text);
  }

  /**
   * Add a brand-new property `name` to `obj`. Infer its control type from the
   * name; if that's not confident, ASK the user (the bar becomes the question).
   */
  _beginNewProp(obj, name, label) {
    const { type, confident } = inferTypeFromName(name, label);
    if (confident) { this._finishNewProp(obj, name, label, type, null); return; }
    this._askPropType(obj, name, label);
  }

  /** Follow-up #1: which control type should the new property use? */
  _askPropType(obj, name, label) {
    const pick = (type) => () => this._askRangeOrFinish(obj, name, label, type);
    this._ask({
      question: `Add “${label}” as…?`,
      options: [
        { label: 'Number',  onPick: pick('number')  },
        { label: 'Color',   onPick: pick('color')   },
        { label: 'Toggle',  onPick: pick('boolean') },
        { label: 'Text',    onPick: pick('string')  },
      ],
      onText: (t) => {
        const ty = normalizeType(t);
        if (ty) this._askRangeOrFinish(obj, name, label, ty);
        else this._askPropType(obj, name, label); // unrecognised → re-ask
      },
    });
  }

  /** Follow-up #2 (numbers only): what range should the slider span? */
  _askRangeOrFinish(obj, name, label, type) {
    if (type !== 'number') { this._finishNewProp(obj, name, label, type, null); return; }
    const pick = (meta) => () => this._finishNewProp(obj, name, label, 'number', meta);
    this._ask({
      question: `Range for “${label}”?`,
      options: [
        { label: '0 – 1',   onPick: pick({ min: 0,  max: 1,   step: 0.01 }) },
        { label: '0 – 100', onPick: pick({ min: 0,  max: 100, step: 1 })    },
        { label: '−1 – 1',  onPick: pick({ min: -1, max: 1,   step: 0.01 }) },
        { label: 'Auto',    onPick: pick(null) },
      ],
      onText: (t) => this._finishNewProp(obj, name, label, 'number', parseRange(t)),
    });
  }

  /** Commit a synthesised property: seed it, bind a control, dismiss the bar. */
  _finishNewProp(obj, name, label, type, meta) {
    this._resetAsk();
    this.close();
    const entry = {
      name, label, type,
      meta:    meta || (type === 'number' ? inferNumberMeta(name, 0) : undefined),
      default: this._defaultForType(type),
    };
    this._addPropControl(obj, entry);
  }

  _defaultForType(type) {
    switch (type) {
      case 'color':   return '#ffffff';
      case 'boolean': return true;
      case 'string':  return '';
      default:        return 0;
    }
  }
  _methodForType(type) {
    return type === 'color'   ? 'addColor'
         : type === 'boolean' ? 'addCheckbox'
         : type === 'select'  ? 'addSelect'
         : type === 'string'  ? 'addText'
         : 'addSlider';
  }

  /**
   * Add a working control for `entry` (a descriptor from _knownProps) bound to
   * `obj`. Seeds latent props with a default first so the canvas has a value
   * to read on the next frame, then binds onChange straight to the property.
   */
  _addPropControl(obj, entry) {
    if (!obj || !entry) return null;
    const niceName = objDisplayName(obj);
    const folder   = this.ui.addFolder(niceName);
    const label    = entry.label || labelOf(entry.name);

    if (folder.controls?.[label]) {        // already present — don't duplicate
      this._showToast(`"${label}" is already in ${niceName}`);
      return folder;
    }

    // Resolve a starting value; seed the object if the prop is latent so the
    // render loop immediately has something to read (and the control reflects
    // the live value rather than snapping it to a default).
    let value = getByPath(obj, entry.name);
    if (value === undefined) {
      value = entry.default !== undefined ? entry.default : this._defaultForType(entry.type);
      setByPath(obj, entry.name, value);
    }

    const onChange = v => setByPath(obj, entry.name, v);
    const method   = this._methodForType(entry.type);
    try {
      if (method === 'addColor') {
        const seed = typeof value === 'string' ? (cssColorIfString(value) ?? cssColorToHex(value)) : '#ffffff';
        folder.addColor(label, { value: seed, onChange });
      } else if (method === 'addCheckbox') {
        folder.addCheckbox(label, { value: !!value, onChange });
      } else if (method === 'addSelect') {
        folder.addSelect(label, { value, options: entry.options || [], onChange });
      } else if (method === 'addText') {
        folder.addText(label, { value: value ?? '', onChange });
      } else {
        const meta = entry.meta || inferNumberMeta(entry.name, typeof value === 'number' ? value : 0);
        folder.addSlider(label, {
          min: meta?.min ?? 0, max: meta?.max ?? 1, step: meta?.step ?? 0.01,
          value: typeof value === 'number' ? value : 0, onChange,
        });
      }
    } catch (e) {
      console.warn('[Ghost Panel] Could not add property control:', e);
      return null;
    }

    this._lastCode = `ui.addFolder('${niceName}').${method}('${label}', { value: ${JSON.stringify(value)}, onChange: v => obj.${entry.name} = v });`;
    this._history.push({ prompt: entry.name, ts: Date.now() });
    this._showToast(`Added ${label} → ${niceName}`,
      { label: 'Copy code', action: () => this._copyCode() });
    return folder;
  }

  /** No match found, but an object is selected — list what it CAN control. */
  _suggestProps(obj, known, text) {
    const niceName = objDisplayName(obj);
    const names = [...known.values()].map(e => (e.label || labelOf(e.name)).toLowerCase());
    if (names.length === 0) {
      this._showToast(`Couldn't match "${text}" — ${niceName} has no controllable properties`);
      return;
    }
    this._showToast(`No "${text}" on ${niceName}. Try: ${names.slice(0, 8).join(', ')}`);
  }

  _getSelectedObject() {
    const om = this.ui.objectManager;
    if (!om) return null;
    const name = om.activeName;
    if (!name) return null;
    const entry = om.objects?.[name];
    return entry?.object ?? null;
  }

  /**
   * Resolve the object a prompt should act on. Prefer the live selection;
   * otherwise try to match `targetProp` against a registered object name
   * (so "color picker for the pill" works even when nothing is selected) and
   * select it so the inspector follows along.
   */
  _resolveTargetObject(targetProp) {
    const selected = this._getSelectedObject();
    if (selected) return selected;
    const om = this.ui.objectManager;
    if (!om || !targetProp) return null;
    const direct = om.objects?.[targetProp]?.object;
    if (direct) { om.select?.(targetProp); return direct; }
    const names = om.getNames ? om.getNames() : Object.keys(om.objects || {});
    const tp = String(targetProp).toLowerCase();
    const hit = names.find(n => {
      const ln = n.toLowerCase();
      return ln === tp || ln.split('.')[0] === tp || ln.includes(tp);
    });
    if (hit) { om.select?.(hit); return om.objects[hit]?.object ?? null; }
    return null;
  }

  // ── Prompt bar UI ───────────────────────────────────────────────────────

  _buildUI() {
    const bar = document.createElement('div');
    bar.className = 'dui-augment-bar'; // closed by default via CSS max-height: 0, overflow: hidden

    const input = document.createElement('input');
    input.className = 'dui-augment-input';
    input.type = 'text';
    input.placeholder = 'Add controls… e.g. "fog controls", "scan this object", "camera fov"';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    this._inputEl = input;
    this._defaultPlaceholder = input.placeholder; // restored after a question

    // Suggestion chips — inside bar so they're hidden with it
    const chips = document.createElement('div');
    chips.className = 'dui-augment-chips';
    this._chipsEl = chips;

    bar.appendChild(input);
    bar.appendChild(chips);

    // Insert after the panel header.
    const header = this.ui.panel?.element?.querySelector('.dui-header');
    if (header) header.after(bar);
    else this.ui.panel?.element?.prepend(bar);

    // Keyboard handling. CRITICAL: stop every keystroke from bubbling up to
    // the window-level shortcut handlers (⌘/, Shift+D toggle, Space play/pause,
    // Shift+A add-menu, single-key tool binds, …). Without this, typing a
    // property name like "stroke width" would fire those global shortcuts —
    // the Space wouldn't insert, a 'd' would toggle the panel, etc. We only
    // intercept Enter/Escape ourselves; all other keys (Space included) fall
    // through to the input untouched.
    const stop = e => e.stopPropagation();
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter')       { e.preventDefault(); this._submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    input.addEventListener('keyup', stop);
    input.addEventListener('keypress', stop);

    input.addEventListener('input', () => this._updateSuggestions(input.value));

    // Populate default chips immediately
    this._updateSuggestions('');

    // Close on outside click.
    document.addEventListener('pointerdown', e => {
      if (!bar.contains(e.target) && e.target !== this._triggerBtn) this.close();
    }, { passive: true });
  }

  _updateSuggestions(text) {
    if (!this._chipsEl) return;
    if (this._asking) return; // question-answer chips are managed by _ask()
    const obj = this._getSelectedObject();
    const name = obj?.name;

    // Build chip suggestions based on current text + selected object.
    const suggestions = [];

    if (!text || text.length < 2) {
      // Default quick-access suggestions. When an object is selected, lead with
      // its own controllable properties so a click adds a real, working control
      // (the smart-match path) rather than a generic preset.
      if (obj) {
        const known = this._knownProps(obj);
        for (const e of [...known.values()].slice(0, 5)) {
          suggestions.push((e.label || labelOf(e.name)).toLowerCase());
        }
        if (obj.material) suggestions.push('material controls');
      }
      if (suggestions.length === 0) {
        suggestions.push('fog controls', 'background color', 'camera fov');
      }
    } else {
      // Filter intents that match the typed text.
      const matched = INTENTS.filter(i => i.re.test(text));
      for (const m of matched.slice(0, 5)) {
        const label = obj
          ? `${m.hint} for ${name || 'selection'}`
          : m.hint;
        suggestions.push(label);
      }
      // Suggest matching props from the selected object — including latent
      // host-declared render props (strokeWidth, rotation, …). The chip text is
      // just the property label, so clicking it runs the smart-match path.
      if (obj && text.length > 1) {
        const t = text.toLowerCase();
        const known = this._knownProps(obj);
        const propMatches = [...known.values()].filter(e =>
          (e.label || '').toLowerCase().includes(t) ||
          (e.name  || '').toLowerCase().includes(t)
        ).slice(0, 4);
        for (const e of propMatches) {
          const chip = (e.label || labelOf(e.name)).toLowerCase();
          if (!suggestions.includes(chip)) suggestions.push(chip);
        }
      }
    }

    // Render chips.
    this._chipsEl.innerHTML = '';
    for (const s of suggestions.slice(0, 6)) {
      const chip = document.createElement('button');
      chip.className = 'dui-augment-chip';
      chip.type = 'button';
      // Keep chips out of the tab order and prevent them from stealing focus
      // from the input on click — otherwise a focused chip would swallow the
      // next Space press (activating the button) instead of letting the user
      // type. mousedown.preventDefault keeps the caret in the input.
      chip.tabIndex = -1;
      chip.textContent = s;
      chip.addEventListener('mousedown', e => e.preventDefault());
      chip.addEventListener('click', () => {
        this._inputEl.value = s;
        this._submit();
      });
      this._chipsEl.appendChild(chip);
    }
  }

  async _submit() {
    const text = this._inputEl?.value?.trim();
    // In question mode, a typed answer routes to the pending question's handler
    // (chip clicks are handled directly by their onPick). Don't fall through to
    // prompt() or close the bar — there may be a follow-up question.
    if (this._asking) {
      this._inputEl.value = '';
      if (text && this._pending?.onText) this._pending.onText(text);
      return;
    }
    if (!text) return;
    this._inputEl.value = '';
    this.close();
    await this.prompt(text);
  }

  _copyCode() {
    navigator.clipboard?.writeText(this._lastCode)
      .then(() => this._showToast('Code copied to clipboard'))
      .catch(() => console.info('[Ghost Panel] Generated code:\n' + this._lastCode));
  }

  _showToast(message, action = null) {
    // Reuse the existing toast system if available.
    if (typeof window.__gpToast === 'function') {
      window.__gpToast(message);
      return;
    }
    // Fallback: simple floating toast.
    const t = document.createElement('div');
    t.className = 'dui-augment-toast';
    t.textContent = message;
    if (action) {
      const btn = document.createElement('button');
      btn.textContent = action.label;
      btn.className = 'dui-augment-toast-btn';
      btn.addEventListener('click', action.action);
      t.appendChild(btn);
    }
    document.body.appendChild(t);
    // NOTE: the reveal class must match the CSS (.dui-augment-toast--visible).
    // It was previously '--in', which has no matching rule, so this fallback
    // toast stayed at opacity:0 and never showed.
    requestAnimationFrame(() => t.classList.add('dui-augment-toast--visible'));
    setTimeout(() => {
      t.classList.remove('dui-augment-toast--visible');
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Attach the augment engine to a Ghost Panel ui handle.
 * Adds the ✦ button to the panel header and wires ⌘/ shortcut.
 *
 * @param {object} ui
 * @param {object} [opts]
 * @returns {AugmentEngine}
 */
export function attachAugment(ui, opts = {}) {
  const engine = new AugmentEngine(ui, opts);
  ui._augment = engine;

  // ✦ button in header.
  const header = ui.panel?.element?.querySelector('.dui-header');
  if (header) {
    _addAugmentButton(header, engine);
  } else {
    requestAnimationFrame(() => {
      const h = ui.panel?.element?.querySelector('.dui-header');
      if (h) _addAugmentButton(h, engine);
    });
  }

  // ⌘/ global shortcut.
  window.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      engine.toggle();
    }
  });

  return engine;
}

function _addAugmentButton(header, engine) {
  const btn = document.createElement('button');
  btn.className = 'dui-header-btn dui-augment-trigger';
  btn.setAttribute('data-tooltip', 'Ask Ghost Panel (⌘/)');
  btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
    <circle cx="8" cy="8" r="6"/>
    <path d="M6 6.5C6 5.1 7 4 8 4s2 1 2 2.5c0 1-1 1.5-2 2v.5M8 11.5v.5"/>
  </svg>`;
  engine._triggerBtn = btn; // store so open/close can set active state
  btn.addEventListener('click', e => { e.stopPropagation(); engine.toggle(); });

  // Insert before the actions span.
  const actions = header.querySelector('.dui-header-actions');
  if (actions) actions.before(btn);
  else header.appendChild(btn);
}
