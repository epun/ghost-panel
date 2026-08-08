/**
 * Scene Materials palette — a mini panel that lists every material in the
 * scene as a rendered sphere thumbnail, Blender-style.
 *
 * Three things it does:
 *
 *   1. **Lists** every material reachable from the scene graph (plus any
 *      the user created here that isn't assigned yet), grouped by three
 *      filters: All / Unused / Active Object.
 *   2. **Inspects** — clicking a swatch opens that material's properties
 *      in the Inspector (right-hand panel), bound to the material
 *      instance rather than to a mesh, so unassigned materials are
 *      editable too.
 *   3. **Assigns by drag** — drag a swatch onto geometry in the viewport
 *      (or onto an Outliner row) to apply it. A plain drop re-skins the
 *      WHOLE object — for an imported model, the whole model, not the one
 *      sub-mesh the ray touched. Holding Alt/Option narrows the target to
 *      the geometry group under the cursor (a single face of a box, one
 *      slot of a multi-material mesh), or to that one sub-mesh when its
 *      geometry has no groups.
 *
 * Thumbnails are rendered by a tiny dedicated WebGLRenderer on a
 * transparent background — the checkerboard behind them is CSS, so the
 * previews composite over either theme. If WebGL isn't available (jsdom,
 * a lost context, a headless CI run) every swatch falls back to a flat
 * base-color chip and the rest of the palette keeps working.
 *
 * Ownership note: the 'Material' folder in the Inspector is shared with
 * the contextual layer (contextual.js shows a mesh's material on
 * selection). This module attaches its objectManager 'change' listener
 * BEFORE contextual does, so on any selection change we drop our folder
 * first and let the contextual layer take over cleanly.
 */

import * as THREE from 'three';
import { icons } from './icons.js';
import { showToast } from './toast.js';
import { log } from './log.js';

/** MIME type carried on the drag. Must be lowercase to survive dataTransfer. */
export const MATERIAL_DRAG_MIME = 'application/x-ghost-panel-material';

const PREVIEW_SIZE = 96;
/** Above this many distinct materials we stop rendering previews (flat chips instead). */
const PREVIEW_BUDGET = 200;

// ── Naming ──────────────────────────────────────────────────────────────────

/**
 * Display name for a material. Named materials keep their name; anonymous
 * ones get an `RGB_<r>-<g>-<b>` label derived from their base color, which
 * is stable across renders and tells you at a glance what you're looking at.
 */
export function materialLabel(mat) {
  if (!mat) return 'None';
  if (mat.name) return mat.name;
  if (mat.color?.getHexString) {
    const hex = mat.color.getHexString();          // sRGB, matches the swatch
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `RGB_${r}-${g}-${b}`;
  }
  return mat.type || 'Material';
}

/**
 * Fingerprint of everything that changes how a material LOOKS. The preview
 * cache is keyed on this, so editing roughness re-renders the thumbnail but
 * a re-layout of the palette doesn't re-render anything.
 */
export function materialSignature(mat) {
  if (!mat) return 'none';
  return [
    mat.type,
    mat.color?.getHexString?.() ?? '-',
    mat.emissive?.getHexString?.() ?? '-',
    mat.emissiveIntensity ?? '-',
    mat.roughness ?? '-',
    mat.metalness ?? '-',
    mat.opacity ?? '-',
    mat.transparent ? 1 : 0,
    mat.wireframe ? 1 : 0,
    mat.flatShading ? 1 : 0,
    mat.side ?? '-',
    mat.map?.uuid ?? '-',
    mat.normalMap?.uuid ?? '-',
    mat.roughnessMap?.uuid ?? '-',
  ].join('|');
}

// ── Scene walking ───────────────────────────────────────────────────────────

/** Helpers, gizmo internals and opted-out nodes never contribute materials. */
function isIgnoredNode(node) {
  let n = node;
  while (n) {
    if (n.userData?.__duiIgnore) return true;
    if (n.isTransformControls) return true;
    const t = n.type || n.constructor?.name || '';
    if (/Helper$/.test(t)) return true;
    n = n.parent;
  }
  return false;
}

function hasMaterial(node) {
  return !!(node && (node.isMesh || node.isPoints || node.isLine || node.isSprite));
}

/**
 * Walk a scene and index every material by instance.
 *
 * Returns a Map keyed by the material instance:
 *   material → { material, users: [{ mesh, slot }] }
 * where `slot` is the index into a multi-material array, or null for
 * single-material meshes.
 */
export function collectSceneMaterials(scene) {
  const out = new Map();
  if (!scene?.traverse) return out;
  scene.traverse((node) => {
    if (!hasMaterial(node)) return;
    if (isIgnoredNode(node)) return;
    const m = node.material;
    if (!m) return;
    const arr = Array.isArray(m) ? m : [m];
    arr.forEach((mm, i) => {
      if (!mm) return;
      let entry = out.get(mm);
      if (!entry) { entry = { material: mm, users: [] }; out.set(mm, entry); }
      entry.users.push({ mesh: node, slot: Array.isArray(m) ? i : null });
    });
  });
  return out;
}

// ── Geometry group / material slot resolution ───────────────────────────────

