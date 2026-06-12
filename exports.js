/**
 * Export system — context-aware deliverable generation.
 *
 * Each workflow declares the export formats it can produce. The UI shows
 * the user only formats relevant to the currently-active workflows.
 *
 * Each exporter has:
 *   - id           short identifier ('json', 'png', 'webm', 'glb')
 *   - label        human label ('PNG snapshot')
 *   - mime         output mime type
 *   - extension    file extension (no dot)
 *   - workflows    array of workflow ids this exporter applies to ('*' = always)
 *   - run(ui, opts) async function → returns Blob OR string OR { blob, filename }
 *
 * Built-in exporters: JSON, PNG, WebM, GLB, SVG, HTML snippet, animation
 * keyframes JSON, shader source code.
 */

// ─── Built-in registry ──────────────────────────────────────────────────
const REGISTRY = [];

/** Register a new exporter (callable from anywhere). */
export function registerExporter(exp) {
  REGISTRY.push(exp);
  return exp;
}

/** Find exporters that apply to the given active workflows.
 *
 * When `activeWorkflows` is empty (common in integrated projects that
 * don't trip workflow auto-detection), we fall back to returning every
 * registered exporter — without this, the export menu silently
 * collapses to just the universal JSON snapshot. The user can still
 * pick a format manually; runtime failures (e.g. exporting GLB from a
 * scene with no meshes) surface via the existing toast/alert path.
 */
export function getAvailableExporters(activeWorkflows = []) {
  const list = Array.isArray(activeWorkflows) ? activeWorkflows : [...(activeWorkflows || [])];
  if (list.length === 0) return REGISTRY.slice();
  const set = new Set(list);
  return REGISTRY.filter(e =>
    !e.workflows ||
    e.workflows.includes('*') ||
    e.workflows.some(w => set.has(w))
  );
}

/** Return every registered exporter, regardless of workflow scope.
 *  Handy for host UIs that want to show the full catalog. */
export function getAllExporters() {
  return REGISTRY.slice();
}

/** Trigger a browser download of a Blob or string. */
export function downloadBlob(data, filename, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ─── Universal: JSON snapshot ──────────────────────────────────────────
registerExporter({
  id: 'json',
  label: 'Settings JSON',
  description: 'Snapshot of all panel values + registered object transforms',
  mime: 'application/json',
  extension: 'json',
  workflows: ['*'],
  async run(ui) {
    const data = ui.toJSON();
    return {
      blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      filename: `ghost-panel-${timestamp()}.json`,
    };
  },
});

// ─── 3D: PNG snapshot of the canvas ────────────────────────────────────
registerExporter({
  id: 'png',
  label: 'PNG snapshot',
  description: 'Full-resolution image of the current canvas',
  mime: 'image/png',
  extension: 'png',
  workflows: ['3d', '2d', 'shader', 'ascii'],
  async run(ui, opts = {}) {
    const canvas = opts.canvas || ui._renderer?.domElement || document.querySelector('canvas');
    if (!canvas) throw new Error('No canvas found for PNG export');
    // Re-render once so the frame is up-to-date (for Three.js: preserveDrawingBuffer is needed)
    if (ui._renderer && ui._scene && ui._camera) ui._renderer.render(ui._scene, ui._camera);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Canvas could not be exported as PNG'));
        resolve({ blob, filename: `snapshot-${timestamp()}.png` });
      }, 'image/png');
    });
  },
});

// ─── 3D / Animation: WebM video of the canvas via MediaRecorder ────────
registerExporter({
  id: 'webm',
  label: 'WebM video',
  description: 'Record the canvas as a WebM video (default 5s @ 30fps)',
  mime: 'video/webm',
  extension: 'webm',
  workflows: ['3d', '2d', 'shader', 'animation'],
  async run(ui, opts = {}) {
    const canvas = opts.canvas || ui._renderer?.domElement || document.querySelector('canvas');
    if (!canvas) throw new Error('No canvas found for video export');
    const duration = opts.duration || 5;          // seconds
    const fps      = opts.fps || 30;
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const stream = canvas.captureStream(fps);
    const rec    = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    return new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        resolve({ blob, filename: `recording-${timestamp()}.webm` });
      };
      rec.onerror = reject;
      rec.start();
      // Auto-stop after `duration` seconds
      setTimeout(() => rec.state === 'recording' && rec.stop(), duration * 1000);
    });
  },
});

