/**
 * Learning store — captures runtime mistakes and user-pattern signals,
 * matches them against a registry of known-fix proposals, and (when the
 * Vite plugin is mounted) writes the fix straight back to the source file.
 *
 * Lifecycle:
 *   1. attachLearning(ui)         hooks window.onerror + unhandledrejection
 *                                 and observes ui.objectManager / ui._undo
 *                                 for patterns we know how to act on.
 *   2. ui._learning.observe(...)  hosts can push custom signals.
 *   3. ui._learning.proposals     each detected pattern yields a structured
 *                                 { file, find, replace, reason } proposal.
 *   4. ui._learning.apply(p)      POSTs to /__ghost-panel/apply-fix, which the
 *                                 Vite plugin patches in-place. The page
 *                                 hot-reloads with the corrected source.
 *
 * In production (`isDev() === false`) attachLearning is a no-op — every
 * branch self-strips so users don't ship the patcher in their bundle.
 */
import { isDev } from './dev-mode.js';
import { showToast } from './toast.js';
import { icons } from './icons.js';
import { escapeHtml } from './utils.js';
import { log } from './log.js';

const ENDPOINT = '/__ghost-panel/apply-fix';
const STORAGE_KEY = 'ghost-panel:learning';

// Seed patterns — every entry corresponds to a mistake I (or the harness)
// hit during development. Each defines:
//   match(record)   → boolean: does this incoming signal match?
//   proposal(record)→ { file, find, replace, reason } to write to disk.
// Patterns are intentionally minimal-context so the find string is a unique
// anchor in the source; the replace is the corrected version verbatim.
const PATTERN_REGISTRY = [
  {
    id: 'three-r0.160-getHelper',
    summary: '`TransformControls.getHelper()` missing in Three.js <0.165',
    match: (r) => r.kind === 'error' && /getHelper is not a function/.test(r.message || ''),
    proposal: () => ({
      file: 'three-extensions.js',
      find: `this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(1.0);
    this.scene.add(this.gizmo.getHelper());`,
      replace: `this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(1.0);
    if (typeof this.gizmo.getHelper !== 'function') {
      this.gizmo.getHelper = () => this.gizmo;
    }
    this.scene.add(this.gizmo.getHelper());`,
      reason: 'Three.js r0.165 split TransformControls into controller+helper. ' +
              'On older versions the gizmo *is* the helper — polyfill the method.',
    }),
  },
  {
    id: 'object3d-clone-circular',
    summary: 'Object3D.clone() fails on circular userData.mixer._root',
    match: (r) => r.kind === 'error' &&
                  /circular structure to JSON/.test(r.message || '') &&
                  /mixer|AnimationMixer/.test(r.message || ''),
    proposal: () => ({
      file: 'index.js',
      find: 'newObj = clip.source.clone(true);',
      replace: `// stash mixers/circular fields, clone, then restore
    const __stash = [];
    clip.source.traverse(n => {
      if (n.userData?.mixer) { __stash.push([n, n.userData]); n.userData = { ...n.userData, mixer: undefined }; }
    });
    try { newObj = clip.source.clone(true); }
    finally { __stash.forEach(([n, u]) => { n.userData = u; }); }`,
      reason: 'Three.js Object3D.clone() deep-copies userData via JSON.stringify, ' +
              'which throws on the back-reference inside AnimationMixer.',
    }),
  },
  {
    id: 'modal-transform-stale-mouse',
    summary: 'ModalTransform first G press jumps the target far from cursor',
    match: (r) => r.kind === 'pattern' && r.pattern === 'modal-transform-jump',
    proposal: () => ({
      file: 'modal-transform.js',
      find: `this._onMouseMove = (e) => {
      if (!this.active) return;
      this._lastMouse = { x: e.clientX, y: e.clientY };`,
      replace: `this._onMouseMove = (e) => {
      // Track cursor always — otherwise the first G/R/S captures stale state.
      this._lastMouse = { x: e.clientX, y: e.clientY };
      if (!this.active) return;`,
      reason: '_lastMouse only updated while active → start.mouse defaulted to ' +
              'object screen pos → big delta on first real move.',
    }),
  },
  {
    id: 'select-no-change-emit',
    summary: 'SceneObjectManager.select() never fires `change` event',
    match: (r) => r.kind === 'pattern' && r.pattern === 'select-without-change',
    proposal: () => ({
      file: 'three-extensions.js',
      find: `    this.gizmo.setMode(this.currentMode);
  }
  deselect() {`,
      replace: `    this.gizmo.setMode(this.currentMode);
    this._listeners.change?.forEach(cb => { try { cb(this.activeName, this.objects[name].object); } catch (e) { log.warn('learning', 'localStorage save failed:', e); } });
  }
  deselect() {`,
      reason: 'Without the explicit emit, canvas-click selection failed to ' +
              'refresh the contextual inspector (mini toolbar, Properties, etc.).',
    }),
  },
  {
    // Class of bug where a UI control mutates a property the live target
    // can't consume — most commonly `material.map` on a `ShaderMaterial`
    // or `MeshNormalMaterial`. The control fires, the property is set,
    // and the viewport doesn't change. The runtime audit below surfaces
    // this via the 'material-prop-no-effect' signal.
    id: 'material-prop-no-effect',
    summary: 'Property written to a material/object that does not consume it',
    match: (r) => r.kind === 'pattern' && r.pattern === 'material-prop-no-effect',
    proposal: (r) => ({
      file: r.file || 'contextual.js',
      // Anchor on the canonical broken assignment so the suggestion is
      // actionable even when the call site varies.
      find: `mat.map = tex;`,
      replace: `if (!TEXTURE_CAPABLE_MATERIALS.has(object.material.type)) {
      // Promote to a material whose shader actually samples .map.
      const prev = object.material;
      object.material = new THREE.MeshStandardMaterial({
        color: prev.color?.clone?.() || 0xffffff, roughness: 0.5,
      });
      prev.dispose?.();
    }
    object.material.map = tex;
    if (object.material.color) object.material.color.set(0xffffff);
    object.material.needsUpdate = true;`,
      reason: r.detail || 'A texture was assigned to a material that does not ' +
              'sample .map. Promote the material first so the upload is visible.',
    }),
  },
  {
    // Generic "I clicked / dragged / typed and nothing happened" detector.
    // Fired by the runtime audit when a user gesture didn't produce any
    // observable change on its target after one tick.
    id: 'silent-control',
    summary: 'UI control fired but target state did not change',
    match: (r) => r.kind === 'pattern' && r.pattern === 'silent-control',
    proposal: (r) => ({
      file: r.file || 'contextual.js',
      find: r.find || '// (no anchor)',
      replace: r.replace || '// add missing needsUpdate / event emit here',
      reason: r.detail || 'A control changed the input value but the bound ' +
              'object property did not reflect the new value. Common causes: ' +
              'missing material.needsUpdate, stale closure ref, missing change ' +
              'event emit on the manager method.',
    }),
  },
];