/**
 * Which geometry group contains the given face?
 *
 * Three.js only tags `intersection.face.materialIndex` when the mesh
 * already has a material ARRAY. For a single-material mesh that still has
 * groups (every BoxGeometry has six), we resolve the group ourselves from
 * the face index so "drop onto one face of the cube" works before the mesh
 * has ever been split into slots.
 *
 * Returns the group's ordinal, or null when the geometry isn't grouped.
 */
export function groupIndexForFace(geometry, faceIndex) {
  const groups = geometry?.groups;
  if (!groups?.length || faceIndex == null) return null;
  const i = faceIndex * 3;        // groups are expressed in index-buffer units
  for (let g = 0; g < groups.length; g++) {
    const { start, count } = groups[g];
    if (i >= start && i < start + count) return g;
  }
  return null;
}

/**
 * Resolve the material SLOT a raycast hit landed on, or null when the mesh
 * has no per-group slots (i.e. the whole object is one material).
 */
export function slotForIntersection(intersection) {
  if (!intersection) return null;
  const mesh = intersection.object;
  if (!mesh) return null;
  // Multi-material mesh: Three.js already tagged the face for us.
  if (Array.isArray(mesh.material) && intersection.face?.materialIndex != null) {
    return intersection.face.materialIndex;
  }
  // Single material over grouped geometry: derive the group, then read the
  // materialIndex it declares (a Box's six groups declare 0..5).
  const g = groupIndexForFace(mesh.geometry, intersection.faceIndex);
  if (g == null) return null;
  return mesh.geometry.groups[g].materialIndex ?? g;
}

/**
 * Snapshot a mesh's material assignment so it can be restored by undo.
 * Arrays are copied (not aliased) so a later slot write doesn't mutate the
 * snapshot out from under us.
 */
function snapshotMaterial(mesh) {
  return Array.isArray(mesh.material) ? mesh.material.slice() : mesh.material;
}

function restoreMaterial(mesh, snap) {
  mesh.material = Array.isArray(snap) ? snap.slice() : snap;
}

/** Write one slot of a multi-material mesh without mutating the old array. */
function writeSlot(mesh, slot, material) {
  const slots = mesh.material.slice();
  slots[slot] = material;
  mesh.material = slots;
}

/**
 * Give a mesh a material ARRAY wide enough to address `slot` individually,
 * seeding every slot with the material it already had. No-op when the mesh
 * is already multi-material.
 */
function ensureMaterialSlots(mesh, slot) {
  if (Array.isArray(mesh.material)) return;
  const groups = mesh.geometry?.groups || [];
  const maxIndex = groups.length
    ? groups.reduce((m, g) => Math.max(m, g.materialIndex ?? 0), 0)
    : slot;
  const base = mesh.material;
  mesh.material = Array.from({ length: Math.max(maxIndex, slot) + 1 }, () => base);
}

/**
 * Apply `material` to a target.
 *
 *   assignMaterial(target, mat)                  → whole object (all slots,
 *                                                  all descendant meshes)
 *   assignMaterial(target, mat, { slot: 2 })     → just that material slot
 *
 * `target` may be a mesh or any Object3D — a Group re-skins every mesh
 * beneath it, which is what "drop onto the imported model" should mean.
 *
 * Returns `{ meshes, before, undo }` where `undo()` puts everything back,
 * or null when there was nothing to assign to.
 */
export function assignMaterial(target, material, { slot = null } = {}) {
  if (!target || !material) return null;

  const meshes = [];
  if (slot != null && hasMaterial(target)) {
    meshes.push(target);
  } else if (target.traverse) {
    target.traverse((n) => { if (hasMaterial(n) && !isIgnoredNode(n)) meshes.push(n); });
  } else if (hasMaterial(target)) {
    meshes.push(target);
  }
  if (!meshes.length) return null;

  const before = meshes.map(snapshotMaterial);

  if (slot != null) {
    const mesh = meshes[0];
    ensureMaterialSlots(mesh, slot);
    // Write into a COPY: a host that handed us its own material array (or an
    // undo snapshot pointing at it) must not see the slot change underneath.
    // Reassigning also makes Three.js re-evaluate the mesh's program cache.
    writeSlot(mesh, slot, material);
  } else {
    meshes.forEach((mesh) => {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(() => material)
        : material;
    });
  }

  return {
    meshes,
    before,
    undo: () => meshes.forEach((mesh, i) => restoreMaterial(mesh, before[i])),
  };
}

// ── Thumbnail previews ──────────────────────────────────────────────────────

let _previewer;           // undefined = not built yet, null = unavailable

/**
 * Lazily build the shared offscreen preview renderer: one sphere, a
 * three-point rig, and a small procedural environment so metals have
 * something to reflect. Transparent background — the checkerboard behind
 * each swatch is CSS.
 */
