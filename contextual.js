/**
 * Contextual inspector — controls and folders that appear when a 3D object
 * is selected. Watches the SceneObjectManager and surfaces:
 *
 *   - A small "mode" toolbar pinned to the left edge of the Inspector panel
 *     containing Move / Rotate / Scale buttons (visible only on selection).
 *   - A "Material" folder showing the selected mesh's material properties
 *     (color, metalness, roughness, wireframe, etc.). Auto-removed on
 *     deselect.
 *   - A "Selection" status line showing the active object's name.
 *
 * Unlike the Tool folder added by the 3D workflow, this is dynamic — it
 * appears and disappears based on what's selected, so the panel stays
 * uncluttered when nothing is active.
 */

import * as THREE from 'three';
import { UndoStack } from './undo-stack.js';
import { attachKeyframeIcon } from './keyframe-icon.js';
import { showToast } from './toast.js';
import { positionPopoverNear } from './controls.js';
import { icons } from './icons.js';
import { log } from './log.js';

// Materials that have a `.map` slot Three.js samples in their fragment shader.
// Anything outside this set will be auto-promoted when the user uploads a
// texture, so the texture actually appears on the object.
const TEXTURE_CAPABLE_MATERIALS = new Set([
  'MeshStandardMaterial', 'MeshPhysicalMaterial',
  'MeshBasicMaterial',    'MeshLambertMaterial',
  'MeshPhongMaterial',    'MeshToonMaterial',
  'MeshMatcapMaterial',   'SpriteMaterial', 'PointsMaterial',
]);

// Pull every glyph from the central Phosphor-style icon set in
// icons.js so every surface shares one stroke weight, viewBox, and
// rounded-cap convention. Each constant is just markup string the
// existing template-literal HTML below can drop in unchanged.
const ICON_MOVE    = icons.arrowsOut;
const ICON_ROTATE  = icons.arrowClockwise;
const ICON_SCALE   = icons.resize;
const ICON_CAMERA  = icons.camera;
const ICON_UV      = icons.gridFour;
const ICON_NORMALS = icons.normalsArrow;
const ICON_DEPTH   = icons.cubeTransparent;
const ICON_WIRE    = icons.wireframe;

// Normalize any CSS color string (#rgb, #rrggbb, rgb(), rgba(), hsl(),
// named colors like "rebeccapurple") into a #rrggbb hex string the
// color-picker control understands. Returns null for anything that
// isn't a valid color.
//
// The trick: assign the string to a canvas context's fillStyle twice,
// seeded from two different known-good colors. The browser only mutates
// fillStyle if the assignment parsed as a real color; if BOTH seeds end
// up identical, the input was a valid color and we read back its
// canonical form. If the seeds diverge, the string was rejected (so we
// bail) — this rejects bogus values like "banana" or "12px" that a
// single-seed check would silently let through as the seed color.
let _colorCtx = null;
function cssColorToHex(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  // Fast path: already a 3/6-digit hex.
  const bare = str.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(bare) || /^[0-9a-fA-F]{6}$/.test(bare)) {
    return '#' + (bare.length === 3
      ? bare.split('').map(c => c + c).join('')
      : bare).toLowerCase();
  }
  try {
    if (!_colorCtx) {
      const canvas = typeof document !== 'undefined'
        ? document.createElement('canvas') : null;
      if (!canvas) return null;
      _colorCtx = canvas.getContext('2d');
    }
    if (!_colorCtx) return null;
    _colorCtx.fillStyle = '#000';
    _colorCtx.fillStyle = str;
    const black = _colorCtx.fillStyle;
    _colorCtx.fillStyle = '#fff';
    _colorCtx.fillStyle = str;
    const white = _colorCtx.fillStyle;
    if (black !== white) return null; // string was rejected by the parser
    // black is now either "#rrggbb" or "rgba(r, g, b, a)".
    if (black.startsWith('#')) return black.toLowerCase();
    const m = black.match(/^rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map(s => parseFloat(s.trim()));
    const [r, g, b] = parts;
    if ([r, g, b].some(n => Number.isNaN(n))) return null;
    const hx = n => Math.max(0, Math.min(255, Math.round(n)))
      .toString(16).padStart(2, '0');
    return '#' + hx(r) + hx(g) + hx(b);
  } catch {
    return null;
  }
}