export class LearningStore {
  constructor(ui) {
    this.ui = ui;
    this.records = [];
    this.proposals = [];
    this._listeners = [];
    this._loadPersisted();
  }

  /** Push a structured signal — auto-runs match/propose against the registry. */
  observe(record) {
    record.ts = record.ts || Date.now();
    this.records.push(record);
    if (this.records.length > 200) this.records.shift();
    // Match against known patterns, dedup by id.
    PATTERN_REGISTRY.forEach(p => {
      if (!p.match(record)) return;
      if (this.proposals.some(x => x.id === p.id)) return;
      const proposal = p.proposal(record);
      this.proposals.push({ id: p.id, summary: p.summary, ...proposal });
    });
    this._persist();
    this._emit();
  }

  /** Apply a proposal by POSTing it to the Vite plugin endpoint. */
  async apply(proposal) {
    if (!proposal) return { ok: false, error: 'no proposal' };
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: proposal.file, find: proposal.find, replace: proposal.replace,
          reason: proposal.reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Drop the proposal — the next reload should clear the matching
        // error from the records too. Keep the audit trail in `records`.
        this.proposals = this.proposals.filter(p => p.id !== proposal.id);
        this.observe({ kind: 'applied', proposalId: proposal.id, file: proposal.file });
        return { ok: true, ...data };
      }
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Subscribe to changes (new records / proposals). */
  on(cb) { this._listeners.push(cb); return () => { this._listeners = this._listeners.filter(f => f !== cb); }; }
  _emit() { this._listeners.forEach(cb => { try { cb(this); } catch (e) { log.warn('learning', 'localStorage load failed:', e); } }); }