function getPreviewer() {
  if (_previewer !== undefined) return _previewer;
  _previewer = null;
  try {
    const renderer = new THREE.WebGLRenderer({
      alpha: true, antialias: true, preserveDrawingBuffer: true,
    });
    renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48));
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-2.5, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.7);
    fill.position.set(3, -1, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(1, 2, -3);
    scene.add(rim);

    // Environment — a vertical studio gradient, so metalness/roughness read
    // as something other than flat black. Best-effort: a driver without
    // float render targets just loses the reflections, not the preview.
    try {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 32;                       // 2:1 equirectangular
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 32);
      grad.addColorStop(0.0, '#ffffff');
      grad.addColorStop(0.45, '#9fb2c9');
      grad.addColorStop(0.55, '#5a6577');
      grad.addColorStop(1.0, '#16181d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 32);
      const tex = new THREE.Texture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      tex.dispose();
    } catch (e) {
      log.debug?.('materials', 'preview environment unavailable:', e);
    }

    _previewer = {
      /** Render `mat` on the sphere and return a PNG data URL. */
      render(mat) {
        mesh.material = mat;
        renderer.render(scene, camera);
        mesh.material = null;         // never hold a scene material hostage
        return renderer.domElement.toDataURL('image/png');
      },
      dispose() {
        mesh.geometry.dispose();
        scene.environment?.dispose?.();
        renderer.dispose();
      },
    };
  } catch (e) {
    log.warn('materials', 'WebGL preview unavailable — falling back to color chips:', e);
    _previewer = null;
  }
  return _previewer;
}

/**
 * The preview renderer is a singleton shared by every palette on the page, so
 * it's ref-counted: the last palette to go away releases the WebGL context.
 * Without this a re-mount (React StrictMode's double-mount, a hot reload)
 * would strand a context per cycle until the browser starts evicting them.
 */
let _previewRefs = 0;

/** Drop the shared preview renderer (tests / teardown). */
export function disposePreviewer() {
  try { _previewer?.dispose(); } catch { /* context already gone */ }
  _previewer = undefined;
  _previewRefs = 0;
}

// ── The palette ─────────────────────────────────────────────────────────────

const TABS = [
  { id: 'all',    label: 'All',           tip: 'Every material in the scene' },
  { id: 'unused', label: 'Unused',        tip: 'Materials no object references' },
  { id: 'active', label: 'Active Object', tip: 'Materials on the current selection' },
];

/**
 * Mount the materials palette.
 *
 * @param {object} ui   the Ghost Panel handle (needs `objectManager`, `panel`)
 * @param {object} opts { panel } — which panel hosts the palette (defaults to
 *                      the Scene panel, falling back to the Inspector)
 * @returns {{ folder, refresh, dispose, create, select, getMaterials, assign }}
 */