export function attachContextualInspector(ui, opts = {}) {
  if (!ui.objectManager) return null;

  /**
   * Property-write helper used by every panel folder (Properties, Light,
   * Camera, Typography, Material). Captures the prior value, performs
   * the write, then pushes a propEdit onto the undo stack so Cmd+Z
   * reverts it. UndoStack coalesces successive writes on the same
   * (object, prop) pair within ~350ms, so a slider drag → one entry.
   */
  function commitProp(object, key, value, label) {
    if (!object) return;
    const before = object[key];
    if (before === value) return;
    object[key] = value;
    ui._undo?.push(UndoStack.propEdit(object, key, before, value, label || `edit ${key}`));
  }

  // Like commitProp, but writes several keys atomically under a SINGLE undo
  // entry. The promoted Dimensions and Corner-radius widgets each touch
  // multiple properties at once (width+height; the uniform radius plus four
  // per-corner values) — without this they wrote straight to the object and
  // were silently absent from the undo stack, so Cmd+Z reverted an opacity or
  // fill tweak but did nothing for a resize or a corner-radius change.
  function commitProps(object, changes, label) {
    if (!object || !changes || !changes.length) return;
    const entries = changes.map(c => ({ key: c.key, from: object[c.key], to: c.value }));
    if (!entries.some(e => e.from !== e.to)) return;  // no-op write
    entries.forEach(e => { object[e.key] = e.to; });
    ui._undo?.push({
      label: label || 'edit',
      undo: () => { entries.forEach(e => { object[e.key] = e.from; }); },
      redo: () => { entries.forEach(e => { object[e.key] = e.to; }); },
    });
  }

  // ── Mode toolbar (pinned to Inspector left edge) ──
  // Three rows — Move / Rotate / Scale — each row is an icon button plus
  // three tiny X/Y/Z numeric inputs that read and write the live transform.
  // Hidden until something is selected. The footprint stays minimal: a single
  // vertical strip ~150px wide.
  const toolbar = document.createElement('div');
  toolbar.className = 'dui-context-toolbar';

  const ROWS_3D = [
    { mode: 'translate', icon: ICON_MOVE,   tip: 'Move (G)',   prop: 'position', step: 0.01, suffix: '' },
    { mode: 'rotate',    icon: ICON_ROTATE, tip: 'Rotate (R)', prop: 'rotation', step: 1,    suffix: '°' },
    { mode: 'scale',     icon: ICON_SCALE,  tip: 'Scale (S)',  prop: 'scale',    step: 0.01, suffix: '' },
  ];

  // 2D rows mirror the same 3-row layout but bind to flat numeric properties
  // common on Canvas2D / SVG / ASCII hosts. Unused cells are kept as hidden
  // placeholders so the column widths line up with the 3D variant.
  const ROWS_2D = [
    { mode: 'translate', icon: ICON_MOVE,   tip: 'Move (G)',
      cells: [
        { prop: 'x', step: 1, suffix: '' },
        { prop: 'y', step: 1, suffix: '' },
        null,
      ] },
    { mode: 'rotate',    icon: ICON_ROTATE, tip: 'Rotate (R)',
      cells: [
        { prop: 'rotation', step: 1, suffix: '°' },
        null,
        null,
      ] },
    { mode: 'scale',     icon: ICON_SCALE,  tip: 'Scale (S)',
      // 'radius' for circles, 'width'/'height' for rects — populated per
      // selection by syncInputs(). Both layouts are kept in the DOM; the
      // unused inputs simply hide.
      cells: [
        { prop: 'radius', altProp: 'width',  step: 1, suffix: '' },
        { prop: null,     altProp: 'height', step: 1, suffix: '' },
        null,
      ] },
  ];

  // axisCell — wraps an <input> with a small colored axis tag (X red /
  // Y green / Z blue) so the row reads "X 2.000  Y 0.800  Z 0.000". For
  // 2D rows the tag is computed per-cell (X/Y/W/H/° as appropriate).
  function axisCell(input, label, axisClass) {
    return `<span class="dui-axis-cell">
      <span class="dui-axis-tag ${axisClass}">${label}</span>
      ${input}
    </span>`;
  }

  const rows3d = document.createElement('div');
  rows3d.className = 'dui-context-rows dui-context-rows-3d';
  rows3d.innerHTML = ROWS_3D.map(r => `
    <div class="dui-context-row">
      <button data-mode="${r.mode}" data-tooltip="${r.tip}" class="dui-context-btn">${r.icon}</button>
      ${['x','y','z'].map(ax => axisCell(
        `<input class="dui-context-num" data-prop="${r.prop}" data-axis="${ax}" data-step="${r.step}" data-suffix="${r.suffix}" />`,
        ax.toUpperCase(),
        `dui-axis-${ax}`,
      )).join('')}
    </div>
  `).join('') + `
    <!-- The "look through camera" toggle now lives on the camera's row in
         the Outliner (next to the eye/delete icons), where it sits closer
         to the rest of the camera affordances and stops crowding the
         mini toolbar with a button most selections can't use. -->
    <!-- Material visualization row: UV / Normals / Depth / Wireframe.
         Each button swaps the selected mesh's material to a debug variant
         (stashing the original on userData.__origMaterial). Wireframe is
         an independent toggle on whatever material is currently active. -->
    <div class="dui-context-row dui-context-row-utility dui-context-row-debug">
      <button class="dui-context-btn dui-context-debug" data-debug="uv"
              data-tooltip="Show UV coordinates">${ICON_UV}</button>
      <button class="dui-context-btn dui-context-debug" data-debug="normals"
              data-tooltip="Show surface normals">${ICON_NORMALS}</button>
      <button class="dui-context-btn dui-context-debug" data-debug="depth"
              data-tooltip="Show depth buffer">${ICON_DEPTH}</button>
      <button class="dui-context-btn dui-context-debug" data-debug="wireframe"
              data-tooltip="Wireframe overlay">${ICON_WIRE}</button>
    </div>
  `;

  // 2D row labels — each toolbar mode picks the right axis tags so the
  // user always knows which property the input drives.
  const TAGS_2D = {
    translate: [{ tag: 'X', cls: 'dui-axis-x' }, { tag: 'Y', cls: 'dui-axis-y' }, null],
    rotate:    [{ tag: '°', cls: 'dui-axis-rot' }, null, null],
    scale:     [{ tag: 'W', cls: 'dui-axis-x' }, { tag: 'H', cls: 'dui-axis-y' }, null],
  };
  // Compact alignment SVGs — 6 buttons spanning horizontal + vertical
  // canvas-relative alignment (Figma's left/center/right + top/middle/bottom).
  // Canvas-relative alignment (frame-with-children glyphs from the
  // shared Phosphor-style icon set, so they match the rest of the panel).
  const ICON_AL_LEFT   = icons.alignFrameLeft;
  const ICON_AL_CENTER = icons.alignFrameCenterH;
  const ICON_AL_RIGHT  = icons.alignFrameRight;
  const ICON_AL_TOP    = icons.alignFrameTop;
  const ICON_AL_MIDDLE = icons.alignFrameCenterV;
  const ICON_AL_BOTTOM = icons.alignFrameBottom;
  const ALIGN_BUTTONS = [
    ['left',   ICON_AL_LEFT,   'Align to left'],
    ['cx',     ICON_AL_CENTER, 'Center horizontally'],
    ['right',  ICON_AL_RIGHT,  'Align to right'],
    ['top',    ICON_AL_TOP,    'Align to top'],
    ['cy',     ICON_AL_MIDDLE, 'Center vertically'],
    ['bottom', ICON_AL_BOTTOM, 'Align to bottom'],
  ];

  const rows2d = document.createElement('div');
  rows2d.className = 'dui-context-rows dui-context-rows-2d';
  rows2d.innerHTML = ROWS_2D.map(r => {
    const tags = TAGS_2D[r.mode] || [null, null, null];
    return `
    <div class="dui-context-row">
      <button data-mode="${r.mode}" data-tooltip="${r.tip}" class="dui-context-btn">${r.icon}</button>
      ${r.cells.map((c, i) => {
        if (!c) return `<input class="dui-context-num dui-context-num-placeholder" disabled tabindex="-1" />`;
        const tag = tags[i];
        const inputHtml = `<input class="dui-context-num dui-context-num-2d" data-prop="${c.prop ?? ''}" data-alt-prop="${c.altProp ?? ''}" data-step="${c.step}" data-suffix="${c.suffix}" />`;
        return tag ? axisCell(inputHtml, tag.tag, tag.cls) : inputHtml;
      }).join('')}
    </div>`;
  }).join('') + `
    <!-- Alignment row — Figma-style 6 buttons that snap the selected object
         to canvas/viewport edges or center. Bound below. -->
    <div class="dui-context-row dui-context-row-align">
      ${ALIGN_BUTTONS.map(([id, svg, tip]) => `
        <button class="dui-context-btn dui-context-align" data-align="${id}"
                data-tooltip="${tip}">${svg}</button>
      `).join('')}
    </div>
  `;

  // Collapse handle sits on the LEFT edge of the toolbar (a thin vertical
  // bar). Clicking toggles `.dui-context-toolbar-collapsed`. The collapse
  // animates horizontally — the rows wrap shrinks to max-width: 0 + fades.
  // Because the toolbar is right-anchored to the Inspector's outer-left
  // edge (see reposition()), shrinking the width causes the visible chrome
  // to slide rightward toward the panel, leaving only the chevron.
  const collapseHandle = document.createElement('button');
  collapseHandle.className = 'dui-context-collapse';
  collapseHandle.dataset.tooltip = 'Collapse toolbar';
  // Chevron points RIGHT when the toolbar is open (click → collapses toward
  // the panel on the right). Rotated 180° via CSS when collapsed → ◀ left,
  // signaling "click to expand back out".
  collapseHandle.innerHTML = icons.caretRight;
  collapseHandle.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = toolbar.classList.toggle('dui-context-toolbar-collapsed');
    collapseHandle.dataset.tooltip = collapsed ? 'Expand toolbar' : 'Collapse toolbar';
  });
  // Inner wrapper holds the actual rows so the collapse animation can
  // target a single max-width + opacity on this element instead of
  // every row independently.
  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'dui-context-toolbar-rows';
  rowsWrap.appendChild(rows3d);
  rowsWrap.appendChild(rows2d);
  // DOM order matters: handle FIRST so it sits at the left edge.
  toolbar.appendChild(collapseHandle);
  toolbar.appendChild(rowsWrap);
  // Mounted at body-level so the panel's backdrop-filter doesn't clip it
  // (Chromium/Webkit contain absolutely-positioned descendants of
  // backdrop-filtered elements to the parent's box). We follow the panel
  // ourselves each frame via reposition() — same observable behavior the
  // user wants, just without the stacking-context limitation.
  document.body.appendChild(toolbar);

  function reposition() {
    const r = ui.panel.element.getBoundingClientRect();
    toolbar.style.top  = `${r.top + 8}px`;
    toolbar.style.left = `${r.left - toolbar.offsetWidth - 8}px`;
  }
  // Follow the panel *event-driven* rather than via a perpetual rAF loop. The
  // old approach called getBoundingClientRect + two style writes every single
  // frame forever — burning the main thread (and defeating frame idling) even
  // when nothing moved. Instead we reposition only when something actually
  // changes, and coalesce bursts (a drag fires many style mutations per frame)
  // into a single layout read/write via a one-shot rAF flag.
  //
  //   • Panel drag / collapse  → inline style + class mutations on the panel
  //                              element  → MutationObserver.
  //   • Panel drag-resize / content growth, and the toolbar's OWN collapse
  //     animation (its width shrinks over several frames)  → ResizeObserver.
  //   • Window resize          → resize listener.
  //
  // reposition() only writes the toolbar's *position* (top/left), never its
  // size or the panel's attributes, so it can't re-trigger either observer —
  // no feedback loop. The toolbar is position:fixed, so page scroll never
  // drifts it and needs no listener.
  let _repoQueued = false;
  function scheduleReposition() {
    if (_repoQueued) return;
    _repoQueued = true;
    requestAnimationFrame(() => { _repoQueued = false; reposition(); });
  }
  reposition(); // initial placement
  const _panelMO = new MutationObserver(scheduleReposition);
  _panelMO.observe(ui.panel.element, { attributes: true, attributeFilter: ['style', 'class'] });
  const _toolbarRO = new ResizeObserver(scheduleReposition);
  _toolbarRO.observe(ui.panel.element);
  _toolbarRO.observe(toolbar);
  addEventListener('resize', scheduleReposition);

  // Camera toggle (3D-only) — sets `ui._activeCamera`, which host render
  // loops can read each frame. Defaults to falsy → host uses its original
  // camera. Toggling on a selected Camera makes the renderer look through
  // it; toggling again restores the original.
  // Floating viewport badge — surfaces "Camera: <name>" whenever the user
  // is rendering through a non-default camera. Click it to bail out.
  const camBadge = document.createElement('div');
  camBadge.className = 'dui-camera-badge';
  camBadge.style.display = 'none';
  camBadge.innerHTML = `
    <span class="dui-camera-badge-dot"></span>
    <span class="dui-camera-badge-label">Camera</span>
    <button class="dui-camera-badge-grid" data-tooltip="Toggle composition guides">
      <svg viewBox="0 0 256 256" width="14" height="14" fill="none" stroke="currentColor"
           stroke-width="16" stroke-linecap="round" stroke-linejoin="round">
        <rect x="40" y="40" width="176" height="176"/>
        <line x1="40" y1="98.7" x2="216" y2="98.7"/>
        <line x1="40" y1="157.3" x2="216" y2="157.3"/>
        <line x1="98.7" y1="40" x2="98.7" y2="216"/>
        <line x1="157.3" y1="40" x2="157.3" y2="216"/>
      </svg>
    </button>
    <button class="dui-camera-badge-exit" data-tooltip="Exit camera view">×</button>
  `;
  document.body.appendChild(camBadge);

  // Composition grid overlay — fixed-position SVG drawn on top of the
  // viewport when the user toggles guides on. Rule-of-thirds (2 vert +
  // 2 horiz) + a small center crosshair are the most useful composition
  // primitives borrowed from photography / cinematography. Pointer
  // events are off so it never blocks orbiting / clicking under it.
  const camGrid = document.createElement('div');
  camGrid.className = 'dui-camera-grid';
  camGrid.style.display = 'none';
  camGrid.innerHTML = `
    <svg viewBox="0 0 300 200" preserveAspectRatio="none">
      <line x1="100" y1="0" x2="100" y2="200" />
      <line x1="200" y1="0" x2="200" y2="200" />
      <line x1="0" y1="66.66" x2="300" y2="66.66" />
      <line x1="0" y1="133.33" x2="300" y2="133.33" />
      <line x1="150" y1="92" x2="150" y2="108" />
      <line x1="142" y1="100" x2="158" y2="100" />
    </svg>
  `;
  document.body.appendChild(camGrid);
  // Default: guides OFF — entering a POV camera should feel like dropping
  // into the shot, not a measuring overlay. The user opts in via the grid
  // icon on the badge when they want rule-of-thirds for framing.
  let camGridOn = false;
  function syncCamGridButton() {
    camBadge.querySelector('.dui-camera-badge-grid')
      ?.classList.toggle('dui-active', camGridOn);
  }
  function updateCameraGrid() {
    const showing = !!ui._activeCamera && camGridOn;
    camGrid.style.display = showing ? '' : 'none';
  }
  function updateCameraBadge() {
    const cam = ui._activeCamera;
    if (cam) {
      camBadge.style.display = 'flex';
      camBadge.querySelector('.dui-camera-badge-label').textContent =
        cam.name ? `Camera · ${cam.name}` : 'Camera view';
    } else {
      camBadge.style.display = 'none';
    }
    syncCamGridButton();
    updateCameraGrid();
  }
  camBadge.querySelector('.dui-camera-badge-grid').addEventListener('click', (e) => {
    e.stopPropagation();
    camGridOn = !camGridOn;
    syncCamGridButton();
    updateCameraGrid();
  });
  // Camera "look-through" — physically snaps the main viewport camera to
  // the target camera's transform + projection. OrbitControls keeps driving
  // the SAME main camera (so the user can still orbit), but its position,
  // rotation, FOV, near/far, and aspect now match the POV exactly. On exit
  // we restore the main camera's original state.
  //
  // Why not swap controls.object? OrbitControls.update() rewrites object
  // position from its internal spherical state on every frame, which would
  // immediately yank the POV camera back to the old orbit anchor. Snapping
  // the main camera sidesteps that entirely.
  // Find the registered CameraHelper for a given THREE.Camera (or null).
  // The object manager indexes by name, so we walk entries to find the
  // one whose cameraRef matches. Used to hide the POV camera's own
  // frustum lines while we're looking through it — otherwise its near-
  // plane crosshair sits dead-center in the viewport.
  function _helperForCamera(cam) {
    const objs = ui.objectManager?.objects || {};
    for (const k of Object.keys(objs)) {
      const e = objs[k];
      if (e?.helper && (e.cameraRef === cam || e.object === cam)) return e.helper;
    }
    return null;
  }

  function setActiveCamera(cam) {
    const prev = ui._activeCamera;
    const main = ui.objectManager?.camera;
    const controls = ui.objectManager?.orbitControls;
    if (!main) { ui._activeCamera = cam; if (!cam && prev) updateCameraBadge(); return; }

    // Toggle helper visibility — the POV camera's own frustum is sitting
    // right where we are now, so its near-plane crosshair would draw a
    // big cross through the center of the viewport. Stash visibility so
    // we restore it on exit.
    if (prev && ui._prevHelperVisible !== undefined) {
      const prevHelper = _helperForCamera(prev);
      if (prevHelper) prevHelper.visible = ui._prevHelperVisible;
      ui._prevHelperVisible = undefined;
    }
    if (cam) {
      const h = _helperForCamera(cam);
      if (h) {
        ui._prevHelperVisible = h.visible;
        h.visible = false;
      }
    }

    // Entering: stash main's state so we can restore on exit.
    if (cam && !prev) {
      ui._mainCameraSaved = {
        position:    main.position.clone(),
        quaternion:  main.quaternion.clone(),
        target:      controls?.target?.clone?.() || null,
        fov:         main.fov,
        near:        main.near,
        far:         main.far,
        zoom:        main.zoom,
      };
    }

    if (cam) {
      // Snap main → cam transform.
      main.position.copy(cam.position);
      main.quaternion.copy(cam.quaternion);
      if (cam.isPerspectiveCamera && main.isPerspectiveCamera) {
        main.fov  = cam.fov;
        main.near = cam.near;
        main.far  = cam.far;
      }
      if ('zoom' in cam && 'zoom' in main) main.zoom = cam.zoom;
      main.updateProjectionMatrix?.();
      main.updateMatrixWorld?.(true);
      // Point OrbitControls' pivot at whatever the cam is looking at, ~5
      // units along its forward — feels like the user dropped into POV
      // and can keep orbiting from there.
      if (controls) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const pivot = cam.position.clone().add(fwd.multiplyScalar(5));
        controls.target.copy(pivot);
        controls.update?.();
      }
    } else if (prev && ui._mainCameraSaved) {
      // Exiting — restore main's transform + projection.
      const s = ui._mainCameraSaved;
      main.position.copy(s.position);
      main.quaternion.copy(s.quaternion);
      if (s.fov !== undefined) main.fov = s.fov;
      if (s.near !== undefined) main.near = s.near;
      if (s.far  !== undefined) main.far  = s.far;
      if (s.zoom !== undefined) main.zoom = s.zoom;
      main.updateProjectionMatrix?.();
      main.updateMatrixWorld?.(true);
      if (controls && s.target) {
        controls.target.copy(s.target);
        controls.update?.();
      }
      ui._mainCameraSaved = null;
    }

    ui._activeCamera = cam;
    // Always refresh the badge — on enter (show), on exit (hide), and
    // on swap-between-cameras (re-label). Previously this only fired on
    // exit, so the public `ui.setActiveCamera(cam)` call would never
    // show the badge.
    updateCameraBadge();
  }

  camBadge.querySelector('.dui-camera-badge-exit').addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveCamera(null);
    updateCameraBadge();
    syncCamButton();
    // Reflect the bail-out in the outliner so the focus icon untoggles.
    ui.refreshSceneObjects?.();
  });

  // The "look through camera" toggle now lives on the Outliner row for
  // the camera itself. Expose the snap/restore helpers two ways:
  //   • on `ui` for external callers
  //   • on `ui.objectManager` so the outliner (which is built before `ui`
  //     exists) can reach the toggle without taking a circular dep
  ui.setActiveCamera = setActiveCamera;
  ui.toggleActiveCamera = (cam) => {
    if (!cam) return;
    setActiveCamera(ui._activeCamera === cam ? null : cam);
    updateCameraBadge();
    ui.refreshSceneObjects?.();
  };
  if (ui.objectManager) {
    ui.objectManager._activeCameraRef     = () => ui._activeCamera || null;
    ui.objectManager._toggleActiveCamera  = (cam) => ui.toggleActiveCamera(cam);

    // If the user deletes the camera they're currently looking through,
    // exit POV first — otherwise `ui._activeCamera` keeps pointing at a
    // dead object, the badge stays stuck visible, and the main camera
    // never restores its pre-POV transform. The 'remove' event fires
    // with both name + the actual object reference; match on either.
    ui.objectManager.on?.('remove', (_name, removed) => {
      const active = ui._activeCamera;
      if (!active) return;
      const isSameCam = removed === active ||
                        (removed && removed.userData?.__duiCameraRef === active) ||
                        (active.userData?.__duiCameraRef === removed);
      if (isSameCam) setActiveCamera(null);
    });
  }
  // No-op shim so existing call sites (sync loop below) don't have to
  // branch on whether the toolbar still has a camera button.
  function syncCamButton() {}

  // Material visualization buttons — replicate the old Debug folder logic.
  // UV / Normals / Depth swap the mesh's material; toggling one clears the
  // others. Wireframe is independent (flips `mat.wireframe`).
  const DEBUG_MODES = ['uv', 'normals', 'depth'];
  const debugBtns = Array.from(rows3d.querySelectorAll('.dui-context-debug'));
  function selectedMeshLive() {
    const n = ui.objectManager?.activeName;
    const o = n ? ui.objectManager.getObject(n) : null;
    return o?.isMesh ? o : null;
  }
  async function setDebugMode(mode, on) {
    const mesh = selectedMeshLive();
    if (!mesh) return;
    if (!mesh.userData.__origMaterial) mesh.userData.__origMaterial = mesh.material;
    if (!on) {
      if (mesh.userData.__debugMode === mode) {
        mesh.material = mesh.userData.__origMaterial;
        mesh.userData.__debugMode = null;
      }
      return;
    }
    let mat;
    if (mode === 'normals') mat = new THREE.MeshNormalMaterial();
    else if (mode === 'depth') mat = new THREE.MeshDepthMaterial();
    else if (mode === 'uv') mat = new THREE.ShaderMaterial({
      vertexShader:   'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ gl_FragColor=vec4(vUv,0.0,1.0); }',
    });
    if (mat) {
      mesh.material = mat;
      mesh.userData.__debugMode = mode;
    }
    syncDebugButtons();
  }
  function setWireframe(on) {
    const mesh = selectedMeshLive();
    const mat = mesh?.material;
    if (mat && 'wireframe' in mat) mat.wireframe = !!on;
    syncDebugButtons();
  }
  function syncDebugButtons() {
    const mesh = selectedMeshLive();
    const mode = mesh?.userData?.__debugMode || null;
    const wire = !!mesh?.material?.wireframe;
    debugBtns.forEach(b => {
      const d = b.dataset.debug;
      const active = d === 'wireframe' ? wire : d === mode;
      b.classList.toggle('dui-active', active);
      b.disabled = !mesh;
    });
  }
  debugBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.dataset.debug;
      const mesh = selectedMeshLive();
      if (!mesh) return;
      if (mode === 'wireframe') { setWireframe(!mesh.material?.wireframe); return; }
      // Mutually exclusive vis modes — clicking the active one clears it.
      const wasActive = mesh.userData?.__debugMode === mode;
      DEBUG_MODES.forEach(m => { if (m !== mode) setDebugMode(m, false); });
      setDebugMode(mode, !wasActive);
    });
  });

  // Active-mode button click — 3D path switches gizmo mode, 2D path kicks
  // off a Modal2DTransform session (mouse-follow) when the integration is
  // wired. Both paths update the active-button visual state.
  rows3d.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.objectManager.setMode?.(btn.dataset.mode);
      rows3d.querySelectorAll('button[data-mode]').forEach(b =>
        b.classList.toggle('dui-active', b === btn));
    });
  });
  rows2d.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const m2d = opts.modal2d || ui._modal2DTransform;
      const name = ui.objectManager?.activeName;
      const obj = name ? ui.objectManager.getObject(name) : null;
      if (m2d && obj && 'x' in obj && 'y' in obj) {
        m2d.begin(btn.dataset.mode, obj);
      }
      rows2d.querySelectorAll('button[data-mode]').forEach(b =>
        b.classList.toggle('dui-active', b === btn));
    });
  });

  // Alignment row — snap the selected object to canvas/viewport edges or
  // center. Uses the object's bbox (width/height for rects, radius*2 for
  // circles, the live DOM rect for web adapters) and the host canvas size.
  rows2d.querySelectorAll('.dui-context-align').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const om = ui.objectManager;
      const obj = om?.activeName ? om.getObject(om.activeName) : null;
      if (!obj || !('x' in obj && 'y' in obj)) return;
      const bb = bboxOf(obj);
      const viewport = canvasBounds();
      const target = btn.dataset.align;
      const before = { x: obj.x, y: obj.y };
      if (target === 'left')   obj.x = viewport.x - bb.minX;
      if (target === 'right')  obj.x = viewport.x + viewport.w - bb.maxX;
      if (target === 'cx')     obj.x = viewport.x + (viewport.w - bb.w) / 2 - bb.minX + obj.x;
      if (target === 'top')    obj.y = viewport.y - bb.minY;
      if (target === 'bottom') obj.y = viewport.y + viewport.h - bb.maxY;
      if (target === 'cy')     obj.y = viewport.y + (viewport.h - bb.h) / 2 - bb.minY + obj.y;
      ui._undo?.push(UndoStack.propEdit(obj, 'x', before.x, obj.x, `align ${om.activeName}`));
      // Brief flash so the user knows the button fired.
      btn.classList.add('dui-context-align-pulse');
      setTimeout(() => btn.classList.remove('dui-context-align-pulse'), 220);
    });
  });
  // Compute bbox of any 2D / web target in canvas/viewport coordinates.
  function bboxOf(obj) {
    // Web adapter — its DOM element's bounding rect is authoritative.
    if (obj._el) {
      const r = obj._el.getBoundingClientRect();
      return { minX: r.left, minY: r.top, maxX: r.right, maxY: r.bottom, w: r.width, h: r.height };
    }
    // Canvas2D circle (anchor at center, radius defines bbox).
    if (typeof obj.radius === 'number') {
      const r = obj.radius;
      return { minX: obj.x - r, minY: obj.y - r, maxX: obj.x + r, maxY: obj.y + r, w: r * 2, h: r * 2 };
    }
    // Canvas2D rect (anchor at center, width/height define bbox).
    if (typeof obj.width === 'number' && typeof obj.height === 'number') {
      const w = obj.width, h = obj.height;
      return { minX: obj.x - w/2, minY: obj.y - h/2, maxX: obj.x + w/2, maxY: obj.y + h/2, w, h };
    }
    return { minX: obj.x, minY: obj.y, maxX: obj.x, maxY: obj.y, w: 0, h: 0 };
  }
  function canvasBounds() {
    // Prefer the host's primary canvas if one exists; else fall back to
    // the visible viewport (useful for web demos where elements are placed
    // on the document body).
    const c = document.querySelector('canvas');
    if (c) {
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  }

  // ── Live numeric inputs: read live values, write on edit ──
  const inputs = Array.from(toolbar.querySelectorAll('.dui-context-num'))
    .filter(i => !i.classList.contains('dui-context-num-placeholder'));

  function isXYZInput(inp)  { return !!inp.dataset.axis; }
  function effectiveProp(inp, obj) {
    // 2D cells. Two regimes:
    //   • Cells WITHOUT altProp (move row x/y, rotate row rotation): always
    //     usable — return the configured prop. The commit path handles
    //     creating the property on the object if it didn't exist (e.g.
    //     a circle gets `rotation` added the first time the user types).
    //   • Cells WITH altProp (scale row): swap between `prop` and `altProp`
    //     depending on which key the live target exposes. Return null when
    //     neither applies so the cell can be hidden entirely.
    const altProp = inp.dataset.altProp;
    const prop = inp.dataset.prop;
    if (altProp) {
      if (prop && obj && prop in obj)        return prop;
      if (obj && altProp in obj)             return altProp;
      return null;
    }
    return prop || null;
  }
  function fmt(n, prop) {
    if (!Number.isFinite(n)) return '';
    if (prop === 'rotation') return (n * 180 / Math.PI).toFixed(1);
    return n.toFixed(3);
  }
  function parseNum(s, prop, fallback) {
    const v = parseFloat(s);
    if (!Number.isFinite(v)) return fallback;
    return prop === 'rotation' ? (v * Math.PI / 180) : v;
  }

  // Refresh values from the live object (called every frame via ui.update())
  function syncInputs() {
    const name = ui.objectManager?.activeName;
    if (!name) return;
    const obj = ui.objectManager.getObject(name);
    if (!obj) return;
    for (const inp of inputs) {
      if (inp === document.activeElement) continue; // don't clobber while typing
      let v;
      if (isXYZInput(inp)) {
        v = obj[inp.dataset.prop]?.[inp.dataset.axis];
      } else {
        const prop = effectiveProp(inp, obj);
        // Hide the entire chip (axis tag + input) when this cell has no
        // applicable property — that way the user doesn't see an orphan
        // "H" or "°" tag next to a blank field on shapes that don't use it.
        const cell = inp.closest('.dui-axis-cell') || inp;
        cell.style.display = prop ? '' : 'none';
        if (prop) v = obj[prop];
      }
      if (typeof v === 'number') {
        // Guard the write so we don't reset the field (or thrash aria-valuenow)
        // every frame when the value hasn't moved — a small per-frame saving on
        // top of keeping the spinbutton's announced value in sync for AT.
        const nv = fmt(v, inp.dataset.prop);
        if (inp.value !== nv) inp.value = nv;
        if (inp.getAttribute('aria-valuenow') !== nv) inp.setAttribute('aria-valuenow', nv);
        // A good live value landed in the field — drop any lingering invalid
        // state from an earlier rejected commit. syncInputs skips the focused
        // input, so this only fires once focus has left, restoring the field.
        if (inp.getAttribute('aria-invalid') === 'true') {
          inp.removeAttribute('aria-invalid');
          if (inp._a11yMsg) inp._a11yMsg.textContent = '';
        }
      }
      else if (!isXYZInput(inp) && v === undefined) inp.value = '';
    }
  }

  // ── Accessibility wiring for the numeric chips ──
  // Each chip is a bare <input> with only a colored letter tag next to it —
  // sighted users read "X 2.000" but a screen reader just hears "edit text".
  // Give every input a spinbutton role + a derived name ("Move X",
  // "Rotate degrees", "Scale W") and an SR-only live region so rejected
  // edits (NaN) are announced rather than silently reverted.
  let _axisMsgSeq = 0;
  function setupAxisA11y(inp) {
    const row = inp.closest('.dui-context-row');
    const modeRaw = row?.querySelector('[data-mode]')?.dataset.tooltip || '';
    const mode = modeRaw.replace(/\s*\(.*\)\s*$/, '').trim(); // "Move (G)" → "Move"
    const cell = inp.closest('.dui-axis-cell');
    const axisText = cell?.querySelector('.dui-axis-tag')?.textContent?.trim() || '';
    const isDeg = inp.dataset.suffix === '°' || axisText === '°';
    // Keep the axis letter (X/Y/Z/W/H) in the name — the three rotation fields
    // share a "°" suffix but must stay distinguishable to AT ("Rotate X" vs
    // "Rotate Y"). The bare "°" tag (2D single-rotation row) has no letter, so
    // it collapses to just "Rotate (degrees)".
    const axisLetter = axisText && axisText !== '°' ? axisText : '';
    const base = [mode, axisLetter].filter(Boolean).join(' ');
    const label = (isDeg ? `${base} (degrees)`.trim() : base) || 'value';
    inp.setAttribute('role', 'spinbutton');
    inp.setAttribute('aria-label', label);
    const msg = document.createElement('span');
    const uid = `dui-ctxnum-${++_axisMsgSeq}`;
    msg.id = uid;
    msg.className = 'dui-field-msg';
    msg.setAttribute('aria-live', 'polite');
    inp.setAttribute('aria-describedby', uid);
    (cell || inp.parentNode)?.appendChild(msg);
    // Editing again clears the rejected-value state immediately.
    inp.addEventListener('input', () => {
      if (inp.getAttribute('aria-invalid') === 'true') {
        inp.removeAttribute('aria-invalid');
        msg.textContent = '';
      }
    });
    inp._a11yMsg = msg;
    return msg;
  }

  // Write input → object
  inputs.forEach(inp => {
    const a11yMsg = setupAxisA11y(inp);
    const commit = () => {
      // Validate the raw text up front so a non-numeric entry is announced to
      // AT and visibly flagged (red ring) before the change/clamp logic — which
      // would otherwise just silently revert it via the next syncInputs tick.
      const rawText = inp.value;
      if (rawText.trim() !== '' && !Number.isFinite(parseFloat(rawText))) {
        inp.setAttribute('aria-invalid', 'true');
        a11yMsg.textContent = 'Not a number — reverted.';
      } else if (inp.getAttribute('aria-invalid') === 'true') {
        inp.removeAttribute('aria-invalid');
        a11yMsg.textContent = '';
      }
      const name = ui.objectManager?.activeName;
      if (!name) return;
      const obj = ui.objectManager.getObject(name);
      if (!obj) return;
      if (isXYZInput(inp)) {
        if (!obj[inp.dataset.prop]) return;
        const cur = obj[inp.dataset.prop][inp.dataset.axis];
        const next = parseNum(inp.value, inp.dataset.prop, cur);
        if (next === cur) return;
        obj[inp.dataset.prop][inp.dataset.axis] = next;
        if (inp.dataset.prop === 'rotation' && obj.rotation?.isEuler) {
          obj.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order);
        }
        inp.value = fmt(next, inp.dataset.prop);
        ui._undo?.push({
          ...UndoStack.nestedPropEdit(obj, inp.dataset.prop, inp.dataset.axis, cur, next,
            `edit ${name}.${inp.dataset.prop}.${inp.dataset.axis}`),
          // Re-clamp Euler after restoring (matches commit-time write)
          redo() { obj[inp.dataset.prop][inp.dataset.axis] = next;
            if (inp.dataset.prop === 'rotation' && obj.rotation?.isEuler) {
              obj.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order);
            } },
          undo() { obj[inp.dataset.prop][inp.dataset.axis] = cur;
            if (inp.dataset.prop === 'rotation' && obj.rotation?.isEuler) {
              obj.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order);
            } },
        });
        return;
      }
      // 2D flat-property path. Cells without altProp can create the
      // property on first commit (e.g. typing into the rotate row on a
      // newly-spawned circle adds `circle.rotation = <radians>`).
      const prop = effectiveProp(inp, obj);
      if (!prop) return;
      const cur = prop in obj ? obj[prop] : 0;
      const next = parseNum(inp.value, inp.dataset.prop, cur);
      if (next === cur && prop in obj) return;
      obj[prop] = next;
      inp.value = fmt(next, inp.dataset.prop);
      ui._undo?.push(UndoStack.propEdit(obj, prop, cur, next, `edit ${name}.${prop}`));
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => {
      const step = parseFloat(inp.dataset.step) || 0.01;
      if (e.key === 'Enter')    { inp.blur(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); inp.value = (parseFloat(inp.value || '0') + step).toFixed(3); commit(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); inp.value = (parseFloat(inp.value || '0') - step).toFixed(3); commit(); }
    });
    // Drag-to-scrub (click + drag horizontally on the input)
    let dragging = false, startX = 0, startVal = 0;
    inp.addEventListener('pointerdown', (e) => {
      if (document.activeElement === inp) return; // editing — let normal text selection work
      dragging = true;
      startX = e.clientX;
      startVal = parseFloat(inp.value || '0') || 0;
      inp.setPointerCapture(e.pointerId);
      inp.classList.add('dui-context-num-drag');
    });
    inp.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const step = parseFloat(inp.dataset.step) || 0.01;
      const dx = e.clientX - startX;
      inp.value = (startVal + dx * step).toFixed(3);
      commit();
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { inp.releasePointerCapture(e.pointerId); } catch (e) { log.debug('contextual', 'releasePointerCapture failed:', e); }
      inp.classList.remove('dui-context-num-drag');
    };
    inp.addEventListener('pointerup', endDrag);
    inp.addEventListener('pointercancel', endDrag);
  });

  // Pump the input refresh on every UI update tick (gizmo drag, animation,
  // external code mutating position, etc.)
  const prevUpdate = ui.update;
  ui.update = function() {
    if (typeof prevUpdate === 'function') prevUpdate.apply(this, arguments);
    if (toolbar.classList.contains('dui-visible')) syncInputs();
  };

  // ── Material folder (auto-added on mesh selection) ──
  let materialFolder = null;

  function showMaterialFor(object) {
    removeMaterial();
    if (!object || !object.isMesh) return;
    let mat = object.material;
    if (!mat) return;

    // NB: Material's onChange handlers write directly to mat.<prop>; they
    // do NOT route through commitProp. So we leave autoUndo on so the
    // Folder wrapper records snapshots — opt-out would mean no undo.
    materialFolder = ui.addFolder('Material', { collapsed: false, transient: true });
    // Move Material folder to appear right after Tool (near top of Inspector)
    // so the user sees it immediately on selection.
    const toolFolder = ui.panel.folders['Tool'];
    if (toolFolder && materialFolder.element) {
      const after = toolFolder.element.nextSibling;
      ui.panel.body.insertBefore(materialFolder.element, after);
    }

    // ── Copy-on-write for shared materials ──
    // Imported GLB / three.js scenes commonly share ONE material instance across
    // many meshes (consolidated for performance). Editing it here would bleed to
    // every mesh that uses it. So the first time the user changes anything, give
    // THIS mesh its own copy (if the instance is actually shared), isolating the
    // edit. Idempotent per mesh via userData.__matUnique.
    const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
                      'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'specularMap'];
    const isShared = (m) => {
      const sc = ui.objectManager?.scene;
      if (!sc?.traverse || !m) return false;
      let count = 0;
      sc.traverse((n) => {
        if (!n.isMesh || !n.material) return;
        const mm = n.material;
        if (Array.isArray(mm) ? mm.includes(m) : mm === m) count++;
      });
      return count > 1;
    };
    const cloneOwn = (m) => {
      const c = m.clone();
      // material.clone() shares texture refs — clone the maps too so texture /
      // UV edits isolate as well, not just numeric/color props.
      for (const k of TEX_KEYS) if (c[k]?.clone) c[k] = c[k].clone();
      return c;
    };
    const ensureUnique = () => {
      if (object.userData.__matUnique) { mat = object.material; return; }
      object.userData.__matUnique = true;
      const cur = object.material;
      if (Array.isArray(cur)) {
        object.material = cur.map((m) => (isShared(m) ? cloneOwn(m) : m));
      } else if (isShared(cur)) {
        object.material = cloneOwn(cur);
      }
      mat = object.material;
    };
    // Route every control's onChange through ensureUnique so any edit triggers
    // copy-on-write before it mutates the material. (Texture upload / clear use
    // raw DOM listeners — those call ensureUnique() directly below.)
    for (const m of ['addColor', 'addSlider', 'addCheckbox', 'addSelect', 'addNumber']) {
      const orig = materialFolder[m]?.bind(materialFolder);
      if (!orig) continue;
      materialFolder[m] = (label, o = {}) => {
        if (o && typeof o.onChange === 'function') {
          const oc = o.onChange;
          o = { ...o, onChange: (...a) => { ensureUnique(); return oc(...a); } };
        }
        return orig(label, o);
      };
    }

    // Color (works for most materials)
    if (mat.color) {
      materialFolder.addColor('Color', {
        value: '#' + mat.color.getHexString(),
        tooltip: 'Base color of the material',
        onChange: c => mat.color.set(c),
      });
    }
    // Standard PBR controls
    if (mat.roughness !== undefined) {
      materialFolder.addSlider('Roughness', {
        min: 0, max: 1, step: 0.01, value: mat.roughness,
        tooltip: 'Surface roughness (0 = mirror, 1 = chalk)',
        onChange: v => { mat.roughness = v; },
      });
    }
    if (mat.metalness !== undefined) {
      materialFolder.addSlider('Metalness', {
        min: 0, max: 1, step: 0.01, value: mat.metalness,
        tooltip: 'Metallic factor (0 = dielectric, 1 = full metal)',
        onChange: v => { mat.metalness = v; },
      });
    }
    if (mat.emissive) {
      materialFolder.addColor('Emissive', {
        value: '#' + mat.emissive.getHexString(),
        tooltip: 'Self-illuminating color (independent of lighting)',
        onChange: c => mat.emissive.set(c),
      });
      if (mat.emissiveIntensity !== undefined) {
        materialFolder.addSlider('Emissive Strength', {
          min: 0, max: 10, step: 0.01, value: mat.emissiveIntensity,
          onChange: v => { mat.emissiveIntensity = v; },
        });
      }
    }
    if (mat.opacity !== undefined) {
      materialFolder.addSlider('Opacity', {
        min: 0, max: 1, step: 0.01, value: mat.opacity,
        tooltip: 'Material transparency',
        onChange: v => {
          mat.opacity = v;
          mat.transparent = v < 1;
          mat.needsUpdate = true;
        },
      });
    }
    if (mat.wireframe !== undefined) {
      materialFolder.addCheckbox('Wireframe', {
        value: mat.wireframe,
        onChange: v => { mat.wireframe = v; },
      });
    }

    // ── Material type swap ──
    // Re-skins the mesh with a different built-in material class, carrying
    // color + map + opacity where they exist. Each entry corresponds to a
    // Three.js material constructor; the picker rewires `object.material`
    // and the folder re-renders against the new instance.
    const MAT_TYPES = ['MeshStandardMaterial', 'MeshPhysicalMaterial',
                       'MeshBasicMaterial', 'MeshLambertMaterial',
                       'MeshPhongMaterial', 'MeshNormalMaterial'];
    const MAT_LABELS = {
      MeshStandardMaterial: 'Standard (PBR)',
      MeshPhysicalMaterial: 'Physical (PBR+)',
      MeshBasicMaterial:    'Basic (unlit)',
      MeshLambertMaterial:  'Lambert',
      MeshPhongMaterial:    'Phong',
      MeshNormalMaterial:   'Normals',
    };
    if (MAT_TYPES.includes(mat.type)) {
      materialFolder.addSelect('Material Type', {
        options: MAT_TYPES.map(t => MAT_LABELS[t]),
        value: MAT_LABELS[mat.type],
        tooltip: 'Swap the material class — color, map, and opacity carry over',
        onChange: labelOrType => {
          const target = MAT_TYPES.find(t => MAT_LABELS[t] === labelOrType) || labelOrType;
          if (target === object.material.type) return;
          const Ctor = THREE[target];
          if (!Ctor) return;
          const prev = object.material;
          const next = new Ctor({
            color: prev.color?.clone?.() || 0xffffff,
            map: prev.map || null,
          });
          if (next.opacity !== undefined && prev.opacity !== undefined) {
            next.opacity = prev.opacity; next.transparent = prev.transparent;
          }
          if (next.roughness !== undefined && prev.roughness !== undefined) next.roughness = prev.roughness;
          if (next.metalness !== undefined && prev.metalness !== undefined) next.metalness = prev.metalness;
          if (next.emissive && prev.emissive) next.emissive.copy(prev.emissive);
          object.material = next;
          // Re-render the folder so it picks up the new material's controls.
          showMaterialFor(object);
        },
      });
    }

    // ── Texture upload + UV controls ──
    // Built entirely from existing primitives (addFile / addInfo / addButton
    // / addSlider / addCheckbox) so the row chrome matches every other
    // section in the panel. No custom CSS classes here.
    async function uploadTexture(file) {
      if (!file) return;
      ensureUnique(); // copy-on-write before mutating a possibly-shared material
      let target = object.material;
      if (!TEXTURE_CAPABLE_MATERIALS.has(target.type)) {
        const prevColor = target.color?.clone?.() || new THREE.Color(0xffffff);
        const promoted = new THREE.MeshStandardMaterial({ color: prevColor, roughness: 0.5 });
        target.dispose?.();
        object.material = promoted;
        target = promoted;
        showToast(`Promoted to MeshStandardMaterial so the texture is visible`, { icon: icons.paintBrush, duration: 2400 });
      }
      const url = URL.createObjectURL(file);
      const loader = new THREE.TextureLoader();
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = ui.objectManager?.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
        tex.needsUpdate = true;
        if (target.map && target.map.dispose) target.map.dispose();
        target.map = tex;
        if (target.color) target.color.set(0xffffff);
        target.userData = target.userData || {};
        target.userData.textureFilename = file.name;
        target.needsUpdate = true;
        URL.revokeObjectURL(url);
        showToast(`Texture applied · ${tex.image.width}×${tex.image.height}`, { icon: icons.check });
        showMaterialFor(object);
      }, undefined, (err) => {
        URL.revokeObjectURL(url);
        showToast(`Texture load failed: ${err?.message || 'unknown'}`, { icon: icons.warning, duration: 3500 });
      });
    }

    function pickAndUpload() {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.addEventListener('change', () => uploadTexture(input.files?.[0]));
      input.click();
    }

    // Texture row: thumbnail (replaces on click) + filename + small × clear.
    // When no texture is loaded, the row becomes a dashed placeholder
    // prompting "Upload texture" — uses the same color tokens / radii as
    // the rest of the panel so it visually belongs.
    const texRow = document.createElement('div');
    texRow.className = 'dui-tex-row';
    if (mat.map) {
      const thumb = document.createElement('canvas');
      thumb.className = 'dui-tex-thumb';
      thumb.width = 64; thumb.height = 64;
      const img = mat.map.image;
      if (img) {
        try { thumb.getContext('2d').drawImage(img, 0, 0, 64, 64); } catch (e) { log.debug('contextual', 'drawImage failed:', e); }
      }
      thumb.title = 'Replace texture';
      thumb.addEventListener('click', pickAndUpload);
      const name = document.createElement('span');
      name.className = 'dui-tex-name';
      name.textContent = mat.userData?.textureFilename || mat.map.name || '(unnamed)';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'dui-tex-clear';
      clear.dataset.tooltip = 'Clear texture';
      clear.innerHTML = '×';
      clear.addEventListener('click', () => {
        ensureUnique(); // copy-on-write before clearing a possibly-shared map
        mat.map?.dispose?.();
        mat.map = null;
        mat.needsUpdate = true;
        showMaterialFor(object);
      });
      texRow.append(thumb, name, clear);
    } else {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'dui-tex-empty';
      empty.innerHTML = `<span class="dui-tex-empty-plus">+</span><span>Upload texture</span>`;
      empty.addEventListener('click', pickAndUpload);
      texRow.append(empty);
    }
    materialFolder.body.appendChild(texRow);

    if (mat.map) {
      // UV controls grouped under a subtle subhead.
      const uvHead = document.createElement('div');
      uvHead.className = 'dui-subhead';
      uvHead.textContent = 'UV';
      materialFolder.body.appendChild(uvHead);
      materialFolder.addSlider('Repeat X', {
        min: 0.1, max: 10, step: 0.01, value: mat.map.repeat.x,
        tooltip: 'Texture tiling along U',
        onChange: v => { mat.map.repeat.x = v; mat.map.needsUpdate = true; },
      });
      materialFolder.addSlider('Repeat Y', {
        min: 0.1, max: 10, step: 0.01, value: mat.map.repeat.y,
        tooltip: 'Texture tiling along V',
        onChange: v => { mat.map.repeat.y = v; mat.map.needsUpdate = true; },
      });
      // UV: Offset
      materialFolder.addSlider('Offset X', {
        min: -1, max: 1, step: 0.001, value: mat.map.offset.x,
        tooltip: 'Slide the texture along U',
        onChange: v => { mat.map.offset.x = v; mat.map.needsUpdate = true; },
      });
      materialFolder.addSlider('Offset Y', {
        min: -1, max: 1, step: 0.001, value: mat.map.offset.y,
        tooltip: 'Slide the texture along V',
        onChange: v => { mat.map.offset.y = v; mat.map.needsUpdate = true; },
      });
      // UV: Rotation (Three.js takes radians; expose degrees for usability)
      materialFolder.addSlider('Rotation', {
        min: -180, max: 180, step: 1, value: (mat.map.rotation * 180 / Math.PI),
        suffix: '°',
        tooltip: 'Spin the texture in UV space',
        onChange: deg => { mat.map.rotation = deg * Math.PI / 180; mat.map.needsUpdate = true; },
      });
      // UV: Flips. flipY is a real Texture property; flipX is implemented
      // via a negative repeat.x (Three.js convention).
      materialFolder.addCheckbox('Flip X', {
        value: mat.map.repeat.x < 0,
        tooltip: 'Mirror the texture horizontally',
        onChange: v => {
          mat.map.repeat.x = (v ? -1 : 1) * Math.abs(mat.map.repeat.x);
          mat.map.needsUpdate = true;
        },
      });
      materialFolder.addCheckbox('Flip Y', {
        value: !!mat.map.flipY,
        tooltip: 'Flip the texture vertically (re-decodes on next upload)',
        onChange: v => { mat.map.flipY = v; mat.map.needsUpdate = true; mat.needsUpdate = true; },
      });
    }

    // For ShaderMaterial, surface custom uniforms
    if (mat.type === 'ShaderMaterial' || mat.type === 'RawShaderMaterial') {
      materialFolder.addInfo(`Custom shader: ${Object.keys(mat.uniforms || {}).length} uniforms`, 'shader-info');
    }
  }

  function removeMaterial() {
    if (materialFolder) {
      ui.panel.removeFolder('Material');
      materialFolder = null;
    }
  }

  // ── Properties folder (auto-added on 2D / web selection) ──
  // Mirrors the Material folder pattern but for plain-data objects. Shows
  // every numeric / color / boolean property the selection exposes — except
  // the transform fields (x / y / rotation / scale-y / width / height /
  // radius) since those already live on the mini toolbar.
  let propertiesFolder = null;
  // Always-hidden props — transform + name + adapter internals + the
  // per-corner radii that get folded into the dedicated Corner Radius
  // widget instead of rendering as four separate rows.
  const HIDDEN_PROPS = new Set([
    'x', 'y', 'z', 'rotation', 'width', 'height', 'radius',
    'scale', 'scaleX', 'scaleY', 'name', 'kind',
    '_el', '_baseWidth', '_baseHeight',
    'cornerRadiusTopLeft', 'cornerRadiusTopRight',
    'cornerRadiusBottomLeft', 'cornerRadiusBottomRight',
  ]);
  // Typography-owned props — only hidden from Properties when the
  // object actually has typography (i.e. the Typography folder will
  // render them). For non-typography objects like 2D shapes, `color`
  // is the fill color and should appear as a normal color picker.
  const TYPOGRAPHY_PROPS = new Set([
    'text', 'fontFamily', 'fontWeight', 'fontSize',
    'lineHeight', 'letterSpacing', 'textAlign', 'verticalAlign',
    'fontStyle', 'color',
  ]);
  function showPropertiesFor(object) {
    removePropertiesFolder();
    if (!object) return;
    const hasTypo = typeof object.hasTypography === 'function'
      ? object.hasTypography()
      : false;
    // Collect every own + accessor property whose value is editable.
    const keys = new Set([
      ...Object.keys(object),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(object) || {}),
    ]);
    const editable = [];
    keys.forEach(k => {
      if (HIDDEN_PROPS.has(k) || k.startsWith('_')) return;
      // Suppress typography props ONLY for typography targets. A 2D
      // canvas circle has `color` (its fill), and we still want that
      // to show up as a color picker in Properties.
      if (hasTypo && TYPOGRAPHY_PROPS.has(k)) return;
      const v = object[k];
      if (v === null || v === undefined) return;
      if (typeof v === 'number' || typeof v === 'boolean') editable.push({ key: k, value: v, kind: typeof v });
      else if (typeof v === 'string') {
        // Any parseable CSS color (hex, rgb(), rgba(), hsl(), named)
        // becomes a color picker. Web elements seed fill/strokeColor
        // from getComputedStyle, which returns rgb()/rgba() — those must
        // round-trip to hex here or the colors silently vanish from the
        // inspector.
        const hex = cssColorToHex(v);
        if (hex) editable.push({ key: k, value: hex, kind: 'color' });
      }
    });
    // Promote cornerRadius into a dedicated widget — but only render it
    // once. Detection is just "has a cornerRadius prop" (auto-registers
    // for 2D / web objects from createWebAdapter and friends).
    const hasCornerRadius = 'cornerRadius' in object;
    // Same idea for dimensions: if the selection exposes both width and
    // height as numbers, surface them as one paired Figma-style row.
    const hasDimensions =
      typeof object.width === 'number' && typeof object.height === 'number';
    if (editable.length === 0 && !hasCornerRadius && !hasDimensions) return;

    propertiesFolder = ui.addFolder('Properties', { collapsed: false, transient: true, autoUndo: false });
    // Slot the folder just below Tool/Material so it stays near the top.
    const toolFolder = ui.panel.folders['Tool'];
    const matFolder  = ui.panel.folders['Material'];
    const anchor = matFolder?.element?.nextSibling ?? toolFolder?.element?.nextSibling;
    if (anchor && propertiesFolder.element) {
      ui.panel.body.insertBefore(propertiesFolder.element, anchor);
    }

    // We pair adjacent plain-number fields into one row (2 cells side
    // by side) so the inspector doesn't waste a full row on every
    // numeric value. A "plain number" here is anything that isn't a
    // unit-range (0..1, rendered as a slider). Sliders, colors, and
    // booleans break the pair and emit on their own row.
    let pairBuffer = [];
    function flushPair() {
      if (pairBuffer.length === 0) return;
      // Single trailing field — emit as a regular full-width row so it
      // doesn't show up half-width and lonely.
      if (pairBuffer.length === 1) {
        const f = pairBuffer[0];
        propertiesFolder.addNumber(f.label, {
          min: -10000, max: 10000, value: f.value, step: 1,
          onChange: f.onChange,
        });
        const handle = propertiesFolder.controls[f.label];
        if (handle?.element) {
          attachKeyframeIcon(handle.element, {
            ui, object, path: f.key, label: f.label, trackColor: COLOR_FOR(f.key),
          });
        }
      } else {
        propertiesFolder.addPairedNumbers(pairBuffer.map(f => ({
          label: f.label, value: f.value, min: -10000, max: 10000, step: 1,
          onChange: f.onChange,
        })));
      }
      pairBuffer = [];
    }

    editable.forEach(({ key, value, kind }) => {
      if (key === 'cornerRadius') return;
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      if (kind === 'color') {
        flushPair();
        propertiesFolder.addColor(label, {
          value, onChange: v => commitProp(object, key, v, `edit ${label}`),
        });
      } else if (kind === 'boolean') {
        flushPair();
        propertiesFolder.addCheckbox(label, {
          value, onChange: v => commitProp(object, key, v, `toggle ${label}`),
        });
      } else {
        // Numeric — 0..1 unit ranges become sliders (visual scrubbing
        // matters there). Other numerics buffer up so we can emit them
        // 2-at-a-time as paired rows.
        const isUnit = value >= 0 && value <= 1;
        if (isUnit) {
          flushPair();
          propertiesFolder.addSlider(label, {
            min: 0, max: 1, value, step: 0.01,
            onChange: v => commitProp(object, key, v, `edit ${label}`),
          });
          // Slider gets its own keyframe diamond inline below.
          const handle = propertiesFolder.controls[label];
          if (handle?.element) {
            attachKeyframeIcon(handle.element, {
              ui, object, path: key, label, trackColor: COLOR_FOR(key),
            });
          }
        } else {
          pairBuffer.push({
            key, label, value,
            onChange: v => commitProp(object, key, v, `edit ${label}`),
          });
          if (pairBuffer.length >= 2) flushPair();
        }
      }
    });
    flushPair();

    // ── Dimensions (auto-promoted) ─────────────────────────────────
    // Width and height are hidden from the generic editable loop (the
    // mini toolbar already exposes them on the Scale row), but in the
    // inspector panel we want the Figma-style paired widget — one row,
    // with an aspect-lock toggle. Writes go straight to the live object.
    if (hasDimensions) {
      propertiesFolder.addDimensions('Dimensions', {
        value: { width: object.width, height: object.height },
        onChange: ({ width, height }) => {
          commitProps(object, [
            { key: 'width',  value: width },
            { key: 'height', value: height },
          ], 'edit Dimensions');
        },
      });
    }

    // ── Corner Radius (auto-promoted) ──────────────────────────────
    // We render the Figma-style widget whenever the object exposes a
    // numeric `cornerRadius`. If it also exposes per-corner properties
    // (cornerRadiusTopLeft etc.), those drive the initial value AND
    // receive writes; otherwise we just round-trip the uniform value.
    if (hasCornerRadius) {
      const hasPerCorner = ['cornerRadiusTopLeft','cornerRadiusTopRight',
                            'cornerRadiusBottomLeft','cornerRadiusBottomRight']
                            .every(k => k in object);
      const initial = hasPerCorner
        ? { tl: +object.cornerRadiusTopLeft || 0,
            tr: +object.cornerRadiusTopRight || 0,
            br: +object.cornerRadiusBottomRight || 0,
            bl: +object.cornerRadiusBottomLeft || 0 }
        : (+object.cornerRadius || 0);
      propertiesFolder.addCornerRadius('Corner radius', {
        value: initial,
        onChange: v => {
          if (typeof v === 'number') {
            const changes = [{ key: 'cornerRadius', value: v }];
            if (hasPerCorner) {
              changes.push(
                { key: 'cornerRadiusTopLeft', value: v },
                { key: 'cornerRadiusTopRight', value: v },
                { key: 'cornerRadiusBottomRight', value: v },
                { key: 'cornerRadiusBottomLeft', value: v },
              );
            }
            commitProps(object, changes, 'edit Corner radius');
          } else {
            // Unlinked — write each corner where supported. Keep the
            // uniform field set to the TL value so other readers still
            // get a sane number.
            const changes = [];
            if (hasPerCorner) {
              changes.push(
                { key: 'cornerRadiusTopLeft', value: v.tl },
                { key: 'cornerRadiusTopRight', value: v.tr },
                { key: 'cornerRadiusBottomRight', value: v.br },
                { key: 'cornerRadiusBottomLeft', value: v.bl },
              );
            }
            changes.push({ key: 'cornerRadius', value: v.tl });
            commitProps(object, changes, 'edit Corner radius');
          }
        },
      });
    }
  }
  function COLOR_FOR(key) {
    // Stable hash → hue so the auto-track color matches across sessions.
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
    return `hsl(${h}, 70%, 60%)`;
  }
  function removePropertiesFolder() {
    if (propertiesFolder) {
      ui.panel.removeFolder('Properties');
      propertiesFolder = null;
    }
  }

  // ── Typography folder (auto-added when selection exposes text) ─────
  // The adapter signals support via `hasTypography()` AND surfaces the
  // editable surface via `text`, `fontFamily`, `fontWeight`, `fontSize`,
  // `lineHeight`, `letterSpacing`, `textAlign`, `verticalAlign`,
  // `fontStyle`, and `color`. We render a Figma-style folder: text
  // content on top, family dropdown, weight+size pair, line-height +
  // letter-spacing pair, and an alignment row.
  let typographyFolder = null;
  // Curated families that exist on essentially every machine, plus a few
  // popular web ones. Order matches the kind of pick a designer would
  // reach for first.
  const FONT_FAMILIES = [
    { value: 'ui-sans-serif, system-ui, -apple-system, sans-serif', label: 'System UI' },
    { value: 'Inter, system-ui, sans-serif',     label: 'Inter' },
    { value: '"SF Pro Display", system-ui, sans-serif', label: 'SF Pro Display' },
    { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica' },
    { value: 'Arial, sans-serif',                 label: 'Arial' },
    { value: 'Roboto, system-ui, sans-serif',     label: 'Roboto' },
    { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
    { value: '"Times New Roman", Times, serif',   label: 'Times New Roman' },
    { value: 'ui-monospace, "SF Mono", Menlo, monospace', label: 'Mono (system)' },
    { value: 'Menlo, monospace',                  label: 'Menlo' },
    { value: '"Courier New", monospace',          label: 'Courier New' },
  ];
  const FONT_WEIGHTS = [
    { value: '100', label: 'Thin' },
    { value: '200', label: 'Extra Light' },
    { value: '300', label: 'Light' },
    { value: '400', label: 'Regular' },
    { value: '500', label: 'Medium' },
    { value: '600', label: 'Semi Bold' },
    { value: '700', label: 'Bold' },
    { value: '800', label: 'Extra Bold' },
    { value: '900', label: 'Black' },
  ];
  // Typography alignment glyphs — pulled from the shared icon set so
  // text-row and vertical-flex alignment read in the same visual
  // language as the canvas alignment icons above (Phosphor regular).
  const ICON_AL_TXT_LEFT   = icons.textAlignLeft;
  const ICON_AL_TXT_CENTER = icons.textAlignCenter;
  const ICON_AL_TXT_RIGHT  = icons.textAlignRight;
  const ICON_AL_VTOP    = icons.alignTop;
  const ICON_AL_VMID    = icons.alignMiddle;
  const ICON_AL_VBOT    = icons.alignBottom;

  function showTypographyFor(object) {
    removeTypographyFolder();
    if (!object) return;
    // Detect typography support: prefer the adapter's explicit predicate
    // (web-adapter), fall back to "any selection that has both `text`
    // and `fontFamily`" so caller-defined plain objects also work.
    const supports = typeof object.hasTypography === 'function'
      ? object.hasTypography()
      : (typeof object.text === 'string' && 'fontFamily' in object);
    if (!supports) return;

    // Undo coverage is split by control type. Text / Font / Color are real
    // folder controls (addText/addSelect/addColor), so the folder's autoUndo
    // wrapper records their edits. The hand-built rows below — weight, size,
    // line height, letter spacing, alignment, italic — are raw DOM added via
    // addRaw(), which the wrapper never sees; they each route their writes
    // through commitProp so Cmd+Z still reverts them. (Before, those raw rows
    // wrote straight to the object and were silently absent from the stack.)
    typographyFolder = ui.addFolder('Typography', { collapsed: false, transient: true });
    // Slot below Properties so the panel reads top-to-bottom as:
    // Transform → Material → Properties → Typography → Camera.
    const anchor =
      ui.panel.folders['Properties']?.element?.nextSibling ??
      ui.panel.folders['Material']?.element?.nextSibling ??
      ui.panel.folders['Tool']?.element?.nextSibling;
    if (anchor && typographyFolder.element) {
      ui.panel.body.insertBefore(typographyFolder.element, anchor);
    }

    // Text content (multiline) — width clamped via CSS so long strings
    // don't widen the panel.
    typographyFolder.addText('Text', {
      value: object.text ?? '',
      onChange: v => { object.text = v; },
      multiline: true,
    });

    // Font family — dropdown of curated picks. We snap the current
    // value to the closest match by checking which preset's value the
    // computed family starts with (computed style normalizes whitespace).
    const currentFamily = object.fontFamily || FONT_FAMILIES[0].value;
    const matchedFamily =
      FONT_FAMILIES.find(f => currentFamily.includes(f.label))?.value
      ?? FONT_FAMILIES[0].value;
    typographyFolder.addSelect('Font', {
      options: FONT_FAMILIES,
      value: matchedFamily,
      onChange: v => { object.fontFamily = v; },
    });

    // ── "Number-with-preset-dropdown" helper ─────────────────────
    // Builds [icon + input + chevron] inside a .dui-paired-cell.
    // Clicking the chevron opens a popover anchored to the cell with
    // a preset list — picking one writes the value and closes the
    // popover. Typing into the field works as a custom value path
    // (no preset has to match). Matches Figma's hybrid editor.
    function makeComboCell(opts) {
      const { iconHtml, value, presets = [], displayValue, parseValue, onCommit, tooltip } = opts;
      const cell = document.createElement('div');
      cell.className = 'dui-paired-cell dui-paired-combo';
      cell.innerHTML = `
        <span class="dui-paired-icon" ${tooltip ? `data-tooltip="${tooltip}"` : ''} aria-hidden="true">${iconHtml}</span>
        <input class="dui-paired-input" type="text" inputmode="decimal" />
        <button class="dui-paired-chevron" type="button" data-tooltip="Presets" aria-label="Presets">${icons.caretDown}</button>
      `;
      const input    = cell.querySelector('.dui-paired-input');
      const chevron  = cell.querySelector('.dui-paired-chevron');
      const renderValue = displayValue || (v => String(v));
      // Accessibility: the leading glyph is decorative (aria-hidden), so the
      // field would otherwise be an anonymous "edit text" to a screen reader,
      // and a rejected entry reverts with no announcement. Give it a
      // spinbutton role, a name from the tooltip, and an SR-only live region
      // that carries the "reverted" message — matching the numeric chips in
      // the contextual toolbar and the createNumber fields.
      input.setAttribute('role', 'spinbutton');
      input.setAttribute('aria-label', tooltip || 'value');
      const a11yMsg = document.createElement('span');
      a11yMsg.className = 'dui-field-msg';
      a11yMsg.setAttribute('aria-live', 'polite');
      a11yMsg.id = `dui-combo-${(makeComboCell._seq = (makeComboCell._seq || 0) + 1)}`;
      input.setAttribute('aria-describedby', a11yMsg.id);
      cell.appendChild(a11yMsg);
      input.value = renderValue(value);
      input.setAttribute('aria-valuenow', String(value));
      input.addEventListener('input', () => {
        if (input.getAttribute('aria-invalid') === 'true') {
          input.removeAttribute('aria-invalid'); a11yMsg.textContent = '';
        }
      });
      input.addEventListener('change', () => {
        const parsed = parseValue ? parseValue(input.value) : parseFloat(input.value);
        if (parsed === undefined || (typeof parsed === 'number' && !Number.isFinite(parsed))) {
          input.setAttribute('aria-invalid', 'true');
          a11yMsg.textContent = 'Not a number — reverted.';
          input.value = renderValue(opts.value);
          return;
        }
        input.removeAttribute('aria-invalid');
        a11yMsg.textContent = '';
        onCommit(parsed);
        input.value = renderValue(parsed);
        input.setAttribute('aria-valuenow', String(parsed));
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      // Lazy-built popover, anchored to the chevron.
      let popover = null;
      function buildPopover() {
        const pop = document.createElement('div');
        pop.className = 'dui-combo-popover';
        presets.forEach(p => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dui-combo-option';
          btn.innerHTML = `<span>${p.label}</span><span class="dui-combo-option-sub">${p.sub || ''}</span>`;
          btn.addEventListener('click', e => {
            e.stopPropagation();
            onCommit(p.value);
            input.value = renderValue(p.value);
            input.setAttribute('aria-valuenow', String(p.value));
            input.removeAttribute('aria-invalid');
            a11yMsg.textContent = '';
            closePop();
          });
          pop.appendChild(btn);
        });
        return pop;
      }
      function positionPop() {
        if (!popover) return;
        // Width drives offsetWidth, which the flip helper measures
        // before deciding above vs below — set width first.
        const r = cell.getBoundingClientRect();
        popover.style.width = `${Math.max(r.width, 120)}px`;
        positionPopoverNear(popover, cell, { gap: 4 });
      }
      function openPop() {
        if (!popover) popover = buildPopover();
        document.body.appendChild(popover);
        positionPop();
        cell.classList.add('dui-combo-open');
        setTimeout(() => {
          document.addEventListener('click', outsideClose, { capture: true });
          document.addEventListener('keydown', escClose);
          window.addEventListener('resize', positionPop);
          // Passive: positionPop only repositions, never preventDefault.
          window.addEventListener('scroll', positionPop, { capture: true, passive: true });
        }, 0);
      }
      function closePop() {
        if (!popover) return;
        popover.remove();
        cell.classList.remove('dui-combo-open');
        document.removeEventListener('click', outsideClose, { capture: true });
        document.removeEventListener('keydown', escClose);
        window.removeEventListener('resize', positionPop);
        window.removeEventListener('scroll', positionPop, true);
      }
      function outsideClose(e) {
        if (!popover) return;
        if (popover.contains(e.target) || cell.contains(e.target)) return;
        closePop();
      }
      function escClose(e) { if (e.key === 'Escape') closePop(); }
      chevron.addEventListener('click', e => {
        e.stopPropagation();
        if (cell.classList.contains('dui-combo-open')) closePop(); else openPop();
      });
      return { element: cell, input, chevron };
    }

    // Weight + Size — Figma layout: dropdown on the left, typeable-with-
    // presets on the right.
    const weightSizeRow = document.createElement('div');
    weightSizeRow.className = 'dui-row dui-row-paired';
    const weightCell = document.createElement('div');
    weightCell.className = 'dui-paired-cell dui-paired-weight';
    weightCell.innerHTML = `<select class="dui-typo-weight"></select>`;
    const weightSel = weightCell.querySelector('.dui-typo-weight');
    FONT_WEIGHTS.forEach(w => {
      const o = document.createElement('option');
      o.value = w.value; o.textContent = w.label;
      weightSel.appendChild(o);
    });
    weightSel.value = String(object.fontWeight || 400);
    weightSel.addEventListener('change', () => { commitProp(object, 'fontWeight', +weightSel.value, 'change Font Weight'); });
    weightSizeRow.appendChild(weightCell);

    const sizeCombo = makeComboCell({
      iconHtml: icons.textAa,
      value: object.fontSize ?? 14,
      tooltip: 'Font size',
      presets: [10, 12, 14, 16, 18, 20, 24, 32, 48, 64, 96].map(v => ({
        label: String(v), sub: 'px', value: v,
      })),
      displayValue: v => String(Math.round(v * 100) / 100),
      parseValue: raw => {
        const v = parseFloat(raw);
        return Number.isFinite(v) && v > 0 ? v : undefined;
      },
      onCommit: v => { commitProp(object, 'fontSize', v, 'change Font Size'); },
    });
    sizeCombo.element.classList.add('dui-paired-size');
    weightSizeRow.appendChild(sizeCombo.element);
    typographyFolder.addRaw(weightSizeRow);

    // Line height + Letter spacing — both typeable-with-presets.
    const lhLsRow = document.createElement('div');
    lhLsRow.className = 'dui-row dui-row-paired';
    const LH_ICON = icons.lineHeight;
    const LS_ICON = icons.letterSpacing;

    const lhCombo = makeComboCell({
      iconHtml: LH_ICON,
      value: object.lineHeight ?? 1.2,
      tooltip: 'Line height',
      // CSS line-height is unitless (multiplier). 1.0–2.0 covers ~99% of UI.
      presets: [
        { label: 'Auto', sub: '',  value: 1.2 },
        { label: '1',    sub: '×', value: 1.0 },
        { label: '1.2',  sub: '×', value: 1.2 },
        { label: '1.4',  sub: '×', value: 1.4 },
        { label: '1.5',  sub: '×', value: 1.5 },
        { label: '1.6',  sub: '×', value: 1.6 },
        { label: '2',    sub: '×', value: 2.0 },
      ],
      displayValue: v => String(Math.round(v * 100) / 100),
      parseValue: raw => {
        const v = parseFloat(raw);
        return Number.isFinite(v) && v >= 0 ? v : undefined;
      },
      onCommit: v => { commitProp(object, 'lineHeight', v, 'change Line Height'); },
    });
    lhLsRow.appendChild(lhCombo.element);

    const lsCombo = makeComboCell({
      iconHtml: LS_ICON,
      value: object.letterSpacing ?? 0,
      tooltip: 'Letter spacing (px)',
      presets: [-2, -1, -0.5, 0, 0.5, 1, 2, 4].map(v => ({
        label: v > 0 ? `+${v}` : String(v), sub: 'px', value: v,
      })),
      displayValue: v => String(Math.round(v * 100) / 100),
      parseValue: raw => {
        const v = parseFloat(raw);
        return Number.isFinite(v) ? v : undefined;
      },
      onCommit: v => { commitProp(object, 'letterSpacing', v, 'change Letter Spacing'); },
    });
    lhLsRow.appendChild(lsCombo.element);
    typographyFolder.addRaw(lhLsRow);

    // Alignment row — Figma's 3-horizontal + 3-vertical pattern.
    // We tag the active button on each side and update both groups when
    // the user clicks. The italic/options chip on the right is a future
    // hook (toggles fontStyle for now).
    const alignRow = document.createElement('div');
    alignRow.className = 'dui-row dui-row-block dui-typo-align';
    alignRow.innerHTML = `
      <label>Alignment</label>
      <div class="dui-typo-align-grid">
        <div class="dui-typo-align-group" data-axis="h">
          <button class="dui-typo-align-btn" data-val="left"   data-tooltip="Align left">${ICON_AL_TXT_LEFT}</button>
          <button class="dui-typo-align-btn" data-val="center" data-tooltip="Align center">${ICON_AL_TXT_CENTER}</button>
          <button class="dui-typo-align-btn" data-val="right"  data-tooltip="Align right">${ICON_AL_TXT_RIGHT}</button>
        </div>
        <div class="dui-typo-align-group" data-axis="v">
          <button class="dui-typo-align-btn" data-val="top"    data-tooltip="Align top">${ICON_AL_VTOP}</button>
          <button class="dui-typo-align-btn" data-val="middle" data-tooltip="Align middle">${ICON_AL_VMID}</button>
          <button class="dui-typo-align-btn" data-val="bottom" data-tooltip="Align bottom">${ICON_AL_VBOT}</button>
        </div>
        <button class="dui-typo-align-italic" data-tooltip="Toggle italic">${icons.italic}</button>
      </div>
    `;
    function syncAlignButtons() {
      alignRow.querySelectorAll('.dui-typo-align-group').forEach(g => {
        const axis = g.dataset.axis;
        const cur  = axis === 'h' ? object.textAlign : object.verticalAlign;
        g.querySelectorAll('.dui-typo-align-btn').forEach(b => {
          b.classList.toggle('dui-active', b.dataset.val === cur);
        });
      });
      alignRow.querySelector('.dui-typo-align-italic')
        .classList.toggle('dui-active', object.fontStyle === 'italic');
    }
    alignRow.querySelectorAll('.dui-typo-align-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const axis = b.closest('.dui-typo-align-group').dataset.axis;
        if (axis === 'h') commitProp(object, 'textAlign',     b.dataset.val, 'change Alignment');
        else              commitProp(object, 'verticalAlign', b.dataset.val, 'change Alignment');
        syncAlignButtons();
      });
    });
    alignRow.querySelector('.dui-typo-align-italic').addEventListener('click', (e) => {
      e.stopPropagation();
      commitProp(object, 'fontStyle', object.fontStyle === 'italic' ? 'normal' : 'italic', 'change Style');
      syncAlignButtons();
    });
    syncAlignButtons();
    typographyFolder.addRaw(alignRow);

    // Text color picker — sits at the bottom so the rest of the folder
    // stays Figma-shaped. Hex normalization happens inside createColor.
    typographyFolder.addColor('Color', {
      value: rgbToHex(object.color) || '#ffffff',
      onChange: v => { object.color = v; },
    });
  }
  function removeTypographyFolder() {
    if (typographyFolder) {
      ui.panel.removeFolder('Typography');
      typographyFolder = null;
    }
  }
  // CSS `color` resolves to "rgb(…)" — convert to hex so the color
  // picker's hex input shows a meaningful seed value.
  function rgbToHex(rgb) {
    if (!rgb) return null;
    if (rgb.startsWith('#')) return rgb;
    const m = rgb.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b] = m[1].split(',').map(s => parseInt(s.trim(), 10));
    if ([r,g,b].some(n => !Number.isFinite(n))) return null;
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }

  // ── Camera-settings folder (auto-added when a Camera is selected) ──
  // Surfaces the controls cinematographers expect: FOV, focal length in mm
  // (synced to FOV through the 35mm-equivalent lens formula), and a focal
  // object dropdown that drives a per-frame lookAt onto the chosen target.
  // For Orthographic cameras we swap in a Zoom slider instead.
  let cameraFolder = null;
  const SENSOR_WIDTH_MM = 36;   // 35mm full-frame equivalent
  function fovToMm(fovDeg)  { return SENSOR_WIDTH_MM / (2 * Math.tan((fovDeg * Math.PI / 180) / 2)); }
  function mmToFov(mm)      { return 2 * Math.atan(SENSOR_WIDTH_MM / (2 * mm)) * 180 / Math.PI; }
  function showCameraFor(object) {
    removeCameraFolder();
    if (!object?.isCamera) return;

    cameraFolder = ui.addFolder('Camera Settings', { collapsed: false, transient: true, autoUndo: false });
    // Slot it just below Tool/Material/Properties so it stays near the top.
    // When none of those exist (host panels that only carry permanent folders),
    // fall back to the very top of the body — otherwise addFolder leaves it at
    // the bottom, below every permanent folder and off-screen on selection.
    const anchor =
      ui.panel.folders['Properties']?.element?.nextSibling ??
      ui.panel.folders['Material']?.element?.nextSibling ??
      ui.panel.folders['Tool']?.element?.nextSibling ??
      ui.panel.body.firstChild;
    if (anchor && cameraFolder.element) {
      ui.panel.body.insertBefore(cameraFolder.element, anchor);
    }

    if (object.isPerspectiveCamera) {
      // FOV ↔ mm are two views on the same underlying value. Each setter
      // writes the canonical (fov), updates the camera projection, and
      // refreshes the sibling control without re-firing onChange.
      const fovCtl = cameraFolder.addSlider('FOV', {
        min: 5, max: 120, step: 0.1, value: object.fov,
        tooltip: 'Vertical field of view in degrees',
        onChange: v => {
          commitProp(object, 'fov', v, 'edit FOV');
          object.updateProjectionMatrix();
          mmCtl?.setValue?.(fovToMm(v).toFixed(1));
        },
      }).controls['FOV'];
      const mmCtl = cameraFolder.addSlider('Lens (mm)', {
        min: 8, max: 400, step: 1,
        value: Math.round(fovToMm(object.fov)),
        tooltip: 'Equivalent focal length (35mm full-frame sensor)',
        onChange: mm => {
          const newFov = mmToFov(mm);
          commitProp(object, 'fov', newFov, 'edit lens');
          object.updateProjectionMatrix();
          fovCtl?.setValue?.(newFov.toFixed(1));
        },
      }).controls['Lens (mm)'];
    } else if (object.isOrthographicCamera) {
      cameraFolder.addSlider('Zoom', {
        min: 0.1, max: 10, step: 0.01, value: object.zoom,
        tooltip: 'Orthographic zoom factor',
        onChange: v => {
          commitProp(object, 'zoom', v, 'edit zoom');
          object.updateProjectionMatrix();
        },
      });
    }

    // Near / far clipping planes — each on its own slider so the user
    // can scrub the depth range visually. Click the value to type a
    // precise number if the default range is too narrow.
    cameraFolder.addSlider('Near', {
      min: 0.01, max: 100, step: 0.01, value: object.near,
      tooltip: 'Near clipping plane',
      onChange: v => {
        commitProp(object, 'near', Math.max(0.0001, v), 'edit near plane');
        object.updateProjectionMatrix();
      },
    });
    cameraFolder.addSlider('Far', {
      min: 1, max: 1000, step: 1, value: object.far,
      tooltip: 'Far clipping plane',
      onChange: v => {
        commitProp(object, 'far', Math.max(object.near + 0.01, v), 'edit far plane');
        object.updateProjectionMatrix();
      },
    });

    // Focal object — pick another registered scene object and the camera
    // will lookAt it every frame via the update hook below.
    const candidates = (ui.objectManager?.getNames?.() || [])
      .filter(n => {
        const o = ui.objectManager.getObject(n);
        return o && o !== object && o.position;
      });
    const options = ['(none)', ...candidates];
    const current = object.userData?.focalTargetName || '(none)';
    cameraFolder.addSelect('Focal Object', {
      options, value: current,
      tooltip: 'Track this object every frame (camera.lookAt)',
      onChange: name => {
        if (name === '(none)') {
          object.userData.focalTargetName = null;
          object.userData.focalTarget = null;
        } else {
          object.userData.focalTargetName = name;
          object.userData.focalTarget = ui.objectManager.getObject(name);
        }
      },
    });
  }
  function removeCameraFolder() {
    if (cameraFolder) {
      ui.panel.removeFolder('Camera Settings');
      cameraFolder = null;
    }
  }

  // ── Light folder (auto-added when a Light is selected) ──
  // Surfaces type swap (Spot / Directional / Area), Power, Color, and a
  // Gobo upload that maps a texture into a SpotLight's `map` slot for
  // image-projected stage lighting.
  let lightFolder = null;
  let lightFolderName = null;  // stored so removeLightFolder() can find it
  const LIGHT_TYPES = ['DirectionalLight', 'SpotLight', 'RectAreaLight'];
  const LIGHT_LABELS = { DirectionalLight: 'Sunlight', SpotLight: 'Spot', RectAreaLight: 'Area' };
  async function showLightFor(object) {
    removeLightFolder();
    if (!object?.isLight) return;
    const om = ui.objectManager;
    if (!om) return;
    const name = Object.keys(om.objects || {}).find(n => om.getObject(n) === object) || object.name || 'Light';

    // The folder title is the light's name (e.g. "Sun", "Fill") so the
    // section reads as "this light, with these properties beneath".
    lightFolder = ui.addFolder(name, { collapsed: false, transient: true, autoUndo: false });
    lightFolderName = name;
    // Slot the folder near the top, after Tool/Material/Properties/Camera.
    const anchor =
      ui.panel.folders['Camera Settings']?.element?.nextSibling ??
      ui.panel.folders['Properties']?.element?.nextSibling ??
      ui.panel.folders['Material']?.element?.nextSibling ??
      ui.panel.folders['Tool']?.element?.nextSibling;
    if (anchor && lightFolder.element) {
      ui.panel.body.insertBefore(lightFolder.element, anchor);
    }

    // ── Primary children: Intensity + Color ───────────────────────
    // These two land right under the light's name. Type / Angle /
    // Penumbra / Gobo come below as type-specific advanced rows.
    lightFolder.addSlider('Intensity', {
      min: 0, max: 20, step: 0.01, value: object.intensity ?? 1,
      tooltip: 'Light intensity (Three.js units)',
      onChange: v => commitProp(object, 'intensity', v, `${name} intensity`),
    });
    // For three.js Color objects we round-trip through a hex string so
    // propEdit can store an opaque before/after. Storing the Color
    // instance directly wouldn't work — assigning to `obj.color` would
    // overwrite the proxy that other code holds.
    lightFolder.addColor('Color', {
      value: '#' + (object.color?.getHexString?.() || 'ffffff'),
      tooltip: 'Light color',
      onChange: c => {
        if (!object.color) return;
        const before = '#' + object.color.getHexString();
        if (before === c) return;
        object.color.set(c);
        ui._undo?.push({
          label: `${name} color`,
          coalesceKey: `color:${name}`,
          undo: () => object.color.set(before),
          redo: () => object.color.set(c),
        });
      },
    });

    // ── Type swap (advanced) ──────────────────────────────────────
    // Position/color/intensity carry over; the object manager is
    // rewired so the outliner and contextual flow keep pointing at
    // the new node.
    const currentType = object.type;
    lightFolder.addSelect('Type', {
      options: LIGHT_TYPES.map(t => LIGHT_LABELS[t]),
      value: LIGHT_LABELS[currentType] || LIGHT_LABELS.SpotLight,
      tooltip: 'Swap the light type — position, color, and intensity carry over',
      onChange: async (labelOrType) => {
        const targetType = LIGHT_TYPES.find(t => LIGHT_LABELS[t] === labelOrType) || labelOrType;
        if (targetType === object.type) return;
        await swapLightType(name, object, targetType);
      },
    });

    // Spot-only: cone angle + penumbra
    if (object.isSpotLight) {
      lightFolder.addSlider('Angle', {
        min: 0, max: Math.PI / 2, step: 0.01, value: object.angle,
        tooltip: 'Cone half-angle (radians)',
        onChange: v => commitProp(object, 'angle', v, `${name} angle`),
      });
      lightFolder.addSlider('Penumbra', {
        min: 0, max: 1, step: 0.01, value: object.penumbra,
        tooltip: 'Soft cone falloff (0 = hard edge, 1 = fully soft)',
        onChange: v => commitProp(object, 'penumbra', v, `${name} penumbra`),
      });
    }

    // Area-only: width + height. Paired so the two values read as one
    // unit (the light's physical aperture), and the meters unit lands
    // in the label parens — "Width (m)" / "Height (m)".
    if (object.isRectAreaLight) {
      lightFolder.addPairedNumbers([
        {
          label: 'Width', value: object.width ?? 1, unit: 'm',
          min: 0.1, max: 50, step: 0.1,
          onChange: v => commitProp(object, 'width', v, `${name} width`),
        },
        {
          label: 'Height', value: object.height ?? 1, unit: 'm',
          min: 0.1, max: 50, step: 0.1,
          onChange: v => commitProp(object, 'height', v, `${name} height`),
        },
      ]);
    }

    // Gobo upload — always available. Uploading onto a non-Spot light
    // auto-swaps the light to Spot first so the texture has somewhere to
    // attach (Three.js exposes `.map` only on SpotLight).
    lightFolder.addFile?.('Gobo', {
      accept: 'image/*',
      tooltip: 'Image projected through the light cone (stage-lighting gobo). Auto-switches the light to Spot if needed.',
      onChange: async (file) => {
        if (!file) return;
        let target = ui.objectManager.getObject(name);
        if (!target?.isSpotLight) {
          await swapLightType(name, target, 'SpotLight');
          target = ui.objectManager.getObject(name);
        }
        const THREEmod = await import('three');
        const loader = new THREEmod.TextureLoader();
        const url = URL.createObjectURL(file);
        loader.load(url, tex => {
          tex.colorSpace = THREEmod.SRGBColorSpace;
          target.map = tex;
          target.userData.goboFilename = file.name;
          URL.revokeObjectURL(url);
        }, undefined, () => URL.revokeObjectURL(url));
      },
    });
  }
  function removeLightFolder() {
    if (lightFolder) {
      // Folder is keyed by the light's name (e.g. "Sun"), captured at
      // creation time so we can find it even after the user renames or
      // selects a different light.
      if (lightFolderName) ui.panel.removeFolder(lightFolderName);
      lightFolderName = null;
      lightFolder = null;
    }
  }

  // Replace a registered light with a new instance of `targetType`,
  // carrying common state. Re-registers under the same name so every
  // listener (outliner, gizmo, contextual) updates seamlessly.
  async function swapLightType(name, light, targetType) {
    const THREEmod = await import('three');
    const om = ui.objectManager;
    const parent = light.parent;
    const position = light.position.clone();
    const color    = light.color?.clone();
    const intensity = light.intensity;
    const castShadow = light.castShadow;
    let next;
    if (targetType === 'DirectionalLight') {
      next = new THREEmod.DirectionalLight(color || 0xffffff, intensity);
    } else if (targetType === 'SpotLight') {
      next = new THREEmod.SpotLight(color || 0xffffff, intensity);
      next.angle = light.angle ?? Math.PI / 6;
      next.penumbra = light.penumbra ?? 0.3;
    } else if (targetType === 'RectAreaLight') {
      next = new THREEmod.RectAreaLight(color || 0xffffff, intensity, light.width ?? 2, light.height ?? 2);
    }
    if (!next) return;
    next.position.copy(position);
    if (castShadow !== undefined && 'castShadow' in next) next.castShadow = castShadow;
    next.name = light.name || name;
    // Carry over the gobo if both old and new support `.map`.
    if (light.map && 'map' in next) next.map = light.map;

    // Swap in the scene tree, then re-register under the same name so
    // the outliner row keeps its identity. We use the SceneObjectManager
    // low-level register, then mirror the helper via registerLight if
    // available — the helper for the new type appears automatically.
    if (parent) {
      parent.remove(light);
      parent.add(next);
    }
    // Remove + re-register so the helper gets swapped too.
    om.remove?.(name);
    if (om.registerLight) om.registerLight(name, next);
    else om.register?.(name, next);
    om.select?.(name);
  }

  // Per-frame: drive `camera.lookAt(focalTarget.position)` for any camera
  // that has a focal target wired. Runs cheaply alongside the rest of the
  // update() chain — only iterates registered objects.
  const _prevUpdateForCams = ui.update;
  ui.update = function() {
    if (typeof _prevUpdateForCams === 'function') _prevUpdateForCams.apply(this, arguments);
    const om = ui.objectManager;
    if (!om?.getNames) return;
    om.getNames().forEach(n => {
      const cam = om.getObject(n);
      if (!cam?.isCamera) return;
      const target = cam.userData?.focalTarget;
      if (target?.position) {
        cam.lookAt(target.position);
        if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
      }
    });
  };

  // ── Subscribe to selection changes ──
  // `'change'` fires on every gizmo drag tick and any 'change' emit — not
  // just selection changes. We split rebuild work in two:
  //
  //   • SELECTION-CHANGE only (rare): tear down + re-mount the dynamic
  //     folders. This is where the slide-in animation belongs.
  //   • EVERY tick (cheap): just refresh button/toolbar visibility and
  //     re-sync transform input values. No DOM churn.
  //
  // The guard is `lastActiveName` so a gizmo-drag 'change' (same selection)
  // skips the entire folder rebuild path.
  let lastActiveName = undefined;

  // ── Refresh inspector widgets on undo / redo ──────────────────────
  // propEdit / commitProps write object state directly but never touch the
  // on-screen folder widgets. The Material folder self-heals because its
  // autoUndo wrapper calls setValue() on undo — but the commitProp-based
  // folders (Properties, Camera, Light, Typography) have no such hook, so an
  // undo would leave a stale slider / colour / corner-radius value on screen
  // even though the object reverted. On any time-travel event we invalidate
  // the rebuild cache and re-run the folder builders against live state.
  // We act ONLY on 'undo' / 'redo' — never 'push', which fires mid-edit and
  // would tear down the control the user is actively dragging.
  //
  // Binding is deferred: `ui._undo` is assigned by the harness slightly
  // AFTER attachContextualInspector() runs, so a subscription at attach time
  // would silently no-op. We bind lazily from syncContext (which only fires
  // after init completes) and latch it with a one-shot flag.
  let undoRefreshBound = false;
  function bindUndoRefreshOnce() {
    if (undoRefreshBound || !ui._undo?.on) return;
    undoRefreshBound = true;
    ui._undo.on((stack, reason) => {
      if (reason === 'undo' || reason === 'redo') {
        lastActiveName = undefined;   // invalidate syncContext's rebuild cache
        syncContext();                // rebuild folders from current values
      }
    });
  }

  function syncContext() {
    bindUndoRefreshOnce();
    const activeName = ui.objectManager.activeName;
    const obj = activeName ? ui.objectManager.getObject(activeName) : null;
    const is3D = !!(obj && obj.position && obj.rotation && obj.scale);
    const is2D = !is3D && !!(obj && 'x' in obj && 'y' in obj);

    // ── Cheap per-tick work — runs on every 'change' fire ──
    rows3d.style.display = is3D ? '' : 'none';
    rows2d.style.display = is2D ? '' : 'none';
    if (activeName && (is3D || is2D)) {
      toolbar.classList.add('dui-visible');
      reposition();
      syncInputs();
    } else {
      toolbar.classList.remove('dui-visible');
    }

    // ── Expensive folder churn — only when the selected NAME changes ──
    if (activeName !== lastActiveName) {
      lastActiveName = activeName;
      // Camera detection: prefer the manager's `kindOf()` so a camera
      // registered with `attachTransformProxy: true` (which stores a
      // plain Object3D proxy as `object`) is still recognized. Fall
      // back to duck-typing for hosts that bypassed registerCamera.
      const om = ui.objectManager;
      const isCameraEntry = om?.kindOf?.(activeName) === 'camera' || !!obj?.isCamera;
      const cameraRef = isCameraEntry ? (om?.getCameraRef?.(activeName) || obj) : null;
      if (activeName && (is3D || is2D)) {
        if (is3D) showMaterialFor(obj); else removeMaterial();
        if (is2D) showPropertiesFor(obj); else removePropertiesFolder();
        if (isCameraEntry) showCameraFor(cameraRef); else removeCameraFolder();
        if (obj?.isLight)  showLightFor(obj);  else removeLightFolder();
        // Typography appears for any selection that exposes a text
        // surface — applies to 2D/web adapters but also any host-
        // registered duck-typed object that exposes `text`/`fontFamily`.
        showTypographyFor(obj);
      } else {
        removeMaterial();
        removePropertiesFolder();
        removeCameraFolder();
        removeLightFolder();
        removeTypographyFolder();
      }
    }
    // Sync active button state (3D: gizmo mode; 2D: derive from any active
    // Modal2DTransform session).
    if (is3D) {
      const mode = ui.objectManager.currentMode;
      rows3d.querySelectorAll('button[data-mode]').forEach(b =>
        b.classList.toggle('dui-active', b.dataset.mode === mode));
      syncDebugButtons();
    } else if (is2D) {
      const m2d = opts.modal2d || ui._modal2DTransform;
      const mode = m2d?.active ? m2d.mode : null;
      rows2d.querySelectorAll('button[data-mode]').forEach(b =>
        b.classList.toggle('dui-active', b.dataset.mode === mode));
    }
    // Camera button visibility / enablement is independent of selection —
    // it looks across ALL registered objects via resolveCamera(). Run it
    // on EVERY change so adding/removing a camera flips the button state
    // immediately, even when nothing is selected.
    syncCamButton();
  }
  ui.objectManager.on?.('change', syncContext);
  // Also re-sync on registration so a freshly-spawned camera enables the
  // button before the user explicitly selects anything.
  ui.objectManager.on?.('register', syncContext);

  // The rAF loop above keeps the toolbar tracking the panel each frame —
  // no extra ResizeObserver / resize listener required here.

  // Initial sync (no selection yet)
  syncContext();

  return {
    syncContext,
    dispose() {
      toolbar.remove();
      removeMaterial();
      ro.disconnect();
    },
  };
}