// ─── 3D: GLB export via Three.js GLTFExporter ──────────────────────────
registerExporter({
  id: 'glb',
  label: 'GLB (3D scene)',
  description: 'Export the scene as a binary glTF file',
  mime: 'model/gltf-binary',
  extension: 'glb',
  workflows: ['3d'],
  async run(ui) {
    if (!ui._scene) throw new Error('No Three.js scene available');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    return new Promise((resolve, reject) => {
      exporter.parse(ui._scene, (result) => {
        if (result instanceof ArrayBuffer) {
          resolve({
            blob: new Blob([result], { type: 'model/gltf-binary' }),
            filename: `scene-${timestamp()}.glb`,
          });
        } else {
          // JSON-form fallback
          resolve({
            blob: new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' }),
            filename: `scene-${timestamp()}.gltf`,
          });
        }
      }, reject, { binary: true });
    });
  },
});

// ─── 3D: OBJ export ────────────────────────────────────────────────────
registerExporter({
  id: 'obj',
  label: 'OBJ (3D mesh)',
  description: 'Export geometry as Wavefront OBJ (geometry only)',
  mime: 'model/obj',
  extension: 'obj',
  workflows: ['3d'],
  async run(ui) {
    if (!ui._scene) throw new Error('No Three.js scene available');
    const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
    const exporter = new OBJExporter();
    const text = exporter.parse(ui._scene);
    return { blob: new Blob([text], { type: 'model/obj' }), filename: `scene-${timestamp()}.obj` };
  },
});

// ─── Animation: keyframes JSON ─────────────────────────────────────────
registerExporter({
  id: 'animation-json',
  label: 'Animation keyframes',
  description: 'Export all tracks + keyframes as JSON',
  mime: 'application/json',
  extension: 'json',
  workflows: ['animation'],
  async run(ui) {
    const editor = ui._graphEditor;
    if (!editor) throw new Error('No animation graph editor active');
    const data = { duration: editor.getTime ? undefined : null, tracks: editor.getTracks() };
    return {
      blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      filename: `animation-${timestamp()}.json`,
    };
  },
});

// ─── Animation: CSS keyframes ──────────────────────────────────────────
// Real CSS — groups tracks bound to the same web-element (or any object
// with `_el` and CSS-friendly props) into a single @keyframes rule that
// emits `transform: translate() rotate() scale()` + `opacity`. For tracks
// without a recognizable web target, falls back to per-track --value blocks
// so animation work that isn't DOM-bound still round-trips through CSS.
registerExporter({
  id: 'css-keyframes',
  label: 'CSS @keyframes',
  description: 'Convert animation tracks to CSS @keyframes blocks',
  mime: 'text/css',
  extension: 'css',
  workflows: ['animation', 'web'],
  async run(ui) {
    const editor = ui._graphEditor;
    if (!editor) throw new Error('No animation graph editor active');
    const groups = groupTracksByTarget(editor);
    const duration = Math.max(...Object.values(groups).flatMap(g => g.times)) || 1;
    let css = `/* Ghost Panel CSS keyframes export — ${duration.toFixed(2)}s timeline */\n\n`;
    Object.entries(groups).forEach(([id, group]) => {
      if (group.kind !== 'web') return;  // skip non-DOM groups in CSS body
      const safe = sanitizeIdent(id);
      const animName = `${safe}-anim`;
      css += `@keyframes ${animName} {\n`;
      group.times.forEach(t => {
        const sample = sampleAtTime(group, t);
        const pct = ((t / duration) * 100).toFixed(2);
        const decls = composeCSSDeclarations(sample, group.easingAt(t));
        css += `  ${pct}% { ${decls} }\n`;
      });
      css += `}\n`;
      css += `[data-ghost-panel-adapter="${id}"], .${safe} {\n`;
      css += `  animation: ${animName} ${duration.toFixed(3)}s linear infinite;\n`;
      css += `  transform-origin: 0 0;\n`;
      css += `}\n\n`;
    });
    return { blob: new Blob([css], { type: 'text/css' }), filename: `keyframes-${timestamp()}.css` };
  },
});

