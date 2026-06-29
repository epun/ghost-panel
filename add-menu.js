/**
 * Add-object popup (Shift+A) — Blender-style add menu.
 *
 * Press Shift+A in the canvas to open a searchable popup of object types
 * that can be added to the scene: mesh primitives, lights, cameras, images,
 * empties, helpers. The chosen object is created at the world origin
 * (or at the 3D cursor if one is registered), auto-named, and registered
 * with the SceneObjectManager so it appears in the Outliner and is
 * immediately selectable / movable / deletable.
 */
import * as THREE from 'three';
import { icons } from './icons.js';
import { showToast } from './toast.js';
import { clamp01, escapeHtml } from './utils.js';

// ─── Factory registry ───────────────────────────────────────────────────
// Each entry: { id, label, category, icon, build(opts) → Object3D }
// The factory returns a ready-to-add THREE Object3D. The popup handles
// scene insertion and registration.

// All built-in factories are 3D (Three.js). Other workflows register their
// own factories at runtime via `ui._addMenu.register(factory)`. Factories
// without a `workflows` array are shown unconditionally; factories with
// one are only shown when at least one of those workflows is active.
const FACTORIES = [
  // ── Mesh primitives ──
  { id: 'cube', label: 'Cube', category: 'Mesh', icon: icons.cube, build: () =>
      new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 }),
      )
  },
  { id: 'sphere', label: 'Sphere', category: 'Mesh', icon: icons.sphere, build: () =>
      new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 32, 24),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4 }),
      )
  },
  { id: 'cylinder', label: 'Cylinder', category: 'Mesh', icon: icons.cylinder, build: () =>
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 }),
      )
  },
  { id: 'cone', label: 'Cone', category: 'Mesh', icon: icons.cone, build: () =>
      new THREE.Mesh(
        new THREE.ConeGeometry(0.6, 1.2, 32),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 }),
      )
  },
  { id: 'plane', label: 'Plane', category: 'Mesh', icon: icons.plane, build: () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2; // Lay flat by default
      return m;
    }
  },
  { id: 'disc', label: 'Disc (Circle)', category: 'Mesh', icon: icons.circle, build: () => {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 48),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      return m;
    }
  },
  { id: 'torus', label: 'Torus', category: 'Mesh', icon: icons.torus, build: () =>
      new THREE.Mesh(
        new THREE.TorusGeometry(0.6, 0.18, 16, 64),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4 }),
      )
  },
  { id: 'torusknot', label: 'Torus Knot', category: 'Mesh', icon: icons.torus, build: () =>
      new THREE.Mesh(
        new THREE.TorusKnotGeometry(0.5, 0.15, 100, 16),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.6 }),
      )
  },
  { id: 'icosahedron', label: 'Icosphere', category: 'Mesh', icon: icons.sphere, build: () =>
      new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.6, 2),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 }),
      )
  },

  // ── Lights ──
  { id: 'point-light', label: 'Point Light', category: 'Light', icon: icons.pointLight,
    build: () => new THREE.PointLight(0xffffff, 1, 10), isLight: true },
  { id: 'directional-light', label: 'Directional Light', category: 'Light', icon: icons.sun,
    build: () => {
      const l = new THREE.DirectionalLight(0xffffff, 1.0);
      l.position.set(2, 4, 3);
      return l;
    },
    isLight: true,
  },
  { id: 'spot-light', label: 'Spot Light', category: 'Light', icon: icons.spotlight,
    build: () => {
      const l = new THREE.SpotLight(0xffffff, 5, 10, Math.PI / 6, 0.3);
      l.position.set(0, 3, 0);
      return l;
    },
    isLight: true,
  },
  { id: 'hemi-light', label: 'Hemisphere Light', category: 'Light', icon: icons.ambient,
    build: () => new THREE.HemisphereLight(0xffffff, 0.444444, 0.8), isLight: true },
  { id: 'ambient-light', label: 'Ambient Light', category: 'Light', icon: icons.ambient,
    build: () => new THREE.AmbientLight(0xffffff, 0.3), isLight: true },

  // ── Camera ──
  { id: 'perspective-camera', label: 'Perspective Camera', category: 'Camera', icon: icons.camera,
    build: () => {
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      cam.position.set(0, 2, 5);
      cam.lookAt(0, 0, 0);
      return cam;
    },
    isCamera: true,
  },
  { id: 'orthographic-camera', label: 'Orthographic Camera', category: 'Camera', icon: icons.camera,
    build: () => {
      const cam = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
      cam.position.set(0, 2, 5);
      cam.lookAt(0, 0, 0);
      return cam;
    },
    isCamera: true,
  },

  // ── Image plane ──
  { id: 'image', label: 'Image Plane', category: 'Image', icon: icons.image,
    needsFile: 'image/*',
    build: ({ file }) => new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No image selected'));
      const url = URL.createObjectURL(file);
      const loader = new THREE.TextureLoader();
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const aspect = (tex.image.width / tex.image.height) || 1;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(2 * aspect, 2),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }),
        );
        m.userData.imageFilename = file.name;
        resolve(m);
        URL.revokeObjectURL(url);
      }, undefined, reject);
    }),
  },

  // ── GLB / GLTF model ──
  // Uses the official GLTFLoader from three/examples — dynamic-imported so
  // projects that never spawn a model don't pay the parse cost upfront.
  { id: 'gltf', label: 'GLB / glTF', category: 'Model', icon: icons.cube,
    needsFile: '.glb,.gltf,model/gltf-binary,model/gltf+json',
    build: async ({ file }) => {
      if (!file) throw new Error('No model selected');
      const [{ GLTFLoader }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
      ]);
      const loader = new GLTFLoader();
      const url = URL.createObjectURL(file);
      try {
        const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) throw new Error('glTF has no scene');
        // Attach the mixer if the file ships animation clips, matching how
        // SceneObjectManager picks them up.
        if (gltf.animations?.length) {
          const mixer = new THREE.AnimationMixer(root);
          gltf.animations.forEach(clip => mixer.clipAction(clip).play());
          root.userData.mixer = mixer;
          root.userData.animations = gltf.animations;
        }
        root.userData.sourceFilename = file.name;
        return root;
      } finally { URL.revokeObjectURL(url); }
    },
  },

  // ── Gaussian Splat (.splat / .ply point cloud) ──
  //
  // Three formats live behind this one menu entry:
  //
  //   1. Standard PLY with `red/green/blue` vertex colors (regular point
  //      clouds from MeshLab, CloudCompare, photogrammetry pipelines).
  //      PLYLoader reads them directly → vertexColors:true works as-is.
  //
  //   2. Gaussian Splat PLY (from INRIA's research repo, Polycam,
  //      LumaAI, etc.). Colors are NOT stored as red/green/blue —
  //      they're stored as the DC spherical-harmonic coefficients
  //      `f_dc_0`, `f_dc_1`, `f_dc_2`. Without decoding these you get
  //      a fluffy white blob. We sniff for the attribute and decode
  //      via the SH DC basis function (C0 = 0.28209479177387814):
  //          rgb = clamp01(0.5 + C0 * f_dc)
  //      Opacity is `sigmoid(opacity)` if present.
  //
  //   3. Raw .splat binary — 32-byte records:
  //         position[3] f32 + scale[3] f32 + color[4] u8 + rotation[4] u8
  //      Used by antimatter15/splat and similar viewers. Parsed inline
  //      so callers don't need a host loader. (Hosts can still override
  //      via `ui._splatLoader = (file) => Object3D` for fancier
  //      ellipsoid-based renderers.)
  //
  // For ALL paths we auto-scale point size from the geometry's bounding
  // box so the cloud is visible at any model scale, and use the alpha
  // map blending mode so dense splats don't saturate to white.
  { id: 'splat', label: 'Gaussian Splat', category: 'Model', icon: icons.gridFour,
    needsFile: '.splat,.ply',
    build: async ({ file, ui }) => {
      if (!file) throw new Error('No splat file selected');
      const name = file.name.toLowerCase();

      // Spherical-harmonic DC → linear RGB constant. The DC term of the
      // SH basis function for direction-independent color.
      const SH_C0 = 0.28209479177387814;
      const sigmoid = (x) => 1 / (1 + Math.exp(-x));

      // Pick a point size that scales with the model so 1cm-cube and
      // 100m-scene both look reasonable. Guard hard against NaN bounding
      // boxes — splat files occasionally have outlier positions that
      // make Math.hypot return NaN, which would make the material's
      // size NaN, which makes THREE.Points render NOTHING. Worst-case
      // fall back to a sane default.
      const autoPointSize = (geom) => {
        try {
          geom.computeBoundingBox();
          const b = geom.boundingBox;
          if (!b || !isFinite(b.min.x) || !isFinite(b.max.x)) return 0.02;
          const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
          const diag = Math.hypot(dx, dy, dz);
          if (!isFinite(diag) || diag <= 0) return 0.02;
          // 0.2% of the bbox diagonal — a few pixels at typical FOV.
          return Math.max(Math.min(diag * 0.002, diag * 0.1), 0.001);
        } catch { return 0.02; }
      };

      if (name.endsWith('.ply')) {
        const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
        const loader = new PLYLoader();
        // PLYLoader IGNORES properties it doesn't recognize unless we
        // tell it where to put them. Splat PLYs use `f_dc_0/1/2` for
        // color, `opacity` for alpha, plus `scale_0/1/2` and
        // `rot_0/1/2/3` for ellipsoid shape — we map all of them so
        // detection works. Missing properties just yield empty buffers
        // (safe to over-declare).
        loader.setCustomPropertyNameMapping({
          f_dc:    ['f_dc_0', 'f_dc_1', 'f_dc_2'],
          opacity: ['opacity'],
          scale:   ['scale_0', 'scale_1', 'scale_2'],
          rot:     ['rot_0', 'rot_1', 'rot_2', 'rot_3'],
        });
        const url = URL.createObjectURL(file);
        try {
          const geom = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
          geom.computeBoundingBox();
          // Detect each color path explicitly so we get the right
          // material settings AND a useful console hint.
          const hasStdColor = !!geom.getAttribute('color');
          const fDcAttr = geom.getAttribute('f_dc');
          const hasSplatColor = !!(fDcAttr && fDcAttr.itemSize === 3 && fDcAttr.count > 0);
          const opacityAttr = geom.getAttribute('opacity');

          let usingVertexColors = false;
          if (!hasStdColor && hasSplatColor) {
            // Gaussian-splat PLY → decode SH DC into a `color` buffer.
            // `f_dc` is packed [r,g,b] per vertex via itemSize=3, so
            // getX/Y/Z read the three coefficients for one vertex.
            const n = fDcAttr.count;
            const colors = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
              colors[i * 3 + 0] = clamp01(0.5 + SH_C0 * fDcAttr.getX(i));
              colors[i * 3 + 1] = clamp01(0.5 + SH_C0 * fDcAttr.getY(i));
              colors[i * 3 + 2] = clamp01(0.5 + SH_C0 * fDcAttr.getZ(i));
            }
            geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            usingVertexColors = true;
            // eslint-disable-next-line no-console
            console.info('[Ghost Panel] decoded Gaussian-splat colors from SH DC coefficients (', n, 'points)');
          } else if (hasStdColor) {
            usingVertexColors = true;
          } else {
            // No color anywhere. Generate a position-based palette so
            // the user can at least see structure instead of a blob.
            const pos = geom.getAttribute('position');
            if (pos) {
              const n = pos.count;
              const b = geom.boundingBox;
              const sx = 1 / Math.max(b.max.x - b.min.x, 1e-6);
              const sy = 1 / Math.max(b.max.y - b.min.y, 1e-6);
              const sz = 1 / Math.max(b.max.z - b.min.z, 1e-6);
              const colors = new Float32Array(n * 3);
              for (let i = 0; i < n; i++) {
                colors[i * 3 + 0] = (pos.getX(i) - b.min.x) * sx;
                colors[i * 3 + 1] = (pos.getY(i) - b.min.y) * sy;
                colors[i * 3 + 2] = (pos.getZ(i) - b.min.z) * sz;
              }
              geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
              usingVertexColors = true;
              // eslint-disable-next-line no-console
              console.info('[Ghost Panel] PLY has no color attribute; generated position-based palette');
            }
          }

          const material = new THREE.PointsMaterial({
            size: autoPointSize(geom),
            vertexColors: usingVertexColors,
            sizeAttenuation: true,
            color: 0xffffff,
            // Transparent + additive-ish blending helps splats avoid
            // saturating to white when many points overlap. If opacity
            // attribute exists, we still get per-point alpha via the
            // shader path Three uses for PointsMaterial.
            transparent: !!opacityAttr,
          });
          const points = new THREE.Points(geom, material);
          points.userData.sourceFilename = file.name;
          points.userData.splatKind = hasSplatColor ? 'gaussian-splat-ply'
            : hasStdColor ? 'ply'
            : 'ply-no-color';
          return points;
        } finally { URL.revokeObjectURL(url); }
      }

      // Raw .splat — try a host-registered loader first; otherwise use
      // the built-in 32-byte-record parser. Hosts override only when
      // they want fancier ellipsoid-based splat rendering (which needs
      // a real shader and is out of scope here).
      if (typeof ui?._splatLoader === 'function') {
        const obj = await ui._splatLoader(file);
        if (!obj) throw new Error('host splat loader returned no object');
        obj.userData = obj.userData || {};
        obj.userData.sourceFilename = file.name;
        return obj;
      }
      // Built-in parser: 32 bytes/record, n = bytes/32.
      //   pos[3]  : f32 (12 bytes)
      //   scale[3]: f32 (12 bytes)  ← unused in Points fallback
      //   color[4]: u8  (4 bytes)   ← RGBA
      //   rot[4]  : u8  (4 bytes)   ← unused in Points fallback
      const ab = await file.arrayBuffer();
      if (ab.byteLength % 32 !== 0) {
        throw new Error(`.splat file size (${ab.byteLength}) is not a multiple of 32 — not the expected raw splat format`);
      }
      const n = ab.byteLength / 32;
      const positions = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      const opacities = new Float32Array(n);
      const view = new DataView(ab);
      for (let i = 0; i < n; i++) {
        const base = i * 32;
        positions[i * 3 + 0] = view.getFloat32(base + 0,  true);
        positions[i * 3 + 1] = view.getFloat32(base + 4,  true);
        positions[i * 3 + 2] = view.getFloat32(base + 8,  true);
        // scale 12..23 skipped
        colors[i * 3 + 0] = view.getUint8(base + 24) / 255;
        colors[i * 3 + 1] = view.getUint8(base + 25) / 255;
        colors[i * 3 + 2] = view.getUint8(base + 26) / 255;
        opacities[i]      = view.getUint8(base + 27) / 255;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.computeBoundingBox();
      const material = new THREE.PointsMaterial({
        size: autoPointSize(geom),
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
      });
      const points = new THREE.Points(geom, material);
      points.userData.sourceFilename = file.name;
      points.userData.splatKind = 'splat-binary';
      points.userData.splatPointCount = n;
      // eslint-disable-next-line no-console
      console.info('[Ghost Panel] parsed', n, 'splat records from', file.name);
      return points;
    },
  },

  // ── Empty ──
  { id: 'empty', label: 'Empty', category: 'Empty', icon: icons.focusReticle,
    build: () => {
      const o = new THREE.Object3D();
      o.userData.isEmpty = true;
      return o;
    }
  },

  // ── Helpers ──
  { id: 'grid', label: 'Grid Helper', category: 'Helper', icon: icons.gridFour,
    build: () => new THREE.GridHelper(10, 10, 0x444444, 0x222222), isHelper: true },
  { id: 'axes', label: 'Axes Helper', category: 'Helper', icon: icons.arrowsOut,
    build: () => new THREE.AxesHelper(1), isHelper: true },
];