export function attachMaterialsPalette(ui, opts = {}) {
  const om = ui?.objectManager;
  const scene = opts.scene || om?.scene;
  if (!scene?.traverse) return null;

  const host = opts.panel || ui.scenePanel || ui.panel;
  if (!host) return null;

  const folder = host.addFolder(opts.title || 'Materials', { collapsed: false });
  _previewRefs++;

  /**
   * Every material the palette has ever seen, in discovery order.
   *
   * The scene walk alone isn't enough: the moment you drag material B onto
   * the only mesh using material A, A leaves the scene graph — and a swatch
   * that vanishes the instant you replace it is a palette you can't undo
   * your way around. So materials stay listed (with a 0-users badge) until
   * they're explicitly deleted. Bounded, with the oldest unused entries
   * evicted first, so a host that churns materials can't grow this forever.
   */
  const library = new Set();
  const LIBRARY_LIMIT = 300;
  /** uuid → material, so a drag payload (a string) can be resolved back. */
  const byId = new Map();
  /** signature → data URL. */
  const previewCache = new Map();

  let entries = [];             // [{ material, users }]
  let activeTab = 'all';
  let activeMaterial = null;    // the swatch whose properties are showing
  let ownsInspectorFolder = false;
  let disposed = false;

  // ── Chrome ────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'dui-matpal';
  root.innerHTML = `
    <div class="dui-matpal-toolbar">
      <button class="dui-matpal-btn" data-act="new"     data-tooltip="New Standard material">${icons.plus}</button>
      <button class="dui-matpal-btn" data-act="preview" data-tooltip="Re-render previews">${icons.sphere}</button>
      <span class="dui-matpal-sep"></span>
      <button class="dui-matpal-btn" data-act="assign"  data-tooltip="Assign to the selected object">${icons.paintBrush}</button>
      <button class="dui-matpal-btn" data-act="pick"    data-tooltip="Pick the selected object's material">${icons.eyedropper}</button>
      <span class="dui-matpal-spacer"></span>
      <button class="dui-matpal-btn dui-danger" data-act="delete" data-tooltip="Remove the selected material">${icons.trash}</button>
    </div>
    <div class="dui-matpal-tabs">
      ${TABS.map(t => `<button class="dui-matpal-tab" data-tab="${t.id}" data-tooltip="${t.tip}">${t.label}</button>`).join('')}
    </div>
    <div class="dui-matgrid"></div>
    <div class="dui-matpal-empty">No materials in this scene yet.</div>`;
  folder.addRaw(root);

  const gridEl  = root.querySelector('.dui-matgrid');
  const emptyEl = root.querySelector('.dui-matpal-empty');

  // ── Data ──────────────────────────────────────────────────────────────────

  function activeMeshes() {
    const names = om?.getSelectedNames?.() || (om?.activeName ? [om.activeName] : []);
    const out = [];
    names.forEach((n) => {
      const o = om.getObject(n);
      if (!o) return;
      if (o.traverse) o.traverse((c) => { if (hasMaterial(c)) out.push(c); });
      else if (hasMaterial(o)) out.push(o);
    });
    return out;
  }

  function rebuildEntries() {
    const map = collectSceneMaterials(scene);
    map.forEach((_e, m) => library.add(m));
    // Materials no longer reachable from the scene (just replaced, or
    // created here and not assigned yet) keep their swatch with 0 users.
    library.forEach((m) => {
      if (!map.has(m)) map.set(m, { material: m, users: [] });
    });
    evictLibrary(map);
    entries = [...map.values()];
    byId.clear();
    entries.forEach(e => byId.set(e.material.uuid, e.material));
    return entries;
  }

  /**
   * Trim the library back to LIBRARY_LIMIT, dropping the oldest entries that
   * nothing references and that aren't currently open in the Inspector.
   * In-use materials are never evicted — they'd just come straight back on
   * the next scan anyway.
   */
  function evictLibrary(map) {
    if (library.size <= LIBRARY_LIMIT) return;
    for (const m of library) {
      if (library.size <= LIBRARY_LIMIT) break;
      if (m === activeMaterial) continue;
      if (map.get(m)?.users?.length) continue;
      library.delete(m);
      map.delete(m);
    }
  }

  function visibleEntries() {
    if (activeTab === 'unused') return entries.filter(e => e.users.length === 0);
    if (activeTab === 'active') {
      const meshes = new Set(activeMeshes());
      if (!meshes.size) return [];
      return entries.filter(e => e.users.some(u => meshes.has(u.mesh)));
    }
    return entries;
  }

  /** Fingerprint of the whole palette — cheap change detection for the poll. */
  function paletteSignature() {
    return entries.map(e => `${e.material.uuid}:${e.users.length}:${materialSignature(e.material)}`).join('§');
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function thumbFor(mat, budgeted) {
    const sig = materialSignature(mat);
    const cached = previewCache.get(sig);
    if (cached) return cached;
    if (!budgeted) return null;
    const p = getPreviewer();
    if (!p) return null;
    try {
      const url = p.render(mat);
      previewCache.set(sig, url);
      return url;
    } catch (e) {
      log.warn('materials', `preview render failed for ${materialLabel(mat)}:`, e);
      return null;
    }
  }

  function chipColor(mat) {
    return mat?.color?.getHexString ? `#${mat.color.getHexString()}` : '#8a8a8a';
  }

  function render() {
    if (disposed) return;
    const list = visibleEntries();
    gridEl.innerHTML = '';
    emptyEl.style.display = list.length ? 'none' : '';
    if (!list.length) {
      emptyEl.textContent = activeTab === 'active'
        ? 'Select an object to see its materials.'
        : activeTab === 'unused'
          ? 'Every material is in use.'
          : 'No materials in this scene yet.';
      syncToolbar();
      return;
    }

    const budgeted = list.length <= PREVIEW_BUDGET;
    list.forEach(({ material, users }) => {
      const name = materialLabel(material);
      const cell = document.createElement('div');
      cell.className = 'dui-mat-swatch';
      if (material === activeMaterial) cell.classList.add('dui-selected');
      cell.dataset.id = material.uuid;
      cell.draggable = true;
      cell.dataset.tooltip = users.length
        ? `${name} — used by ${users.length} object${users.length === 1 ? '' : 's'}. Drag onto geometry to apply.`
        : `${name} — unused. Drag onto geometry to apply.`;

      const url = thumbFor(material, budgeted);
      cell.innerHTML = `
        <div class="dui-mat-thumb">
          ${url
            ? `<img src="${url}" alt="" draggable="false">`
            : `<span class="dui-mat-chip" style="background:${chipColor(material)}"></span>`}
          ${users.length ? '' : '<span class="dui-mat-badge">0</span>'}
        </div>
        <div class="dui-mat-name">${name}</div>`;

      cell.addEventListener('click', () => selectMaterial(material));
      cell.addEventListener('dragstart', (e) => onDragStart(e, material, cell));
      cell.addEventListener('dragend', endDrag);
      gridEl.appendChild(cell);
    });
    syncToolbar();
  }

  function syncToolbar() {
    const sel = activeMeshes().length > 0;
    root.querySelector('[data-act="assign"]').disabled = !(sel && activeMaterial);
    root.querySelector('[data-act="pick"]').disabled = !sel;
    root.querySelector('[data-act="delete"]').disabled = !activeMaterial;
    root.querySelectorAll('[data-tab]').forEach(b =>
      b.classList.toggle('dui-active', b.dataset.tab === activeTab));
  }

  let renderQueued = false;
  function renderBatched() {
    if (renderQueued || disposed) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; refresh(); });
  }

  function refresh() {
    rebuildEntries();
    // A material that vanished from the scene shouldn't keep the Inspector open.
    if (activeMaterial && !byId.has(activeMaterial.uuid)) activeMaterial = null;
    render();
  }

  // ── Inspector: material properties ────────────────────────────────────────

  const MAT_TYPES = ['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial',
                     'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshNormalMaterial'];
  const MAT_LABELS = {
    MeshStandardMaterial: 'Standard (PBR)',
    MeshPhysicalMaterial: 'Physical (PBR+)',
    MeshBasicMaterial:    'Basic (unlit)',
    MeshLambertMaterial:  'Lambert',
    MeshPhongMaterial:    'Phong',
    MeshNormalMaterial:   'Normals',
  };
  const SIDES = { Front: THREE.FrontSide, Back: THREE.BackSide, Double: THREE.DoubleSide };

  /**
   * Drop our Inspector folder. Called both on teardown and whenever the
   * selection changes — at which point contextual.js re-creates its own
   * mesh-bound 'Material' folder in the same slot.
   */
  function releaseInspector() {
    if (!ownsInspectorFolder) return;
    ownsInspectorFolder = false;
    ui.panel.removeFolder('Material');
  }

  /** Anything that alters the look → invalidate the thumbnail and redraw. */
  function touched(mat) {
    previewCache.delete(materialSignature(mat));
    renderBatched();
  }

  function showProperties(mat) {
    // Take the 'Material' slot over from whoever had it (the contextual
    // layer's mesh-bound folder, or our own previous selection).
    ui.panel.removeFolder('Material');
    const f = ui.panel.addFolder('Material', { collapsed: false, transient: true });
    ownsInspectorFolder = true;

    // Sit directly under the Tool folder, same place the contextual
    // layer puts it, so the Inspector doesn't reshuffle as you click around.
    const toolFolder = ui.panel.folders['Tool'];
    if (toolFolder && f.element) {
      ui.panel.body.insertBefore(f.element, toolFolder.element.nextSibling);
    }

    const entry = entries.find(e => e.material === mat);
    const users = entry?.users?.length || 0;
    f.addInfo(users
      ? `Used by ${users} object${users === 1 ? '' : 's'}`
      : 'Not assigned — drag it onto geometry');

    f.addText('Name', {
      value: mat.name || '',
      placeholder: materialLabel(mat),
      tooltip: 'Naming a material makes it easy to find in the palette',
      onChange: (v) => { mat.name = v.trim(); renderBatched(); },
    });

    if (mat.color) {
      f.addColor('Color', {
        value: `#${mat.color.getHexString()}`,
        tooltip: 'Base color of the material',
        onChange: (c) => { mat.color.set(c); touched(mat); },
      });
    }
    if (mat.roughness !== undefined) {
      f.addSlider('Roughness', {
        min: 0, max: 1, step: 0.01, value: mat.roughness,
        tooltip: 'Surface roughness (0 = mirror, 1 = chalk)',
        onChange: (v) => { mat.roughness = v; touched(mat); },
      });
    }
    if (mat.metalness !== undefined) {
      f.addSlider('Metalness', {
        min: 0, max: 1, step: 0.01, value: mat.metalness,
        tooltip: 'Metallic factor (0 = dielectric, 1 = full metal)',
        onChange: (v) => { mat.metalness = v; touched(mat); },
      });
    }
    if (mat.emissive) {
      f.addColor('Emissive', {
        value: `#${mat.emissive.getHexString()}`,
        tooltip: 'Self-illuminating color (independent of lighting)',
        onChange: (c) => { mat.emissive.set(c); touched(mat); },
      });
      if (mat.emissiveIntensity !== undefined) {
        f.addSlider('Emissive Strength', {
          min: 0, max: 10, step: 0.01, value: mat.emissiveIntensity,
          onChange: (v) => { mat.emissiveIntensity = v; touched(mat); },
        });
      }
    }
    if (mat.opacity !== undefined) {
      f.addSlider('Opacity', {
        min: 0, max: 1, step: 0.01, value: mat.opacity,
        tooltip: 'Material transparency',
        onChange: (v) => {
          mat.opacity = v;
          mat.transparent = v < 1;
          mat.needsUpdate = true;
          touched(mat);
        },
      });
    }
    if (mat.wireframe !== undefined) {
      f.addCheckbox('Wireframe', {
        value: !!mat.wireframe,
        onChange: (v) => { mat.wireframe = v; touched(mat); },
      });
    }
    if (mat.flatShading !== undefined) {
      f.addCheckbox('Flat Shading', {
        value: !!mat.flatShading,
        tooltip: 'Faceted shading — no normal interpolation across faces',
        onChange: (v) => { mat.flatShading = v; mat.needsUpdate = true; touched(mat); },
      });
    }
    if (mat.side !== undefined) {
      const current = Object.keys(SIDES).find(k => SIDES[k] === mat.side) || 'Front';
      f.addSelect('Side', {
        options: Object.keys(SIDES), value: current,
        tooltip: 'Which faces render — Double is the fix for see-through planes',
        onChange: (v) => { mat.side = SIDES[v] ?? THREE.FrontSide; mat.needsUpdate = true; touched(mat); },
      });
    }

    // Material class swap. Unlike the contextual layer's version (which
    // re-skins ONE mesh) this rewires every user of the material, because
    // here the material — not the mesh — is what the user selected.
    if (MAT_TYPES.includes(mat.type)) {
      f.addSelect('Material Type', {
        options: MAT_TYPES.map(t => MAT_LABELS[t]),
        value: MAT_LABELS[mat.type],
        tooltip: 'Swap the material class — color, map and opacity carry over',
        // Opt out of the Folder-level auto-undo wrapper: swapMaterialClass
        // pushes its own entry. With both in play the first Cmd+Z popped the
        // wrapper's entry, which re-invoked this handler with the ORIGINAL
        // type — a no-op against the already-replaced material — so undo
        // silently did nothing until you pressed it twice.
        undo: false,
        onChange: (label) => {
          const target = MAT_TYPES.find(t => MAT_LABELS[t] === label) || label;
          if (target === mat.type) return;
          const Ctor = THREE[target];
          if (!Ctor) return;
          swapMaterialClass(mat, Ctor);
        },
      });
    }

    f.addButton('Assign to Selection', () => assignToSelection(mat));
  }

  /**
   * Replace `mat` with a fresh instance of `Ctor` everywhere it's used,
   * carrying over the properties the new class understands.
   */
  function swapMaterialClass(mat, Ctor) {
    const next = new Ctor({
      color: mat.color?.clone?.() || 0xffffff,
      map: mat.map || null,
      opacity: mat.opacity ?? 1,
      transparent: !!mat.transparent,
      wireframe: !!mat.wireframe,
      side: mat.side,
    });
    next.name = mat.name;

    const targets = collectSceneMaterials(scene).get(mat)?.users || [];
    const before = targets.map(u => ({ mesh: u.mesh, snap: snapshotMaterial(u.mesh) }));
    const applySwap = () => targets.forEach(({ mesh, slot }) => {
      if (slot == null) mesh.material = next;
      else writeSlot(mesh, slot, next);
    });
    applySwap();
    if (library.delete(mat)) library.add(next);

    ui._undo?.push?.({
      label: `swap ${materialLabel(mat)} → ${Ctor.name}`,
      undo: () => {
        before.forEach(({ mesh, snap }) => restoreMaterial(mesh, snap));
        if (library.delete(next)) library.add(mat);
        selectMaterial(mat);
      },
      redo: () => {
        applySwap();
        if (library.delete(mat)) library.add(next);
        selectMaterial(next);
      },
    });

    refresh();
    selectMaterial(next);
  }

  function selectMaterial(mat) {
    activeMaterial = mat || null;
    if (mat) showProperties(mat);
    else releaseInspector();
    render();
    return mat;
  }

  // ── Assignment ────────────────────────────────────────────────────────────

  /**
   * Assign + push undo + toast. `label` names the drop target for the
   * toast and the undo entry.
   */
  function commitAssign(target, material, { slot = null, label } = {}) {
    const result = assignMaterial(target, material, { slot });
    if (!result) return false;

    const matName = materialLabel(material);
    const where = slot == null ? label : `${label} · slot ${slot}`;
    ui._undo?.push?.({
      label: `assign ${matName} to ${where}`,
      undo: () => { result.undo(); refresh(); },
      redo: () => { assignMaterial(target, material, { slot }); refresh(); },
    });
    showToast(`${matName} → ${where}`, { icon: icons.paintBrush });
    refresh();
    return true;
  }

  function assignToSelection(material) {
    const names = om?.getSelectedNames?.() || (om?.activeName ? [om.activeName] : []);
    if (!names.length) {
      showToast('Select an object first', { icon: icons.warning });
      return false;
    }
    let any = false;
    names.forEach((n) => {
      const obj = om.getObject(n);
      if (obj) any = commitAssign(obj, material, { label: n }) || any;
    });
    return any;
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = null;          // { material }
  let badge = null;             // cursor-following label
  let highlight = null;         // BoxHelper over the hovered object
  let lastHover = null;         // { object, slot, name }

  function activeCamera() {
    return om?._activeCameraRef?.() || om?.camera || ui._camera || null;
  }

  function onDragStart(e, material, cell) {
    dragging = { material };
    e.dataTransfer.effectAllowed = 'copy';
    // Both a custom type (so drop targets can recognise us during dragover,
    // where reading data is forbidden) and text/plain (so dropping into an
    // editor pastes something meaningful).
    e.dataTransfer.setData(MATERIAL_DRAG_MIME, material.uuid);
    e.dataTransfer.setData('text/plain', materialLabel(material));
    const img = cell.querySelector('img');
    if (img?.complete) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
    ensureBadge();
    document.body.classList.add('dui-mat-dragging');
  }

  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement('div');
    badge.className = 'dui-matdrop-badge';
    document.body.appendChild(badge);
    return badge;
  }

  function showBadge(x, y, html, ok) {
    ensureBadge();
    badge.innerHTML = html;
    badge.classList.toggle('dui-matdrop-ok', !!ok);
    badge.classList.add('dui-visible');
    badge.style.transform = `translate(${x + 14}px, ${y + 16}px)`;
  }

  function hideBadge() { badge?.classList.remove('dui-visible'); }

  function clearHighlight() {
    if (highlight) { highlight.parent?.remove(highlight); highlight.dispose?.(); highlight = null; }
    lastHover = null;
  }

  function setHighlight(object) {
    if (lastHover?.object === object && highlight) return;
    clearHighlight();
    if (!object) return;
    try {
      highlight = new THREE.BoxHelper(object, 0x4f9dff);
      highlight.userData.__duiIgnore = true;   // keep it out of the Outliner
      highlight.material.depthTest = false;
      highlight.renderOrder = 999;
      scene.add(highlight);
    } catch (e) {
      log.debug?.('materials', 'highlight failed:', e);
    }
  }

  /**
   * Meshes the drop can land on, gathered once per drag. `dragover` fires at
   * pointer rate, and a full scene traversal per event is a lot of garbage to
   * make while the user is just hovering.
   */
  let dropTargets = null;
  function dropTargetList() {
    if (dropTargets) return dropTargets;
    dropTargets = [];
    scene.traverse((n) => {
      if (hasMaterial(n) && n.visible !== false && !isIgnoredNode(n)) dropTargets.push(n);
    });
    return dropTargets;
  }

  /** Raycast the viewport for the mesh under the cursor. */
  function pickAt(clientX, clientY) {
    const canvas = om?.renderer?.domElement;
    const camera = activeCamera();
    if (!canvas || !camera) return null;
    const r = canvas.getBoundingClientRect();
    pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(dropTargetList(), false);
    return hits.length ? hits[0] : null;
  }

  /**
   * Walk up to the registered Outliner entry that owns a hit mesh.
   *
   * `outermost: true` keeps climbing past the first match to the top of the
   * registered chain. That matters for imported models: autoRegisterScene
   * registers a GLTF root Group AND its sub-meshes, so the nearest match for
   * a hit on one panel of a car is that panel — while a plain drop is
   * supposed to re-skin the whole car.
   */
  function ownerNameFor(object, { outermost = false } = {}) {
    if (!om?.objects) return null;
    let found = null;
    let n = object;
    while (n) {
      const match = Object.entries(om.objects).find(([, e]) => e.object === n);
      if (match) {
        found = match[0];
        if (!outermost) return found;
      }
      n = n.parent;
    }
    return found;
  }

  function carriesMaterial(e) {
    return !!(dragging || e.dataTransfer?.types?.includes?.(MATERIAL_DRAG_MIME));
  }

  function materialFromEvent(e) {
    const id = e.dataTransfer?.getData?.(MATERIAL_DRAG_MIME);
    return (id && byId.get(id)) || dragging?.material || null;
  }

  /**
   * Resolve what a viewport drop would hit.
   *
   * Plain drop → the whole registered object. On an imported model that's the
   *              model root, not the one sub-mesh the ray happened to touch.
   * Alt/Option → the NARROWEST thing under the cursor: the geometry group when
   *              the hit mesh has them (one face of a box, one slot of a
   *              multi-material mesh), otherwise that single mesh on its own.
   */
  function resolveDrop(e) {
    const hit = pickAt(e.clientX, e.clientY);
    if (!hit) return null;
    const mesh = hit.object;

    if (e.altKey) {
      const slot = slotForIntersection(hit);
      return {
        hit,
        slot,
        target: mesh,
        highlight: mesh,
        perSlot: slot != null,
        label: ownerNameFor(mesh) || mesh.name || mesh.type || 'object',
        scope: slot != null ? `slot ${slot}` : 'this mesh only',
      };
    }

    const ownerName = ownerNameFor(mesh, { outermost: true });
    const target = ownerName ? om.getObject(ownerName) : mesh;
    return {
      hit,
      slot: null,
      target,
      highlight: target,
      perSlot: false,
      label: ownerName || mesh.name || mesh.type || 'object',
      scope: 'whole object · ⌥ for one part',
    };
  }

  function onCanvasDragOver(e) {
    if (!carriesMaterial(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const drop = resolveDrop(e);
    if (!drop) {
      setHighlight(null);
      showBadge(e.clientX, e.clientY, 'No geometry here', false);
      return;
    }
    setHighlight(drop.highlight);
    lastHover = { object: drop.highlight, slot: drop.slot };
    showBadge(e.clientX, e.clientY, `<b>${drop.label}</b><span>${drop.scope}</span>`, true);
  }

  function onCanvasDrop(e) {
    if (!carriesMaterial(e)) return;
    e.preventDefault();
    const material = materialFromEvent(e);
    const drop = resolveDrop(e);
    endDrag();
    if (!material || !drop) return;
    commitAssign(drop.target, material, {
      slot: drop.perSlot ? drop.slot : null,
      label: drop.label,
    });
  }

  // Outliner rows accept drops too — dropping on a row always means "the
  // whole object", which is the unambiguous way to hit something the
  // camera can't currently see.
  function outlinerRowFrom(e) {
    const row = e.target?.closest?.('.dui-list-item[data-name]');
    return row?.dataset?.name || null;
  }

  function onPanelDragOver(e) {
    if (!carriesMaterial(e)) return;
    const name = outlinerRowFrom(e);
    if (!name) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const row = e.target.closest('.dui-list-item');
    // Sweeping down the Outliner fires dragenter on the next row before
    // dragleave on the previous one — clear the others so only the row
    // actually under the cursor reads as the target.
    gridEl.ownerDocument.querySelectorAll('.dui-mat-droptarget')
      .forEach(el => { if (el !== row) el.classList.remove('dui-mat-droptarget'); });
    row.classList.add('dui-mat-droptarget');
    showBadge(e.clientX, e.clientY, `<b>${name}</b><span>whole object</span>`, true);
  }

  function onPanelDragLeave(e) {
    e.target?.closest?.('.dui-list-item')?.classList.remove('dui-mat-droptarget');
  }

  function onPanelDrop(e) {
    if (!carriesMaterial(e)) return;
    const name = outlinerRowFrom(e);
    if (!name) return;
    e.preventDefault();
    const material = materialFromEvent(e);
    endDrag();
    const obj = om.getObject(name);
    if (material && obj) commitAssign(obj, material, { label: name });
  }

  function endDrag() {
    dragging = null;
    dropTargets = null;
    clearHighlight();
    hideBadge();
    document.body.classList.remove('dui-mat-dragging');
    document.querySelectorAll('.dui-mat-droptarget')
      .forEach(el => el.classList.remove('dui-mat-droptarget'));
  }

  // ── Toolbar actions ───────────────────────────────────────────────────────

  function createMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0 });
    mat.name = uniqueName('Material');
    library.add(mat);
    refresh();
    selectMaterial(mat);
    showToast(`Created ${mat.name}`, { icon: icons.plus });
    return mat;
  }

  function uniqueName(base) {
    const taken = new Set(entries.map(e => e.material.name).filter(Boolean));
    if (!taken.has(base)) return base;
    for (let i = 1; i < 1000; i++) {
      const n = `${base}.${String(i).padStart(3, '0')}`;
      if (!taken.has(n)) return n;
    }
    return `${base}.${entries.length}`;
  }

  function pickFromSelection() {
    const mesh = activeMeshes()[0];
    const mat = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
    if (!mat) {
      showToast('Selection has no material', { icon: icons.warning });
      return null;
    }
    refresh();
    selectMaterial(mat);
    return mat;
  }

  function deleteMaterial(mat) {
    if (!mat) return false;
    const entry = entries.find(e => e.material === mat);
    if (entry?.users?.length) {
      showToast(`${materialLabel(mat)} is used by ${entry.users.length} object${entry.users.length === 1 ? '' : 's'}`,
                { icon: icons.warning, duration: 2600 });
      return false;
    }
    library.delete(mat);
    mat.dispose?.();
    activeMaterial = null;
    releaseInspector();
    refresh();
    return true;
  }

  root.querySelector('.dui-matpal-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    e.stopPropagation();
    switch (btn.dataset.act) {
      case 'new':     createMaterial(); break;
      case 'preview': previewCache.clear(); refresh(); break;
      case 'assign':  if (activeMaterial) assignToSelection(activeMaterial); break;
      case 'pick':    pickFromSelection(); break;
      case 'delete':  deleteMaterial(activeMaterial); break;
    }
  });

  root.querySelector('.dui-matpal-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    e.stopPropagation();
    activeTab = btn.dataset.tab;
    render();
  });

  // ── Wiring ────────────────────────────────────────────────────────────────

  const canvas = om?.renderer?.domElement || null;
  if (canvas) {
    canvas.addEventListener('dragover', onCanvasDragOver);
    canvas.addEventListener('drop', onCanvasDrop);
    canvas.addEventListener('dragleave', hideBadge);
  }
  const panelEl = host.element;
  panelEl.addEventListener('dragover', onPanelDragOver);
  panelEl.addEventListener('dragleave', onPanelDragLeave);
  panelEl.addEventListener('drop', onPanelDrop);
  window.addEventListener('dragend', endDrag);

  // Selection changes: hand the 'Material' Inspector slot back to the
  // contextual layer (whose listener is registered AFTER ours, so it wins
  // the slot on the same tick) and re-highlight the matching swatch.
  let lastActiveName = om?.activeName ?? null;
  function onManagerChange() {
    const name = om?.activeName ?? null;
    if (name !== lastActiveName) {
      lastActiveName = name;
      releaseInspector();
      if (name) {
        const mesh = activeMeshes()[0];
        const mat = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
        activeMaterial = mat || null;
      }
    }
    renderBatched();
  }
  om?.on?.('change', onManagerChange);
  om?.on?.('register', renderBatched);
  om?.on?.('remove', renderBatched);

  // Safety net for hosts that mutate materials directly (a GLTF finishing
  // its load, a shader hot-swap) without ever touching the objectManager.
  // Signature-gated so a steady scene costs one traversal per tick.
  rebuildEntries();
  let lastSig = paletteSignature();
  const poll = setInterval(() => {
    if (disposed) return;
    try {
      rebuildEntries();
      const sig = paletteSignature();
      if (sig !== lastSig) { lastSig = sig; render(); }
    } catch (e) {
      log.error('materials', 'palette poll failed:', e);
    }
  }, opts.pollMs || 1000);

  render();

  return {
    folder,
    element: root,
    refresh,
    /** All materials currently listed, newest scan first. */
    getMaterials: () => entries.map(e => e.material),
    /** The material whose properties are open in the Inspector. */
    get active() { return activeMaterial; },
    select: selectMaterial,
    create: createMaterial,
    remove: deleteMaterial,
    assign: (target, material, o) => commitAssign(target, material, { label: 'object', ...o }),
    assignToSelection,
    setFilter: (tab) => { activeTab = tab; render(); },
    dispose() {
      disposed = true;
      clearInterval(poll);
      clearHighlight();
      badge?.remove(); badge = null;
      if (canvas) {
        canvas.removeEventListener('dragover', onCanvasDragOver);
        canvas.removeEventListener('drop', onCanvasDrop);
        canvas.removeEventListener('dragleave', hideBadge);
      }
      panelEl.removeEventListener('dragover', onPanelDragOver);
      panelEl.removeEventListener('dragleave', onPanelDragLeave);
      panelEl.removeEventListener('drop', onPanelDrop);
      window.removeEventListener('dragend', endDrag);
      releaseInspector();
      host.removeFolder(folder.name);
      if (--_previewRefs <= 0) disposePreviewer();
    },
  };
}