// ─── Web: Web Animations API (WAAPI) script ────────────────────────────
// Generates a runnable JS snippet that calls `element.animate(...)` for
// each bound web element. The user can paste it into any project that
// has matching `[data-ghost-panel-adapter="..."]` elements — no Ghost Panel
// runtime required.
registerExporter({
  id: 'waapi',
  label: 'Web Animations API script',
  description: 'JS snippet that drives the same animation via element.animate()',
  mime: 'application/javascript',
  extension: 'js',
  workflows: ['web', 'animation'],
  async run(ui) {
    const editor = ui._graphEditor;
    if (!editor) throw new Error('No animation graph editor active');
    const groups = groupTracksByTarget(editor);
    const duration = Math.max(...Object.values(groups).flatMap(g => g.times)) || 1;
    let js = `// Ghost Panel WAAPI export — drop into a page that has matching\n`;
    js += `// [data-ghost-panel-adapter="..."] elements (or rename the selectors).\n`;
    js += `// Returns the Animation handles so you can pause / scrub them.\n\n`;
    js += `export function playGhostPanelAnimations(root = document) {\n`;
    js += `  const handles = {};\n`;
    Object.entries(groups).forEach(([id, group]) => {
      if (group.kind !== 'web') return;
      const safe = sanitizeIdent(id);
      const frames = group.times.map(t => {
        const sample = sampleAtTime(group, t);
        const decls  = composeJSKeyframe(sample, group.easingAt(t), t / duration);
        return `    ${decls}`;
      }).join(',\n');
      js += `  const el_${safe} = root.querySelector('[data-ghost-panel-adapter="${id}"]');\n`;
      js += `  if (el_${safe}) handles[${JSON.stringify(id)}] = el_${safe}.animate([\n`;
      js += frames + '\n';
      js += `  ], { duration: ${(duration * 1000).toFixed(0)}, iterations: Infinity });\n`;
    });
    js += `  return handles;\n}\n`;
    return { blob: new Blob([js], { type: 'application/javascript' }), filename: `waapi-${timestamp()}.js` };
  },
});

// ─── Shared helpers ────────────────────────────────────────────────────
function sanitizeIdent(s) {
  return String(s).replace(/[^a-zA-Z0-9_]/g, '_');
}
function easingToCSS(name) {
  // Map Ghost Panel's named easings to CSS timing-functions. Bezier per-key
  // overrides are honored at the call site.
  return ({
    linear:    'linear',
    easeIn:    'cubic-bezier(0.42, 0, 1, 1)',
    easeOut:   'cubic-bezier(0, 0, 0.58, 1)',
    easeInOut: 'cubic-bezier(0.42, 0, 0.58, 1)',
  })[name] || 'linear';
}
function groupTracksByTarget(editor) {
  // Reach past getTracks() (which strips bindings) into state via the
  // editor's internal API. We re-derive bindings by name-matching against
  // the host's objectManager isn't quite enough — instead use the live
  // Track[] held by `editor._state.tracks` if exposed, else rebuild.
  const liveTracks = editor._tracks || editor.state?.tracks || editor.getTracksFull?.() || [];
  const fallback = editor.getTracks();
  const tracks = liveTracks.length ? liveTracks : fallback;
  const groups = {};
  tracks.forEach(t => {
    const obj = t.binding?.object;
    const isWeb = !!(obj && obj._el && 'x' in obj && 'y' in obj);
    const id = obj?.name || t.name.split(' ')[0];
    const g = (groups[id] ||= {
      kind: isWeb ? 'web' : 'value',
      object: obj,
      tracksByPath: {},
      times: [],
      keyMeta: new Map(),  // time → { easing, bezier }
      easingAt(time) {
        return this.keyMeta.get(time) || { easing: 'linear' };
      },
    });
    if (t.binding?.path) g.tracksByPath[t.binding.path] = t;
    else g.tracksByPath[t.name] = t;
    t.keys.forEach(k => {
      if (!g.times.includes(k.time)) g.times.push(k.time);
      // Store the most expressive easing seen at this time
      if (!g.keyMeta.has(k.time)) g.keyMeta.set(k.time, { easing: k.easing, bezier: k.bezier });
    });
  });
  Object.values(groups).forEach(g => g.times.sort((a, b) => a - b));
  return groups;
}
function sampleAtTime(group, t) {
  // Seed with the adapter's live values so paths without a track keep their
  // static value (e.g. a card with only an x-track still gets y, width, etc.)
  const obj = group.object;
  const out = {};
  if (obj) {
    ['x','y','rotation','width','height','opacity'].forEach(k => {
      if (typeof obj[k] === 'number') out[k] = obj[k];
    });
  }
  Object.entries(group.tracksByPath).forEach(([path, track]) => {
    if (typeof track.sample === 'function') {
      out[path] = track.sample(t);
    } else {
      out[path] = sampleLinear(track.keys, t);
    }
  });
  return out;
}
function sampleLinear(keys, t) {
  if (!keys.length) return 0;
  if (t <= keys[0].time) return keys[0].value;
  if (t >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.time && t <= b.time) {
      const u = (t - a.time) / (b.time - a.time);
      return a.value + (b.value - a.value) * u;
    }
  }
  return keys[0].value;
}
function composeTransform(sample) {
  const tx = sample.x ?? 0, ty = sample.y ?? 0;
  const rot = sample.rotation ?? 0;
  const hasW = typeof sample.width  === 'number';
  const hasH = typeof sample.height === 'number';
  let scale = '';
  if (hasW || hasH) {
    // We don't know the adapter's baseWidth here, so emit width/height via
    // style instead and skip the scale factor in `transform`. The browser
    // will animate `width`/`height` directly (animatable for many elements).
  }
  return `translate(${tx}px, ${ty}px) rotate(${rot}rad)${scale}`;
}
function composeCSSDeclarations(sample, meta) {
  const parts = [`transform: ${composeTransform(sample)};`];
  if (typeof sample.opacity === 'number') parts.push(`opacity: ${sample.opacity};`);
  if (typeof sample.width  === 'number')  parts.push(`width: ${sample.width}px;`);
  if (typeof sample.height === 'number')  parts.push(`height: ${sample.height}px;`);
  if (meta?.bezier) {
    parts.push(`animation-timing-function: cubic-bezier(${meta.bezier.join(',')});`);
  } else if (meta?.easing) {
    parts.push(`animation-timing-function: ${easingToCSS(meta.easing)};`);
  }
  return parts.join(' ');
}
function composeJSKeyframe(sample, meta, offset) {
  const frame = { offset: +offset.toFixed(4) };
  frame.transform = composeTransform(sample);
  if (typeof sample.opacity === 'number') frame.opacity = sample.opacity;
  if (typeof sample.width  === 'number')  frame.width  = `${sample.width}px`;
  if (typeof sample.height === 'number')  frame.height = `${sample.height}px`;
  if (meta?.bezier) frame.easing = `cubic-bezier(${meta.bezier.join(',')})`;
  else if (meta?.easing) frame.easing = easingToCSS(meta.easing);
  return JSON.stringify(frame);
}

