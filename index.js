/**
 * Ghost Panel — drop-in floating control panels for WebGL / Three.js / 2D scenes.
 *
 * Quick start:
 *
 *   import { createGhostPanel } from './lib/ghost-panel/index.js';
 *
 *   // Pure 2D / framework-agnostic mode
 *   const ui = createGhostPanel({ title: 'My Tool' });
 *   ui.addFolder('Settings')
 *     .addSlider('Speed', { min: 0, max: 10, value: 1, onChange: v => obj.speed = v })
 *     .addColor('Tint',   { value: '#fff', onChange: c => obj.tint = c })
 *     .addButton('Reset', () => obj.reset());
 *   ui.bindToggleKey('D', { shift: true });
 *
 *   // Three.js mode — pass scene/camera/renderer/controls and you get a
 *   // gizmo-driven object manager + a left "Scene" panel automatically.
 *   const ui = createGhostPanel({
 *     scene, camera, renderer, controls,
 *     scenePanel: true,
 *   });
 *   ui.objectManager.register('myMesh', mesh);
 *
 * The full API is on the returned object — see README.md for details.
 */
import { injectStyles } from './styles.js';
import { initTooltips } from './tooltip.js';
import { Panel, applyGlobalTheme } from './panel.js';
import {
  SceneObjectManager, addSceneObjectsFolder, addCameraFolder, autoRegisterScene,
} from './three-extensions.js';
import { ObjectManager } from './object-manager.js';
import { createGizmoSystem } from './gizmos.js';
import { attachContextualInspector } from './contextual.js';
import { ModalTransform, Modal2DTransform } from './modal-transform.js';
import { Gizmo2D } from './gizmo-2d.js';
import { UndoStack } from './undo-stack.js';
import { showToast } from './toast.js';
import { icons } from './icons.js';
import { attachLearning } from './learning.js';
import { attachDiagnostics } from './diagnostics.js';
import { attachAugment } from './augment.js';
import { attachCanvasContextMenu } from './context-menu.js';
import { ExportMenu } from './export-menu.js';
import { AddObjectMenu } from './add-menu.js';
import { scanAndRegister } from './project-scanner.js';
import { attachSkillsAPI, globalRegistry as skillsRegistry } from './skills.js';
import {
  WORKFLOWS, detectWorkflow, detectWorkflows,
  applyWorkflow, enableWorkflow, disableWorkflow,
  getActiveWorkflows, scanAndApply, listWorkflows,
} from './workflows.js';
import { getAvailableExporters, runExport, registerExporter } from './exports.js';

// ── Clipboard helpers (used by Cmd+C / Cmd+V in the keydown handler) ──
// Returns a serializable snapshot of the object plus a "kind" tag so paste
// knows how to rehydrate it. For 2D plain bags we deep-clone the data; for
// Three.js Object3Ds we keep a reference and rely on `.clone()` at paste.
function cloneForClipboard(obj, name) {
  // Three.js detection: prefer its built-in clone over a structural copy so
  // geometry / material / userData propagate correctly.
  if (obj && typeof obj.clone === 'function' && obj.isObject3D) {
    return { kind: 'three', name, source: obj };
  }
  // Web adapter: wraps a live DOM node + getter/setter accessors, neither
  // of which survives structuredClone (it throws on the element) or a
  // spread (which flattens the accessors into dead values and shares the
  // SAME _el). Defer to the adapter's own DOM-aware clone at paste time.
  if (obj && obj._isWebAdapter && typeof obj._cloneAdapter === 'function') {
    return { kind: 'web', name, source: obj };
  }
  // Plain data object: structuredClone handles nested arrays/objects safely.
  try {
    return { kind: 'plain', name, data: structuredClone(obj) };
  } catch {
    // Fallback for non-cloneable values (functions, DOM nodes, etc.)
    return { kind: 'plain', name, data: { ...obj } };
  }
}

function pasteFromClipboard(ui, clip) {
  const om = ui.objectManager;
  if (!om) return null;
  const newName = uniqueName(om, clip.name);
  let newObj;
  if (clip.kind === 'three') {
    // Three.js Object3D.clone() deep-copies userData via JSON.parse/stringify,
    // which blows up if userData contains a back-reference (e.g. an
    // AnimationMixer whose `_root` points to the source). Stash non-cloneable
    // entries on every descendant, clone, then restore on the source.
    const stash = [];
    clip.source.traverse(node => {
      if (node.userData && (node.userData.mixer || node.userData.__mixerWasPlaying !== undefined)) {
        stash.push([node, node.userData]);
        const safe = { ...node.userData };
        delete safe.mixer;
        delete safe.__mixerWasPlaying;
        node.userData = safe;
      }
    });
    try {
      newObj = clip.source.clone(true);
    } finally {
      stash.forEach(([node, original]) => { node.userData = original; });
    }
    // Mesh.clone() copies the object hierarchy but SHARES geometry + material
    // references with the source. Because SceneObjectManager.remove() disposes
    // geometry/materials, deleting this copy later would free resources the
    // original is still rendering with (GPU re-upload churn at best, a vanished
    // original mesh at worst). Give the copy its own geometry/material clones so
    // the two are fully independent. Textures stay shared — that's safe, since
    // remove() disposes materials but not their textures.
    newObj.traverse(node => {
      if (node.geometry && typeof node.geometry.clone === 'function') {
        node.geometry = node.geometry.clone();
      }
      const mat = node.material;
      if (Array.isArray(mat)) {
        node.material = mat.map(m => (m && typeof m.clone === 'function') ? m.clone() : m);
      } else if (mat && typeof mat.clone === 'function') {
        node.material = mat.clone();
      }
    });
    if ('name' in newObj) newObj.name = newName;
    // Add to the scene tree if the source had a parent (otherwise leave it
    // floating — host code can place it explicitly via the AddObjectMenu API).
    if (clip.source.parent) clip.source.parent.add(newObj);
    if (newObj.position) newObj.position.x += 0.5;  // small offset so it's visible
  } else if (clip.kind === 'web') {
    // The adapter builds a fresh DOM node + accessor set for us and mounts
    // it in the source's parent. Offset so the copy isn't pixel-perfectly
    // hidden behind the original.
    newObj = clip.source._cloneAdapter(newName);
    if (typeof newObj.x === 'number') newObj.x += 24;
    if (typeof newObj.y === 'number') newObj.y += 24;
  } else {
    newObj = (typeof structuredClone === 'function')
      ? structuredClone(clip.data)
      : { ...clip.data };
    if ('name' in newObj) newObj.name = newName;
    // Nudge 2D objects so the paste isn't hidden behind the original.
    if (typeof newObj.x === 'number') newObj.x += 24;
    if (typeof newObj.y === 'number') newObj.y += 24;
  }
  // Register through the undo-aware path so Cmd+Z removes the paste cleanly.
  om.register(newName, newObj);
  ui._undo?.push({
    label: `paste ${newName}`,
    undo: () => { ui._undo._suppress = true; try { om.remove(newName); } finally { ui._undo._suppress = false; } },
    redo: () => { ui._undo._suppress = true; try { om.register(newName, newObj); } finally { ui._undo._suppress = false; } },
  });
  om.select?.(newName);
  return { name: newName, object: newObj };
}