export class AddObjectMenu {
  constructor(ui) {
    this.ui = ui;
    this._counters = new Map();
    // Built-in 3D factories — default scope is the '3d' workflow.
    this._factories = FACTORIES.map(f => ({ workflows: ['3d'], ...f }));
    this._build();
    this._bindKeyboard();
  }

  /**
   * Register a new add-menu factory. Pass `workflows: [...]` to scope it
   * (e.g. ['2d'], ['animation']). Omit to make it visible always.
   *   ui._addMenu.register({
   *     id: 'circle', label: 'Circle', category: 'Shape',
   *     workflows: ['2d'], icon: '●',
   *     build: ({ host }) => host.addCircle(),
   *   });
   */
  register(factory) {
    if (!factory?.id) return;
    // Replace any existing factory with the same id
    const i = this._factories.findIndex(f => f.id === factory.id);
    if (i >= 0) this._factories[i] = factory;
    else this._factories.push(factory);
  }
  unregister(id) {
    this._factories = this._factories.filter(f => f.id !== id);
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'dui-add-menu';
    el.innerHTML = `
      <div class="dui-add-menu-header">
        <input class="dui-add-menu-search" placeholder="Search to add… (e.g. cube, light, image)" autocomplete="off">
      </div>
      <div class="dui-add-menu-list"></div>
      <div class="dui-add-menu-footer">
        <span><kbd>↑↓</kbd> navigate</span>
        <span><kbd>↵</kbd> add</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    `;
    document.body.appendChild(el);
    this.element = el;
    this.searchInput = el.querySelector('.dui-add-menu-search');
    this.listEl = el.querySelector('.dui-add-menu-list');

    this.searchInput.addEventListener('input', () => this._render());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key === 'ArrowDown') { this._move(1); e.preventDefault(); }
      if (e.key === 'ArrowUp')   { this._move(-1); e.preventDefault(); }
      if (e.key === 'Enter')     { this._activate(); e.preventDefault(); }
    });

    // Close on outside click
    this._onDocClick = (e) => {
      if (!el.contains(e.target)) this.close();
    };
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      // Shift+A → open menu
      if (e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        this.open();
      }
    });
  }

  open() {
    // Late-bind re-scan: a host might have added a new camera, mesh,
    // or animated GLTF model to its scene AFTER createGhostPanel() — the
    // initial autoRegisterScene pass wouldn't have seen it. We:
    //   1) Walk the scene again to surface late-added nodes in the
    //      outliner (cameras get their focus button, meshes their row).
    //   2) Re-run workflow detection via `ui.rescan()` so a newly
    //      loaded animation (e.g. GLTF clips) activates the
    //      animation workflow + spawns the Graph Editor folder.
    //
    // We respect the host's `autoRegister: false` opt-out for the full
    // scene scan (some projects have TransformControls / helpers in
    // their scene that they don't want polluting the outliner) — but
    // workflow re-detection always runs.
    try {
      const ui = this.ui;
      const allowFullScan = ui?._autoRegister !== false;
      if (allowFullScan && ui?._scene && ui?.objectManager?.registerCamera) {
        import('./three-extensions.js').then(({ autoRegisterScene }) => {
          autoRegisterScene(ui.objectManager, ui._scene);
        }).catch(() => {});
      }
      ui?.rescan?.();
    } catch {}
    this.element.classList.add('dui-visible');
    this.searchInput.value = '';
    this._selected = 0;
    this._render();
    setTimeout(() => {
      this.searchInput.focus();
      document.addEventListener('click', this._onDocClick);
    }, 0);
  }

  close() {
    this.element.classList.remove('dui-visible');
    document.removeEventListener('click', this._onDocClick);
  }

  _filtered() {
    const active = new Set(this.ui.activeWorkflows || []);
    // Workflow filter — factories without a `workflows` array are universal.
    let pool = this._factories.filter(f => {
      if (!f.workflows || !f.workflows.length) return true;
      return f.workflows.some(w => active.has(w));
    });
    const q = this.searchInput.value.toLowerCase().trim();
    if (!q) return pool;
    return pool.filter(f =>
      f.label.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      f.id.includes(q),
    );
  }

  _render() {
    const items = this._filtered();
    this._items = items;
    if (this._selected >= items.length) this._selected = Math.max(0, items.length - 1);

    // Auto-size the menu to its content so it grows/shrinks smoothly as
    // the user filters. The CSS transition on max-height does the rest.
    // Runs after this render call paints into the DOM.
    requestAnimationFrame(() => this._syncHeight());

    // Group by category, preserving definition order
    const groups = new Map();
    items.forEach(it => {
      if (!groups.has(it.category)) groups.set(it.category, []);
      groups.get(it.category).push(it);
    });

    this.listEl.innerHTML = '';

    // Empty state — when no factories match (either the active workflow
    // hasn't registered any, or the search query is too narrow), show a
    // friendly message instead of leaving the body blank. The previous
    // behavior rendered an empty rectangle below the search input, which
    // looked like the menu was broken.
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dui-add-menu-empty';
      const query = this.searchInput.value.trim();
      const activeFactories = this._factories.length;
      if (query) {
        empty.innerHTML = `
          <div class="dui-add-menu-empty-title">No matches for "${escapeHtml(query)}"</div>
          <div class="dui-add-menu-empty-hint">Clear the search or try a different keyword.</div>
        `;
      } else if (activeFactories === 0) {
        empty.innerHTML = `
          <div class="dui-add-menu-empty-title">No add-menu items yet</div>
          <div class="dui-add-menu-empty-hint">Register factories with <code>ui._addMenu.register({ id, label, build })</code>.</div>
        `;
      } else {
        empty.innerHTML = `
          <div class="dui-add-menu-empty-title">Nothing available in this workflow</div>
          <div class="dui-add-menu-empty-hint">Activate a workflow (3D / 2D / Web) or register factories without a <code>workflows</code> scope.</div>
        `;
      }
      this.listEl.appendChild(empty);
      return;
    }

    let flatIndex = 0;
    for (const [category, list] of groups) {
      const heading = document.createElement('div');
      heading.className = 'dui-add-menu-group';
      heading.textContent = category;
      this.listEl.appendChild(heading);

      list.forEach(it => {
        const row = document.createElement('button');
        row.className = 'dui-add-menu-item' + (flatIndex === this._selected ? ' dui-active' : '');
        row.innerHTML = `
          <span class="dui-add-menu-icon">${it.icon}</span>
          <span class="dui-add-menu-label">${it.label}</span>
          ${it.needsFile ? '<span class="dui-add-menu-tag">file</span>' : ''}
        `;
        const idx = flatIndex;
        row.addEventListener('mouseenter', () => {
          this._selected = idx; this._highlight();
        });
        row.addEventListener('click', () => this._activate(idx));
        this.listEl.appendChild(row);
        flatIndex++;
      });
    }
  }

  _highlight() {
    const rows = this.listEl.querySelectorAll('.dui-add-menu-item');
    rows.forEach((r, i) => r.classList.toggle('dui-active', i === this._selected));
    const active = rows[this._selected];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Pin the menu's max-height to its actual content height so it shrinks
   * smoothly as the user filters down. Capped at 56vh / 500px so it never
   * outgrows the viewport. Header and footer are fixed-content; only the
   * list portion is variable, so the measurement uses scrollHeight there.
   */
  _syncHeight() {
    if (!this.element || !this.listEl) return;
    const header = this.element.querySelector('.dui-add-menu-header');
    const footer = this.element.querySelector('.dui-add-menu-footer');
    const headerH = header ? header.offsetHeight : 0;
    const footerH = footer ? footer.offsetHeight : 0;
    const listH   = this.listEl.scrollHeight;
    // 8px chrome buffer (border + a touch of breathing room).
    const total = headerH + listH + footerH + 8;
    const cap = Math.min(window.innerHeight * 0.56, 500);
    this.element.style.maxHeight = `${Math.min(total, cap)}px`;
  }

  _move(delta) {
    if (!this._items.length) return;
    this._selected = (this._selected + delta + this._items.length) % this._items.length;
    this._highlight();
  }

  async _activate(idx) {
    const i = idx ?? this._selected;
    const item = this._items[i];
    if (!item) return;
    this.close();
    await this._add(item);
  }

  async _add(factory) {
    // Generate a unique auto-name like Cube, Cube.001, Cube.002. The
    // internal `_counters` map alone isn't enough — the host may have
    // pre-registered an object with the same base name (the demo
    // registers "Cube", "Sphere", "TorusKnot"). If we picked that name,
    // ObjectManager.register would silently bail (because the slot is
    // already taken) and the undo entry would later remove the wrong
    // object. Cross-check against the live object map so we always
    // land on a fresh name.
    const baseName = factory.label.replace(/[^a-zA-Z0-9]+/g, '');
    const taken = (n) => !!this.ui.objectManager?.objects?.[n];
    let count = this._counters.get(factory.id) || 0;
    let name = count === 0 ? baseName : `${baseName}.${String(count).padStart(3, '0')}`;
    while (taken(name)) {
      count += 1;
      name = `${baseName}.${String(count).padStart(3, '0')}`;
    }
    this._counters.set(factory.id, count + 1);

    // File-driven factories (e.g. image plane) prompt for file
    let file = null;
    if (factory.needsFile) {
      file = await pickFile(factory.needsFile);
      if (!file) return;
    }

    // Non-3D factories handle their own insertion via a `host` callback.
    // (See e.g. the 2D demo registering a Circle factory.) We still push
    // a generic remove/register undo entry so Cmd+Z reverts the add —
    // the host's factory.build is expected to register the object with
    // the object manager itself before returning.
    if (factory.workflows && !factory.workflows.includes('3d')) {
      let obj;
      try {
        obj = await factory.build({ file, name, ui: this.ui });
      } catch (err) {
        // Surface the error as a toast so the user knows something went
        // wrong (otherwise the click + file pick produces nothing — easy
        // to think the menu is broken). Re-throw to the console for diag.
        console.error(`[Ghost Panel] ${factory.label || factory.id} build failed:`, err);
        showToast(`${factory.label || factory.id}: ${err?.message || 'failed'}`, { kind: 'error' });
        return;
      }
      if (typeof factory.onAdded === 'function') factory.onAdded(obj, name, this.ui);
      // Non-3D factories often choose their own name + register themselves
      // (e.g. the 2D demo's Circle/Rect factories: `obj.name = 'rect.06'`
      // then `om.register(obj.name, obj)`). Prefer that name for the undo
      // entry so a later undo targets the slot the factory actually
      // created — otherwise undo removes a non-existent "Rectangle" key
      // while the real "rect.06" entry persists.
      const registeredName = (obj && typeof obj.name === 'string' && this.ui.objectManager?.objects?.[obj.name])
        ? obj.name
        : name;
      this._pushAddUndo(registeredName, obj, factory);
      return;
    }

    let obj;
    try {
      obj = await factory.build({ file, ui: this.ui });
    } catch (err) {
      // Same error-surfacing pattern for 3D factories. The 'ui' arg used
      // to be omitted here, but the splat factory needs it for the host
      // loader override path — pass it consistently with the non-3D
      // branch above.
      console.error(`[Ghost Panel] ${factory.label || factory.id} build failed:`, err);
      showToast(`${factory.label || factory.id}: ${err?.message || 'failed'}`, { kind: 'error' });
      return;
    }
    if (!obj) return;
    obj.name = name;

    // Position at world origin by default; users can move via gizmo / G key
    const scene = this.ui._scene;
    if (!scene) {
      console.warn('[Ghost Panel] No scene available to add to');
      return;
    }
    scene.add(obj);

    // Register with the object manager so it shows up in the outliner
    const om = this.ui.objectManager;
    if (om) {
      if (factory.isLight) {
        om.registerLight?.(name, obj) ?? om.register(name, obj);
      } else if (factory.isCamera) {
        om.registerCamera?.(name, obj) ?? om.register(name, obj);
      } else {
        om.register(name, obj);
      }
      // Auto-select the newly added object so the user can immediately
      // move/rotate/scale via the canvas or keyboard.
      om.select(name);
      this.ui.refreshSceneObjects?.();
    }
    // Frame the camera on point clouds + meshes that came from a file —
    // splats and GLTF imports can land at arbitrary world scales and
    // positions, so without auto-framing the user gets a blank viewport
    // and thinks the load failed. Built-in primitives (Cube, Sphere)
    // are always at the origin at unit scale and don't need this.
    if (factory.needsFile && obj.geometry) {
      this._frameCameraOn(obj);
    }
    this._pushAddUndo(name, obj, factory);
  }

  /**
   * Aim the camera at the object and pull back to fit its bounding
   * sphere in view. Uses OrbitControls' .target if present so subsequent
   * orbit feels natural. No-op if camera/controls aren't available.
   */
  _frameCameraOn(obj) {
    const camera = this.ui._camera;
    const controls = this.ui._controls;
    if (!camera || !obj.geometry) return;
    try {
      obj.geometry.computeBoundingSphere();
      const sphere = obj.geometry.boundingSphere;
      if (!sphere || !isFinite(sphere.radius) || sphere.radius <= 0) return;
      const center = sphere.center.clone().applyMatrix4(obj.matrixWorld);
      const radius = sphere.radius;
      // Use FOV to compute how far the camera should be from the centre
      // to fit the sphere comfortably. Pad by 1.5× so there's framing.
      const fov = (camera.fov || 60) * Math.PI / 180;
      const distance = (radius / Math.sin(fov / 2)) * 1.5;
      const dir = camera.position.clone().sub(controls?.target || new THREE.Vector3()).normalize();
      if (!isFinite(dir.x)) dir.set(0, 0, 1);
      camera.position.copy(center).addScaledVector(dir, distance);
      if (controls?.target) controls.target.copy(center);
      camera.near = Math.max(distance / 1000, 0.001);
      camera.far  = Math.max(distance * 1000, 100);
      camera.updateProjectionMatrix();
      controls?.update?.();
    } catch (e) {
      console.warn('[Ghost Panel] auto-frame failed:', e);
    }
  }

  /**
   * Record the spawn so Cmd+Z reverts it. Both 3D and non-3D paths use
   * this — the registration path may differ, but the inverse pair
   * (remove → re-register) is identical. _suppress flips off the
   * objectManager 'remove' listener so we don't double-push.
   */
  _pushAddUndo(name, obj, factory) {
    const ui = this.ui;
    const om = ui.objectManager;
    if (!ui._undo || !om) return;
    const scene = ui._scene;
    const wasInScene = !!(scene && obj?.parent);
    const reAdd = () => {
      if (wasInScene && scene && !obj.parent) scene.add(obj);
      if (factory.isLight)      om.registerLight?.(name, obj) ?? om.register(name, obj);
      else if (factory.isCamera) om.registerCamera?.(name, obj) ?? om.register(name, obj);
      else                       om.register(name, obj);
      om.select?.(name);
      ui.refreshSceneObjects?.();
    };
    const reRemove = () => { om.remove(name); };
    ui._undo.push({
      label: `add ${factory.label || name}`,
      undo: () => { ui._undo._suppress = true; try { reRemove(); } finally { ui._undo._suppress = false; } },
      redo: () => { ui._undo._suppress = true; try { reAdd();   } finally { ui._undo._suppress = false; } },
    });
  }

  dispose() {
    this.element.remove();
  }
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-1000px';
    document.body.appendChild(input);
    input.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      input.remove();
      resolve(f || null);
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    input.click();
  });
}