// ─── Shader: GLSL source code ──────────────────────────────────────────
registerExporter({
  id: 'glsl',
  label: 'GLSL source',
  description: 'Export all custom shader materials as .glsl files',
  mime: 'text/x-glsl',
  extension: 'glsl',
  workflows: ['shader'],
  async run(ui) {
    if (!ui._scene) throw new Error('No Three.js scene available');
    const shaders = [];
    ui._scene.traverse(node => {
      const m = node.material;
      const mats = Array.isArray(m) ? m : (m ? [m] : []);
      mats.forEach(mat => {
        if (mat && (mat.type === 'ShaderMaterial' || mat.type === 'RawShaderMaterial')) {
          shaders.push({ name: mat.name || node.name || 'shader', vs: mat.vertexShader, fs: mat.fragmentShader });
        }
      });
    });
    let out = '// Ghost Panel shader export\n\n';
    shaders.forEach((s, i) => {
      out += `// ────── ${s.name || `shader_${i}`} ──────\n\n`;
      out += `// VERTEX\n${s.vs}\n\n`;
      out += `// FRAGMENT\n${s.fs}\n\n`;
    });
    return { blob: new Blob([out], { type: 'text/plain' }), filename: `shaders-${timestamp()}.glsl` };
  },
});

// ─── ASCII / 2D: SVG snapshot ──────────────────────────────────────────
registerExporter({
  id: 'svg',
  label: 'SVG snapshot',
  description: 'Vector snapshot of the canvas (works best for 2D / ASCII)',
  mime: 'image/svg+xml',
  extension: 'svg',
  workflows: ['ascii', '2d'],
  async run(ui, opts = {}) {
    const canvas = opts.canvas || document.querySelector('canvas');
    if (!canvas) throw new Error('No canvas found');
    const dataURL = canvas.toDataURL('image/png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
      <image href="${dataURL}" width="${canvas.width}" height="${canvas.height}"/>
    </svg>`;
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), filename: `snapshot-${timestamp()}.svg` };
  },
});

// ─── Universal: standalone HTML snippet ────────────────────────────────
registerExporter({
  id: 'html-snippet',
  label: 'HTML snippet',
  description: 'A small self-contained HTML file that recreates the current state',
  mime: 'text/html',
  extension: 'html',
  workflows: ['*'],
  async run(ui) {
    const state = ui.toJSON();
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Ghost Panel export</title></head>
<body>
<pre id="state">${JSON.stringify(state, null, 2)}</pre>
<script type="module">
  import { createGhostPanel } from 'https://your-cdn/ghost-panel/index.js';
  const state = ${JSON.stringify(state)};
  const ui = createGhostPanel({ visible: true });
  ui.fromJSON(state);
</script>
</body>
</html>`;
    return { blob: new Blob([html], { type: 'text/html' }), filename: `export-${timestamp()}.html` };
  },
});

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Run an exporter by id. Triggers a browser download with the result.
 */
export async function runExport(ui, id, opts = {}) {
  const exp = REGISTRY.find(e => e.id === id);
  if (!exp) throw new Error(`Unknown exporter: ${id}`);
  const result = await exp.run(ui, opts);
  const filename = result.filename || `export.${exp.extension}`;
  const blob     = result.blob || result;
  if (opts.skipDownload) return result;
  downloadBlob(blob, filename, exp.mime);
  return result;
}