/**
 * Auto-register the host's main rendering camera with the object
 * manager if it isn't already known. Without this, a host project
 * that calls `createGhostPanel({ scene, camera, ... })` never sees its
 * own camera in the outliner — so there's no row to host a focus
 * button, and the user can't toggle "look through this camera".
 *
 * We only register if the manager has no camera entry yet (so projects
 * that explicitly registered the camera under their own name still
 * win) and only if the camera isn't already in the entry map.
 */
function registerMainCameraIfMissing(om, camera) {
  if (!om || !camera || !camera.isCamera) return;
  if (typeof om.registerCamera !== 'function') return;
  // Already registered? Skip — either explicitly by the host, or by a
  // prior pass of this same helper / autoRegisterScene.
  for (const name of om.getNames?.() || []) {
    const e = om.objects?.[name];
    if (!e) continue;
    if (e.object === camera || e.cameraRef === camera) return;
  }
  const desired = (camera.name || '').trim() || 'Camera';
  let name = desired;
  for (let i = 1; om.has?.(name); i++) name = `${desired}.${String(i).padStart(2, '0')}`;
  om.registerCamera(name, camera);
}

function uniqueName(om, baseName) {
  if (!om.has(baseName)) return baseName;
  // Strip any trailing " copy" / " copy N" so successive pastes stay tidy.
  const root = baseName.replace(/ copy(?: \d+)?$/, '');
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? `${root} copy` : `${root} copy ${i}`;
    if (!om.has(candidate)) return candidate;
  }
  return `${root} copy ${Date.now()}`;
}