  /** Wipe state. */
  clear() { this.records = []; this.proposals = []; this._persist(); this._emit(); }

  _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ records: this.records.slice(-50), proposals: this.proposals })); } catch (e) { log.debug('learning', 'listener failed:', e); }
  }
  _loadPersisted() {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (Array.isArray(v.records))  this.records  = v.records;
      if (Array.isArray(v.proposals)) this.proposals = v.proposals;
    } catch (e) { log.warn('learning', 'localStorage load failed:', e); }
  }
}

/**
 * Wire the learning store onto a ui handle. No-op in production builds.
 * Returns the LearningStore for chaining.
 */
export function attachLearning(ui) {
  if (!isDev()) return null;
  const store = new LearningStore(ui);
  ui._learning = store;

  // ── Runtime error capture ──
  const onError = (e) => store.observe({
    kind: 'error', message: e.message || String(e.error?.message || e),
    filename: e.filename, line: e.lineno, col: e.colno,
    stack: e.error?.stack?.slice(0, 800),
  });
  const onRejection = (e) => store.observe({
    kind: 'error', message: e.reason?.message || String(e.reason),
    stack: e.reason?.stack?.slice(0, 800),
  });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  // ── Pattern detector: modal-transform jump ──
  // Watch every commit; if the position delta on the FIRST move is more
  // than 5× the cursor screen delta, flag it.
  if (ui._modalTransform || ui._modal2DTransform) {
    [ui._modalTransform, ui._modal2DTransform].filter(Boolean).forEach(mt => {
      const origBegin = mt.begin?.bind(mt);
      if (!origBegin) return;
      mt.begin = function(mode, target) {
        const beforeMouse = this._lastMouse ? { ...this._lastMouse } : null;
        const beforeWorld = target?.position
          ? { x: target.position.x, y: target.position.y, z: target.position.z }
          : { x: target?.x ?? 0, y: target?.y ?? 0 };
        const out = origBegin(mode, target);
        // Sample one rAF later — if the start mouse was null, lastMouse will
        // have been seeded from the target's screen pos (the bug condition).
        requestAnimationFrame(() => {
          if (!beforeMouse) {
            store.observe({ kind: 'pattern', pattern: 'modal-transform-jump',
              detail: 'modal session began with no prior mousemove' });
          }
        });
        return out;
      };
    });
  }

  // ── Pattern detector: select without change-event ──
  // Wrap objectManager.select; if no 'change' listener fires within a tick,
  // record the pattern so we can offer the emit-on-select fix.
  if (ui.objectManager?.select) {
    const om = ui.objectManager;
    let changeSeen = false;
    om.on?.('change', () => { changeSeen = true; });
    const origSelect = om.select.bind(om);
    om.select = function(name, ...rest) {
      // Forward ALL trailing args (e.g. { additive: true }) so the
      // multi-select / shift-click path isn't silently dropped.
      changeSeen = false;
      const out = origSelect(name, ...rest);
      setTimeout(() => {
        if (om.activeName === name && !changeSeen) {
          store.observe({ kind: 'pattern', pattern: 'select-without-change',
            detail: `select('${name}') did not emit 'change'` });
        }
      }, 0);
      return out;
    };
  }

  // ── Pattern detector: material property written, viewport unchanged ──
  // Periodically audit every registered Object3D. If a mesh's material has
  // a `.map` set but the material class can't sample maps, emit the signal.
  // This catches the "upload texture onto ShaderMaterial / NormalMaterial"
  // failure mode the same minute the user makes it.
  const TEXTURE_CAPABLE = new Set([
    'MeshStandardMaterial', 'MeshPhysicalMaterial',
    'MeshBasicMaterial',    'MeshLambertMaterial',
    'MeshPhongMaterial',    'MeshToonMaterial',
    'MeshMatcapMaterial',   'SpriteMaterial', 'PointsMaterial',
  ]);
  const seenMismatch = new Set();
  const audit = () => {
    const om = ui.objectManager;
    if (!om?.getNames) return;
    om.getNames().forEach(n => {
      const o = om.getObject(n);
      const mat = o?.material;
      if (!mat?.map) return;
      if (TEXTURE_CAPABLE.has(mat.type)) return;
      const key = `${n}:${mat.type}`;
      if (seenMismatch.has(key)) return;
      seenMismatch.add(key);
      store.observe({
        kind: 'pattern', pattern: 'material-prop-no-effect',
        detail: `"${n}" has material.map set, but ${mat.type} doesn't sample .map. ` +
                `Promote to MeshStandardMaterial (or another texture-capable type) ` +
                `before assigning the texture.`,
        file: 'contextual.js',
        objectName: n, materialType: mat.type,
      });
    });
  };
  // Cheap: run twice a second. Detector is debounced via the seenMismatch set.
  const auditTimer = setInterval(audit, 500);

  // ── Pattern detector: silent control ──
  // Wrap every onChange/onInput handler attached to inputs inside the panel,
  // snapshot a small set of likely-target properties on the active object,
  // and emit a 'silent-control' signal if the value didn't change post-fire.
  // Detection runs only on the next tick so async handlers (texture loads,
  // material rebuilds) get a chance to settle.
  function snapshotActive() {
    const om = ui.objectManager;
    const n = om?.activeName;
    const o = n ? om.getObject(n) : null;
    if (!o) return null;
    const keys = ['x', 'y', 'rotation', 'radius', 'width', 'height',
                  'opacity', 'visible'];
    const snap = {};
    for (const k of keys) if (typeof o[k] === 'number' || typeof o[k] === 'boolean') snap[k] = o[k];
    if (o.position) snap.position = `${o.position.x},${o.position.y},${o.position.z}`;
    if (o.material?.color) snap.color = o.material.color.getHexString?.();
    if (o.material?.map) snap.map = o.material.map.uuid;
    return snap;
  }
  if (ui.panel?.element) {
    ui.panel.element.addEventListener('change', (e) => {
      if (!e.target.matches?.('input,select,textarea')) return;
      const before = snapshotActive();
      setTimeout(() => {
        const after = snapshotActive();
        if (!before || !after) return;
        const changed = Object.keys({ ...before, ...after }).some(k => before[k] !== after[k]);
        if (!changed) {
          store.observe({ kind: 'pattern', pattern: 'silent-control',
            detail: `Input "${e.target.dataset?.prop || e.target.name || e.target.type}" ` +
                    `fired but no observable property on the selected object changed.` });
        }
      }, 80);
    }, true);
  }

  // ── Ambient: no inspector folder ──
  // The store collects errors + pattern signals silently and auto-applies
  // any fix whose `find` anchor still matches the live source. The user
  // never has to click anything; the panel stays uncluttered.
  // Proposals remain accessible at `ui._learning.proposals` for any tool
  // or AI agent that wants to inspect or gate on them.
  store.on(async (s) => {
    // Auto-apply the freshest proposal opportunistically. We dedupe by id
    // so the same fix never tries twice in a session. Apply failures
    // (find string already replaced, network blip) are silent — the
    // proposal stays in the queue and the next observe() fires another
    // attempt only on a fresh pattern hit.
    const next = s.proposals.find(p => !s._autoTried?.has(p.id));
    if (!next) return;
    (s._autoTried = s._autoTried || new Set()).add(next.id);
    try {
      const result = await s.apply(next);
      if (result?.ok) {
        // Soft confirmation so the user knows the tool fixed itself.
        // Reload is required for the patched file to load; we leave that
        // to the user so we don't yank state out from under them.
        if (typeof showToast === 'function') {
          showToast(`Auto-fix applied to ${next.file} — reload to load`, { icon: icons.sparkle, duration: 2800 });
        }
      }
    } catch (e) { log.debug('learning', 'callback failed:', e); }
  });

  store.dispose = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    clearInterval(auditTimer);
  };
  return store;
}