export function createGhostPanel(opts = {}) {
  const {
    title = 'Ghost Panel',
    width,
    visible = false,
    // Theming
    theme,       // 'zinc' (default) | 'light'
    themeVars,   // object of CSS variable overrides (HSL components, e.g. { '--primary': '142 76% 36%' })
    liquidGlass = false,           // true | 'light' — apply Apple Liquid Glass styling
    liquidGlassScenePanel = false, // same for the scene panel
    saveLoad = true,               // show save/load buttons in this panel's header
    workflow,                      // '3d' | 'animation' | 'shader' | 'ascii' | '2d' | 'audio' | 'auto' | null
    workflowOpts = {},             // options forwarded to the workflow setup function
    workflowPicker = true,         // show a workflow dropdown at the top of the main panel
    // Three.js mode (optional)
    scene, camera, renderer, controls,
    // Built-in TransformControls gizmo controls (Three.js mode):
    //   gizmo: false              → never attach the built-in gizmo (host runs its own rig)
    //   onDraggingChanged(active) → fired on gizmo drag start/stop, so hosts that
    //                               withhold `controls` can still pause their camera
    //   beforeGizmoAttach(obj)    → return false to skip the gizmo for that object
    gizmo = true,
    onDraggingChanged,
    beforeGizmoAttach,
    // Scene panel — defaults to true so every host gets the canonical
    // "Outliner on the left, Inspector on the right" layout out of the
    // box. Hosts can pass `scenePanel: false` to opt out (e.g. tiny
    // utility panels that don't need an outliner).
    scenePanel = true,
    scenePanelTitle = 'Scene',
  } = opts;

  injectStyles();
  initTooltips();

  // ── Locked layout ──
  // Scene panel ALWAYS sits on the left. Inspector / properties panel
  // ALWAYS sits on the right. The legacy `side` option is intentionally
  // ignored — hosts kept getting backwards layouts when they passed
  // `side: 'left'` thinking it would move the inspector, while the
  // scene panel auto-swapped underneath and confused everyone. If only
  // ONE panel is shown (scenePanel: false), it stays on the right.
  const panel = new Panel({
    title,
    side: 'right',
    width, visible, theme, themeVars,
  });
  if (liquidGlass) {
    panel.setLiquidGlass(true, { variant: liquidGlass === 'light' ? 'light' : undefined });
  }

  let leftPanel = null;
  if (scenePanel) {
    leftPanel = new Panel({
      title: scenePanelTitle,
      side: 'left',
      width: 260, visible, theme, themeVars,
    });
    if (liquidGlassScenePanel) {
      leftPanel.setLiquidGlass(true, { variant: liquidGlassScenePanel === 'light' ? 'light' : undefined });
    }
  }

  // Seed the global theme once, after both panels exist: mirror the resolved
  // starting theme onto :root (so body-appended surfaces start correct) and
  // bring both panels into agreement. From here on, the header toggle on EITHER
  // panel calls applyGlobalTheme and the whole UI moves together.
  applyGlobalTheme(theme || 'zinc');

  // Object manager — Three.js variant when a scene is provided, otherwise
  // a lightweight generic registry. Either way the Outliner gets the same
  // duck-typed surface and shows up in every workflow.
  let objectManager = null;
  let cameraFolder = null;
  let sceneObjectsView = null;
  let gizmos = null;
  if (scene && camera && renderer) {
    objectManager = new SceneObjectManager({ scene, camera, renderer, controls });
    // Host-configurable gizmo behavior (see opts above).
    objectManager._gizmoDisabled = gizmo === false;
    if (typeof onDraggingChanged === 'function') objectManager._onDraggingChanged = onDraggingChanged;
    if (typeof beforeGizmoAttach === 'function') objectManager._beforeGizmoAttach = beforeGizmoAttach;
    gizmos = createGizmoSystem(scene, camera, renderer, controls);
  } else {
    objectManager = new ObjectManager();
  }
  // Outliner goes on the scene panel — it's the persistent navigator,
  // not workflow-specific. Camera params live in the workflow's setup
  // (3D workflow) so they're consolidated with other 3D-specific tools.
  if (leftPanel) {
    sceneObjectsView = addSceneObjectsFolder(leftPanel, objectManager);
  }
  // Main camera registration runs UNCONDITIONALLY (even when the host
  // opts out of full-scene auto-registration via `autoRegister: false`).
  // The bulk autoRegister flag exists so projects with TransformControls,
  // helpers, or other gizmo internals in their scene don't have those
  // polluting the outliner — but the host's main rendering camera is a
  // single, known-good object that always belongs there. Without this
  // the user has no row to host the "look through this camera" focus
  // button for their primary viewpoint.
  if (objectManager && camera) {
    queueMicrotask(() => registerMainCameraIfMissing(objectManager, camera));
    requestAnimationFrame(() => registerMainCameraIfMissing(objectManager, camera));
  }
  // Zero-config full-scene scan: walk the scene and surface its meshes /
  // lights / cameras automatically. Manually-registered nodes take
  // priority — autoRegisterScene skips them.
  if (scene && objectManager && opts.autoRegister !== false) {
    queueMicrotask(() => autoRegisterScene(objectManager, scene));
    requestAnimationFrame(() => autoRegisterScene(objectManager, scene));
  }

  // Contextual inspector — gets wired up *after* the UI handle exists so
  // it can reference ui.panel and ui.objectManager. Adds:
  //   • Mode toolbar pinned to the Inspector's left edge (appears on selection)
  //   • Material folder auto-added when a mesh is selected
  // (Initialized at the bottom of this function, once `ui` is defined.)

  // ── Save / Load — always available via header buttons ──
  // Downloads current state as JSON; opens file picker to restore.
  function downloadJSON(filename) {
    const data = toJSON();
    const name = filename || `ghost-panel-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function loadJSONFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          fromJSON(data);
        } catch (err) {
          console.error('[Ghost Panel] Failed to parse JSON:', err);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // Hide save/load on scene panel always (state lives on the main panel).
  if (leftPanel) {
    leftPanel.setSaveLoadHandlers({ save: null, load: null });
  }
  // Main-panel save/load is wired AFTER `ui` is defined (below) so the
  // ExportMenu can reference live ui state (active workflows, scene, etc.).

  // Bind a keyboard shortcut for toggling visibility.
  function bindToggleKey(key, mods = {}) {
    const { shift = false, ctrl = false, meta = false, alt = false } = mods;
    // We accept the configured modifier combo AND, as a convenience, also
    // fire on Cmd+<key> (Mac) / Ctrl+<key> (Windows / Linux). Cmd+D would
    // otherwise pop the browser's bookmark dialog — preventDefault stops
    // that. This makes the canonical "Toggle UI" gesture work without the
    // user remembering which modifier the demo wired up.
    window.addEventListener('keydown', (e) => {
      if (e.key !== key && e.key.toUpperCase() !== key.toUpperCase()) return;
      const exact =
        !!e.shiftKey === !!shift && !!e.ctrlKey === !!ctrl &&
        !!e.metaKey === !!meta   && !!e.altKey === !!alt;
      const cmdAccel =
        (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
      if (!exact && !cmdAccel) return;
      e.preventDefault();
      panel.toggle();
      if (leftPanel) {
        if (panel.isVisible()) leftPanel.show();
        else leftPanel.hide();
      }
    });
  }

  function update() {
    // Called from the user's render loop. Syncs UI with live scene state.
    if (cameraFolder && panel.isVisible()) cameraFolder.update();
    syncFolderVisibility();
  }
  function syncFolderVisibility() {
    [panel, leftPanel].filter(Boolean).forEach(p => {
      Object.values(p.folders).forEach(f => f.syncVisibility?.());
    });
  }
  // Re-run gating whenever selection changes so non-render-loop hosts (e.g.
  // 2D / web demos that only paint per-frame, not per-tick of update) still
  // get accurate folder visibility after selection.
  if (objectManager?.on) objectManager.on('change', syncFolderVisibility);

  /** Snapshot all control values + registered objects to a plain object. */
  function toJSON() {
    // Float hygiene: snap denormals / near-zero to 0 and trim float noise so
    // exports diff cleanly and stay hand-editable (§4.4).
    const clean = (v) => {
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return v;
        if (Math.abs(v) < 1e-9) return 0;
        return Number(v.toPrecision(7));
      }
      if (Array.isArray(v)) return v.map(clean);
      if (v && typeof v === 'object') {
        const o = {};
        for (const k in v) o[k] = clean(v[k]);
        return o;
      }
      return v;
    };
    const data = { panels: {}, objects: {} };
    [panel, leftPanel].filter(Boolean).forEach(p => {
      const panelData = {};
      Object.entries(p.folders).forEach(([fname, folder]) => {
        // Skip selection-contextual / transient folders (Material, Camera
        // Settings, light folders, …) so exports are stable across sessions
        // regardless of what happened to be selected at export time (§4.2).
        if (folder._transient) return;
        const folderData = {};
        Object.entries(folder.controls).forEach(([cname, ctrl]) => {
          if (ctrl.getValue) folderData[cname] = clean(ctrl.getValue());
        });
        // Skip empty (action-only) folders — "Move selection": {} etc. (§4.3).
        if (Object.keys(folderData).length) panelData[fname] = folderData;
      });
      data.panels[p.title] = panelData;
    });
    if (objectManager) {
      objectManager.getNames().forEach(n => {
        // Skip host-internal pseudo-objects (e.g. a gizmo-pivot 'Selection')
        // tagged __duiIgnore — they aren't part of the authored scene (§4.3).
        const obj = objectManager.getObject?.(n);
        if (obj?.userData?.__duiIgnore) return;
        data.objects[n] = clean(objectManager.getState(n));
      });
    }
    return data;
  }

  /** Restore from a snapshot produced by toJSON(). */
  function fromJSON(data) {
    if (!data) return;
    if (data.panels) {
      [panel, leftPanel].filter(Boolean).forEach(p => {
        const panelData = data.panels[p.title];
        if (!panelData) return;
        Object.entries(panelData).forEach(([fname, folderData]) => {
          const folder = p.folders[fname];
          if (!folder) return;
          Object.entries(folderData).forEach(([cname, val]) => {
            const ctrl = folder.controls[cname];
            if (ctrl && ctrl.setValue) ctrl.setValue(val);
          });
        });
      });
    }
    if (data.objects && objectManager) {
      Object.entries(data.objects).forEach(([n, state]) => {
        objectManager.applyState(n, state);
      });
    }
  }

  const ui = {
    // Panels
    panel,
    scenePanel: leftPanel,
    // Add controls directly to the main panel
    addFolder: (name, opts) => panel.addFolder(name, opts),
    getFolder: (name) => panel.getFolder(name),
    // Visibility
    show: () => { panel.show(); leftPanel?.show(); },
    hide: () => { panel.hide(); leftPanel?.hide(); },
    toggle: () => { panel.toggle(); if (leftPanel) (panel.isVisible() ? leftPanel.show() : leftPanel.hide()); },
    isVisible: () => panel.isVisible(),
    bindToggleKey,
    // Three.js (only set when scene/camera/renderer provided)
    objectManager,
    gizmos,
    refreshSceneObjects: () => sceneObjectsView?.refresh(),
    // Workflow system — multiple workflows can be active at once
    applyWorkflow(name, wOpts) { return applyWorkflow(ui, name, wOpts); }, // legacy: switch to single
    enableWorkflow(name, wOpts) { return enableWorkflow(ui, name, wOpts); },
    disableWorkflow(name) { return disableWorkflow(ui, name); },
    scanAndApply(extraOpts, scanOpts) {
      return scanAndApply(ui, { ...opts, ...(extraOpts || {}) }, scanOpts);
    },
    listWorkflows,
    get activeWorkflow() { return ui._activeWorkflow; },             // legacy: first active
    get activeWorkflows() { return getActiveWorkflows(ui); },        // multi: array
    detectWorkflows(extra) { return detectWorkflows({ ...opts, ...(extra || {}) }); },
    // Internal refs for workflow setup functions
    _camera: camera,
    _controls: controls,
    // Loop integration
    update,
    // Serialization
    toJSON,
    fromJSON,
    /** Download the current UI state as a JSON file. */
    downloadJSON,
    /** Open a file picker and load a previously-saved JSON. */
    loadJSONFile,
    // Cleanup
    dispose: () => {
      panel.dispose();
      leftPanel?.dispose();
      objectManager?.dispose();
    },
  };

  // Back-link so callers buried inside the outliner / contextual layer
  // (which were built before `ui` existed) can reach `ui._undo`,
  // `ui.objectManager`, etc. without taking a circular dep on this file.
  if (objectManager) objectManager._ui = ui;

  // ── Ambient workflow detection — runs once on init, then continuously ──
  // The user never has to pick a workflow. We watch the scene/options and
  // enable/disable workflows automatically as the project evolves.
  //
  // Manual override is still possible via `workflow: [...]` (skips auto-detect).
  const useAutoDetect = workflow === undefined || workflow === 'auto';
  if (!useAutoDetect) {
    const initial = Array.isArray(workflow) ? workflow : [workflow];
    initial.filter(n => WORKFLOWS[n]).forEach(n => enableWorkflow(ui, n, workflowOpts));
  }

  // No status chrome by default — auto-detection means the tools just appear.
  // The only visible signal is the tools themselves. We do offer an opt-in
  // manual picker (`workflowPicker: 'manual'`) for cases where the user
  // explicitly wants checkbox control over which workflows are active.
  let statusFolder = null, detectedInfo = null;
  if (workflowPicker === 'manual') {
    statusFolder = panel.addFolder('Workflows', { collapsed: true });
    detectedInfo = statusFolder.addInfo('', 'detected');
    const wfCheckboxes = {};
    listWorkflows().forEach(w => {
      statusFolder.addCheckbox(w.label, {
        id: `wf-${w.id}`,
        value: ui._activeWorkflows?.has(w.id) ?? false,
        tooltip: w.description,
        onChange: (on) => {
          if (on) enableWorkflow(ui, w.id, workflowOpts);
          else disableWorkflow(ui, w.id);
          syncStatus();
        },
      });
      wfCheckboxes[w.id] = statusFolder.get(`wf-${w.id}`);
    });
    ui._wfCheckboxes = wfCheckboxes;
    panel.body.insertBefore(statusFolder.element, panel.body.firstChild);
  }

  function syncStatus() {
    const active = getActiveWorkflows(ui);
    if (detectedInfo) {
      detectedInfo.setText(active.length ? `Active: ${active.join(' · ')}` : '');
    }
    if (ui._wfCheckboxes) {
      Object.entries(ui._wfCheckboxes).forEach(([id, ctrl]) => {
        ctrl.setValue(ui._activeWorkflows?.has(id) ?? false);
      });
    }
  }

  // ── Run detection now, then keep watching ──
  function detectAndSync() {
    // Pass the object manager into detectWorkflows so it can sniff
    // animation arrays the host parked on entry metadata (Brick Phone
    // Landing's `{ group, gltf }` shape is one example — the gltf
    // animations don't live anywhere reachable via scene.traverse).
    if (!useAutoDetect) return;
    const detected = detectWorkflows({
      ...opts,
      // Pass the user's host-side object manager (separate from
      // Ghost Panel's internal manager) AND Ghost Panel's own so animations
      // stored on either layer's entries can be discovered.
      objectManager: opts.objectManager || objectManager,
    });
    // Enable newly-detected workflows
    detected.forEach(name => {
      if (!ui._activeWorkflows?.has(name)) enableWorkflow(ui, name, workflowOpts);
    });
    // Disable workflows that are no longer detected (only the ones WE enabled)
    [...(ui._activeWorkflows || [])].forEach(name => {
      if (!detected.includes(name) && ui._autoEnabled?.has(name)) {
        disableWorkflow(ui, name);
      }
    });
    ui._autoEnabled = new Set(detected);
    syncStatus();
  }

  // Initial scan
  detectAndSync();

  // ── Contextual inspector (mode toolbar + material on selection) ──
  // Now that `ui` exists with objectManager, attach the contextual layer.
  if (objectManager) {
    ui._contextualInspector = attachContextualInspector(ui);
  }

  // ── Modal transform — Blender-style G/R/S + X/Y/Z keyboard shortcuts ──
  // Mouse position drives the value; click to commit, Esc to cancel.
  if (scene && camera && renderer && objectManager) {
    ui._modalTransform = new ModalTransform({
      scene, camera, renderer, controls, objectManager,
    });

    ui._scene = scene;  // referenced by AddObjectMenu when present
    // Stash the host's autoRegister opt-out so late-binding code (e.g.
    // AddObjectMenu.open's re-scan path) can respect it. `undefined` is
    // treated as the default (allow auto-register).
    ui._autoRegister = opts.autoRegister !== false;
  } else if (objectManager) {
    // 2D-only host (Canvas2D, SVG, DOM, ASCII grid, …). The same G/R/S
    // hotkeys operate on plain { x, y, rotation?, radius?, width?, height? }
    // objects. The contextual toolbar buttons also dispatch through this.
    const canvas2D = opts.canvas
      || (typeof document !== 'undefined' ? document.querySelector('canvas') : null);
    if (canvas2D) {
      ui._modal2DTransform = new Modal2DTransform({ canvas: canvas2D, objectManager });
    }
    // Drag-handle gizmo — the 2D / web counterpart of Three.js TransformControls.
    ui._gizmo2D = new Gizmo2D(ui);
    objectManager.on?.('change', () => {
      const name = objectManager.activeName;
      const obj = name ? objectManager.getObject(name) : null;
      ui._gizmo2D.setTarget(obj);
    });
  }

  // ── Undo / redo — workflow-agnostic stack with Cmd+Z / Cmd+Shift+Z ──
  // Surfaces (mini toolbar, modal transform, outliner delete, graph editor)
  // push inverse-command pairs as the user mutates state. The shortcut is
  // suppressed inside form fields so native browser undo still works there.
  ui._undo = new UndoStack();
  // Folders walk back through panel.ui._undo to auto-wrap every value
  // control with snapshot-based undo. Without this back-link, hosts
  // would have to wrap every onChange themselves (and silently miss
  // any control they forgot — that's how regressions happen).
  panel.ui = ui;
  if (leftPanel) leftPanel.ui = ui;
  if (ui._modalTransform)   ui._modalTransform.undoStack   = ui._undo;
  if (ui._modal2DTransform) ui._modal2DTransform.undoStack = ui._undo;
  // Outliner × delete → push a command that re-registers / re-removes.
  if (objectManager?.on) {
    objectManager.on('remove', (name, object) => {
      if (ui._undo._suppress) return;  // suppress while replaying
      ui._undo.push({
        label: `delete ${name}`,
        undo: () => {
          ui._undo._suppress = true;
          try { objectManager.register(name, object); } finally { ui._undo._suppress = false; }
        },
        redo: () => {
          ui._undo._suppress = true;
          try { objectManager.remove(name); } finally { ui._undo._suppress = false; }
        },
      });
    });
  }
  // Programmatic clipboard API — same flow the Cmd+C / Cmd+V keys take.
  // Exposed so the outliner right-click menu (and any host UI) can copy
  // or paste without synthesizing a keyboard event.
  ui._copy = (name) => {
    if (!objectManager) return null;
    const target = name || objectManager.activeName;
    const obj = target ? objectManager.getObject(target) : null;
    if (!obj) return null;
    ui._clipboard = cloneForClipboard(obj, target);
    showToast(`Copied ${target}`, { icon: '⌘C' });
    return ui._clipboard;
  };
  ui._paste = () => {
    if (!objectManager || !ui._clipboard) return null;
    const pasted = pasteFromClipboard(ui, ui._clipboard);
    if (pasted) showToast(`Pasted ${pasted.name}`, { icon: '⌘V' });
    return pasted;
  };
  ui._duplicate = (name) => {
    // Duplicate is copy + paste in one shot, NOT persisting the clipboard
    // beyond the operation (so the user's previous clipboard isn't clobbered).
    const target = name || objectManager?.activeName;
    if (!objectManager || !target) return null;
    const obj = objectManager.getObject(target);
    if (!obj) return null;
    const savedClipboard = ui._clipboard;
    ui._clipboard = cloneForClipboard(obj, target);
    const pasted = pasteFromClipboard(ui, ui._clipboard);
    ui._clipboard = savedClipboard;     // restore — don't poison existing copy
    if (pasted) showToast(`Duplicated ${target}`, { icon: '⌘D' });
    return pasted;
  };

  /**
   * Group the named (or currently multi-selected) objects under a new
   * THREE.Group parent. Children keep their world transform via
   * `Group.attach(child)` (which compensates for the group's own
   * transform, defaulted to identity at the centroid of children).
   * Returns the new group's registered name, or null on no-op.
   */
  ui._group = (names) => {
    const om = objectManager;
    const THREE = scene?.constructor ? null : null;   // dynamic three import below
    if (!om || !scene) return null;
    const list = (names && names.length ? names : om.getSelectedNames?.() || [])
      .filter(n => om.getObject(n));
    if (list.length < 2) return null;
    // We assume THREE is on the host's scene constructor lineage. Use
    // the prototype chain to discover the Group + Vector3 constructors
    // without an import (the scene was created from the same THREE).
    const Group = scene?.parent?.constructor || null;
    // Simpler: use a runtime import — fine because this only fires on
    // user action, not on every render.
    return Promise.resolve().then(async () => {
      const THREE = await import('three');
      const group = new THREE.Group();
      group.name = uniqueGroupName(om);
      // Centroid of children → place the group origin there so its
      // gizmo lands where the user expects.
      const c = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      let n = 0;
      for (const childName of list) {
        const childObj = om.getObject(childName);
        if (!childObj?.isObject3D) continue;
        childObj.getWorldPosition(tmp); c.add(tmp); n++;
      }
      if (n) c.divideScalar(n);
      group.position.copy(c);
      scene.add(group);
      // Reparent each child into the group, preserving world transform.
      // `group.attach(child)` is the Three.js helper that does this
      // (vs `group.add(child)` which would visually jump the child).
      const moves = [];
      for (const childName of list) {
        const childObj = om.getObject(childName);
        if (!childObj?.isObject3D) continue;
        const prevParent = childObj.parent;
        group.attach(childObj);
        moves.push({ child: childObj, prevParent });
      }
      // Register the new group + select it. The mini transform toolbar
      // already binds to whatever's selected, so move/rotate/scale just
      // work after this.
      om.register(group.name, group);
      om.select(group.name);
      // Push undo: undo reparents children back to their previous
      // parents (preserving world transform via attach), removes the
      // group from the scene + manager. Redo re-creates the group.
      ui._undo?.push({
        label: `Group ${list.join(', ')}`,
        undo: () => {
          ui._undo._suppress = true;
          try {
            for (const { child, prevParent } of moves) {
              if (prevParent) prevParent.attach(child); else scene.attach(child);
            }
            om.remove(group.name);
            scene.remove(group);
            om.select(list[list.length - 1]);
          } finally { ui._undo._suppress = false; }
        },
        redo: () => {
          ui._undo._suppress = true;
          try {
            scene.add(group);
            for (const { child } of moves) group.attach(child);
            om.register(group.name, group);
            om.select(group.name);
          } finally { ui._undo._suppress = false; }
        },
      });
      showToast(`Grouped ${list.length} objects`, { icon: '⌘G' });
      ui.refreshSceneObjects?.();
      return group.name;
    });
  };

  /**
   * Inverse of group — lifts every direct child of the named group
   * back to the scene, removes the group itself. World transforms are
   * preserved via `parent.attach(child)`.
   */
  ui._ungroup = (name) => {
    const om = objectManager;
    if (!om || !scene) return null;
    const groupObj = om.getObject(name);
    if (!groupObj?.isGroup && groupObj?.type !== 'Group') return null;
    const moved = [];
    for (const child of [...groupObj.children]) {
      const prevParent = groupObj;
      scene.attach(child);
      moved.push({ child, prevParent });
    }
    om.remove(name);
    scene.remove(groupObj);
    ui._undo?.push({
      label: `Ungroup ${name}`,
      undo: () => {
        ui._undo._suppress = true;
        try {
          scene.add(groupObj);
          for (const { child } of moved) groupObj.attach(child);
          om.register(name, groupObj);
          om.select(name);
        } finally { ui._undo._suppress = false; }
      },
      redo: () => {
        ui._undo._suppress = true;
        try {
          for (const { child } of moved) scene.attach(child);
          om.remove(name);
          scene.remove(groupObj);
        } finally { ui._undo._suppress = false; }
      },
    });
    showToast(`Ungrouped ${name}`, { icon: '⇧⌘G' });
    ui.refreshSceneObjects?.();
    return moved.map(m => m.child.name);
  };

  // Auto-name groups so the user can group repeatedly without conflicts.
  function uniqueGroupName(om) {
    const taken = (n) => !!om.objects?.[n];
    let i = 1;
    while (taken(`Group${i === 1 ? '' : ' ' + i}`)) i++;
    return `Group${i === 1 ? '' : ' ' + i}`;
  }

  ui._undoKeyHandler = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (ui._undo.undo()) showToast('Undo', { icon: icons.undo });
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      if (ui._undo.redo()) showToast('Redo', { icon: icons.redo });
    } else if (key === 'c') {
      // Copy the active object — deep-clones plain 2D bag-of-numbers shapes.
      // For Three.js Object3Ds, defers to obj.clone() so meshes / lights /
      // groups all round-trip without manual schema knowledge.
      e.preventDefault();
      ui._copy();
    } else if (key === 'v') {
      e.preventDefault();
      ui._paste();
    } else if (key === 'd' && !e.shiftKey) {
      // Cmd+D = Duplicate (figma / sketch convention)
      e.preventDefault();
      ui._duplicate();
    } else if (key === 'g' && !e.shiftKey) {
      // Cmd+G = Group selected (Illustrator / Figma convention)
      e.preventDefault();
      ui._group?.();
    } else if (key === 'g' && e.shiftKey) {
      // Shift+Cmd+G = Ungroup
      e.preventDefault();
      ui._ungroup?.(objectManager?.activeName);
    }
  };
  window.addEventListener('keydown', ui._undoKeyHandler);

  // ── Add-object popup (Shift+A) — global shortcut, workflow-aware menu ──
  // The menu is ALWAYS available (regardless of whether a Three.js scene is
  // attached). Its contents are filtered by the currently-active workflows
  // — 3D mesh/light/camera factories show in 3D mode; 2D / animation / audio
  // factories register themselves on workflow setup. Hosts can also call
  // `ui._addMenu.register({...})` to extend the menu with custom items.
  ui._addMenu = new AddObjectMenu(ui);

  // ── Auto-detect project context and seed the add menu ─────────
  // Run a light scan of the host page (DOM tags, recognizable CSS
  // class systems like Tailwind / shadcn, Three.js scene contents)
  // and register matching factories. This deferred queueMicrotask
  // gives the host a chance to register its own factories first —
  // those win on id collision, so user-customised projects keep
  // their explicit registrations.
  // rAF instead of queueMicrotask so stylesheets have applied, layout has
  // settled, and getBoundingClientRect() returns accurate values for the
  // DOM auto-registration path in scanAndRegister.
  requestAnimationFrame(() => {
    try { scanAndRegister(ui); } catch (e) { console.warn('[Ghost Panel] scanProject failed:', e); }
  });

  // ── Skills API — exposes a declarative catalog of capabilities ──
  // Built-in skills cover 3D, 2D, shader, animation, audio, ASCII workflows.
  // AI agents can introspect (`ui.skills.describe()`), suggest new tools
  // (`ui.skills.suggest()`), register custom skills (`ui.skills.register(...)`),
  // and mount/unmount them at runtime.
  attachSkillsAPI(ui, {
    scene, camera, renderer, controls,
    canvas2d: opts.canvas2d,
    audioContext: opts.audioContext || opts.audio,
    objectManager,
    workflows: ui.activeWorkflows,
    opts,
  });
  ui.skills.enablePersistence();

  // ── Canvas context menu (right-click) — 3D scene only ──
  if (scene && camera && renderer && objectManager) {
    ui._canvasContextMenu = attachCanvasContextMenu(ui);
  }

  // ── Learning store ──
  // Captures runtime errors + pattern signals, surfaces actionable fix
  // proposals in a "Learning" folder, and (when the Vite plugin is mounted)
  // writes the fix straight back to the source file. Self-strips in
  // production via `isDev()`.
  attachLearning(ui);

  // ── Context-aware export menu — wired AFTER ui exists ──
  // The download icon (↓) in the panel header now opens a popover listing
  // every deliverable relevant to the currently-active workflows. PNG/WebM
  // for 3D, GLB for meshes, keyframe JSON/CSS for animation, GLSL source for
  // shaders, etc. JSON snapshot is always available.
  if (saveLoad) {
    ui._exportMenu = new ExportMenu(ui);
    // Default: save button opens the export menu. The host can call
    // `panel.setSaveLoadHandlers({ save: fn })` later — instead of
    // replacing this behavior, we ROUTE their custom save through the
    // export menu as a dynamic exporter (see wrapper below). That way
    // the user always reaches the full deliverable catalog instead of
    // getting only the host's one-shot JSON download.
    panel.setSaveLoadHandlers({
      save: () => ui._exportMenu.open(panel._saveBtn),
      load: () => loadJSONFile(),
    });
    // Track the host's most recent custom save so we can offer it as
    // the FIRST item in the export menu (project-specific actions
    // win priority over generic exports).
    let _hostSaveExporter = null;
    const originalSet = panel.setSaveLoadHandlers.bind(panel);
    panel.setSaveLoadHandlers = (cfg = {}) => {
      const { save, load, replaceMenu, label } = cfg;
      // Host opted in to old replace-the-menu behavior — honor it.
      if (replaceMenu && typeof save === 'function') {
        originalSet({ save, load });
        return;
      }
      // Register the host's save as a project exporter the user picks
      // from the menu. Idempotent: re-calling replaces the previous
      // registration. The menu's open handler stays put.
      if (typeof save === 'function') {
        const id = '__host-save';
        const hostExp = {
          id,
          label: label || 'Project file (JSON)',
          description: 'Custom save action provided by this project',
          mime: 'application/json',
          extension: 'json',
          workflows: ['*'],
          isHostSave: true,
          async run(ui) {
            // The host's save() typically handles its own download +
            // filename. We invoke it directly; runExport awaits this
            // and skips the auto-download step when run returns null.
            await save();
            return null;
          },
        };
        // Drop any previous host save before re-registering.
        if (ui._exportMenu?._unregisterHostSave) ui._exportMenu._unregisterHostSave();
        const removed = ui._exportMenu?._registerHostSave?.(hostExp);
        _hostSaveExporter = hostExp;
      } else {
        ui._exportMenu?._unregisterHostSave?.();
        _hostSaveExporter = null;
      }
      // Keep save → open menu, load → host's load (or default).
      originalSet({
        save: () => ui._exportMenu.open(panel._saveBtn),
        load: typeof load === 'function' ? load : () => loadJSONFile(),
      });
    };
  } else {
    panel.setSaveLoadHandlers({ save: null, load: null });
  }

  // Event-driven re-detection — the moment the host registers a new
  // object, we re-run detection so workflow folders (Material, Graph
  // Editor, Light controls, etc.) mount immediately. Previously the
  // ONLY trigger was a 1-second setInterval poll, which:
  //   1. introduced a 0-1000ms gap where folders appeared "missing"
  //      in host projects (especially after async GLTF loads), and
  //   2. did nothing at all for non-Three (2D / web) hosts where
  //      `opts.scene` is absent.
  //
  // We debounce via microtask so a burst of N register() calls fires
  // detection once at the end of the task, not N times.
  let _detectQueued = false;
  function _detectSoon() {
    if (!useAutoDetect || _detectQueued) return;
    _detectQueued = true;
    queueMicrotask(() => {
      _detectQueued = false;
      detectAndSync();
      // Also re-run the scene scan so descendants of a newly-registered
      // group (e.g. children of a freshly-loaded GLTF) surface in the
      // outliner. autoRegisterScene is idempotent — it skips entries
      // that already exist in the manager.
      if (scene && objectManager && opts.autoRegister !== false) {
        autoRegisterScene(objectManager, scene);
      }
    });
  }
  if (objectManager?.on && useAutoDetect) {
    objectManager.on('register', _detectSoon);
    // Re-detect on remove too — a workflow may need to UN-mount when
    // its last relevant object disappears (e.g. the user trashes the
    // only skinned mesh — Animation workflow should detach).
    objectManager.on('remove', _detectSoon);
  }

  // Background poll as a safety net for cases where the host mutates
  // the scene directly (without going through objectManager.register).
  // 1Hz is cheap because detectWorkflows just traverses + reads material
  // types. Skipped when the event-driven path can't run.
  if (useAutoDetect && opts.scene) {
    ui._watchInterval = setInterval(() => {
      detectAndSync();
      if (scene && objectManager && opts.autoRegister !== false) {
        autoRegisterScene(objectManager, scene);
      }
    }, 1000);
  }

  // Expose a manual rescan trigger (e.g. after the user adds new content)
  ui.rescan = detectAndSync;

  // ── Diagnostics — self-aware health monitoring ──────────────────────────
  // Skipped when opts.diagnostics === false (e.g. production builds that set
  // visible: false and never show the panel to end users).
  if (opts.diagnostics !== false) {
    attachDiagnostics(ui, {
      repo: opts.diagnosticsRepo || 'https://github.com/your-org/ghost-panel',
    });
  }

  // ── Augmentation — natural language panel builder ────────────────────────
  // Adds a ? button in the panel header and Cmd+/ global shortcut.
  // Users type plain English ("add fog controls", "show mesh rotation") and
  // Ghost Panel builds the right controls live. Opt out with augment: false.
  if (opts.augment !== false) {
    attachAugment(ui, {
      getObject:  opts.augmentGetObject || null,
      // Host-declared property schema. Lets the ? prompt bar recognise a typed
      // property name and add a WORKING control bound to it — including LATENT
      // render props that don't exist on the object yet (e.g. strokeWidth).
      // Array of descriptors, or a fn (obj) => descriptors[] for per-object schemas.
      properties: opts.augmentProperties || null,
    });
  }

  return ui;
}

// Re-export so users can build custom controls without going through addFolder
export { Panel } from './panel.js';
export { Folder } from './folder.js';
export * as controls from './controls.js';
export { SceneObjectManager, addSceneObjectsFolder, addCameraFolder, autoRegisterScene } from './three-extensions.js';
export { createGizmoSystem, gizmoFactories } from './gizmos.js';
export { initTooltips, attachTooltip } from './tooltip.js';
export { createGraphEditor, addGraphEditor } from './animation.js';
export { WORKFLOWS, detectWorkflow, detectWorkflows, listWorkflows,
         enableWorkflow, disableWorkflow, getActiveWorkflows } from './workflows.js';
export { Toolbar } from './toolbar.js';
export { SkillsRegistry, BUILTIN_SKILLS, globalRegistry as skillsRegistry } from './skills.js';
export { createWebAdapter, enableWebSelection, playWithWAAPI } from './web-adapter.js';
export { isDev, initIfDev } from './dev-mode.js';
export { LearningStore, attachLearning } from './learning.js';
export { DiagnosticEngine, attachDiagnostics } from './diagnostics.js';
export { AugmentEngine, attachAugment, scanProperties, parseIntent, buildRecipe, applyRecipe } from './augment.js';
export { PromptAnalytics } from './prompt-analytics.js';
