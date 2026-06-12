/**
 * Optional Three.js extensions for Ghost Panel. Only loaded when the user passes
 * { scene, camera, renderer, controls } to createGhostPanel(). All Three.js
 * imports are dynamic so the base library works in 2D / non-Three.js contexts.
 */

// Eagerly import Three.js (and TransformControls) at module-load time. Users
// only end up here if they passed scene/camera/renderer to createGhostPanel, so
// they already have Three.js loaded — sharing the same instance is essential
// for `instanceof` checks to pass. Dynamic import made the early-init path
// racy: synchronous register*() calls would arrive before `await import()`
// completed.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { icons } from './icons.js';
import { confirmDialog } from './modal.js';
async function loadThree() { /* no-op — already loaded */ }

/**
 * Manages a registered set of scene objects with a shared transform gizmo.
 * Objects can be selected, gizmo mode toggled (translate / rotate / scale),
 * and state serialized to JSON.
 */
/**
 * Resolve the "real" camera for a registered object.
 *
 * Returns the first camera found via, in order:
 *   1. The object itself (Three.js's `isCamera` flag).
 *   2. The host's explicit opt-in via `userData.__duiCameraRef`.
 *   3. Any Camera descendant of the object's subtree.
 *   4. Otherwise null (the entry isn't a camera).
 *
 * Used by `register()` to auto-tag camera-like entries even when the
 * host wrapped the camera in a Group / Object3D rig.
 */
function findNestedCamera(obj) {
  if (!obj) return null;
  if (obj.isCamera) return obj;
  const explicit = obj.userData?.__duiCameraRef;
  if (explicit && explicit.isCamera) return explicit;
  if (typeof obj.traverse === 'function') {
    let found = null;
    obj.traverse(c => { if (!found && c?.isCamera) found = c; });
    if (found) return found;
  }
  return null;
}

export class SceneObjectManager {
  constructor({ scene, camera, renderer, controls }) {
    this.scene = scene; this.camera = camera;
    this.renderer = renderer; this.orbitControls = controls;
    this.objects = {};         // name -> { object, registered }
    this.activeName = null;
    this.currentMode = 'translate';
    this._listeners = { change: [], remove: [], register: [], rename: [] };
    this._ready = false;
    this._init();
  }

  async _init() {
    await loadThree();
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(1.0);
    // Three.js r0.165+ split TransformControls into controller + helper via
    // `getHelper()`. On r0.160 (this project's pin) TransformControls *is*
    // the Object3D you add to the scene, so polyfill the method to return
    // itself — keeps the rest of the code version-agnostic.
    if (typeof this.gizmo.getHelper !== 'function') {
      this.gizmo.getHelper = () => this.gizmo;
    }
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.getHelper().visible = false;

    // Blender-style colors: red=X, green=Y, blue=Z, yellow=selected, white=center.
    // TransformControls renders sub-gizmos under .gizmo.gizmo.{translate,rotate,scale};
    // each axis Mesh has a `name` like 'X', 'Y', 'Z', 'XYZ', 'XY', etc. We tint
    // their materials so the entire gizmo set matches Blender's conventions.
    this._styleGizmoLikeBlender();

    this.gizmo.addEventListener('dragging-changed', (e) => {
      if (this.orbitControls) this.orbitControls.enabled = !e.value;
      // Let hosts that withhold `controls` (so Ghost Panel doesn't seize the
      // camera) still pause their own camera controls while the built-in gizmo
      // drags — otherwise the gizmo and the host's OrbitControls fight.
      try { this._onDraggingChanged?.(e.value); } catch {}
      // Pause/resume the AnimationMixer for the active object while dragging,
      // otherwise the mixer keeps overwriting position/rotation from its track
      // and the gizmo "snaps back". When drag ends, resume playback.
      const entry = this.activeName ? this.objects[this.activeName] : null;
      const obj = entry?.object;
      if (!obj) return;
      const findMixer = (n) => {
        let node = n;
        while (node) {
          if (node.userData?.mixer) return node.userData.mixer;
          node = node.parent;
        }
        return null;
      };
      const mixer = findMixer(obj);
      if (!mixer) return;
      if (e.value) {
        // Starting drag — remember current timeScale and stop the mixer
        obj.userData.__mixerWasPlaying = mixer.timeScale !== 0;
        mixer.timeScale = 0;
      } else {
        // Ending drag — resume only if it was playing before
        if (obj.userData.__mixerWasPlaying) mixer.timeScale = 1;
      }
    });
    this.gizmo.addEventListener('change', () => {
      if (this.activeName) {
        this._listeners.change.forEach(cb =>
          cb(this.activeName, this.objects[this.activeName]?.object));
      }
    });
    this._ready = true;

    // Hook up canvas click-to-select + keyboard shortcuts.
    this._attachInteraction();
  }

  /**
   * Recolor the TransformControls sub-meshes to match Blender's axis convention.
   * The library exposes the inner gizmo via .gizmo.gizmo (plain THREE.Object3D
   * containing translate/rotate/scale sub-groups, each with named axis meshes).
   */
  _styleGizmoLikeBlender() {
    const COLOR_X = new THREE.Color('#ff4040');
    const COLOR_Y = new THREE.Color('#40c040');
    const COLOR_Z = new THREE.Color('#4080ff');
    const COLOR_W = new THREE.Color('#ffffff');
    const apply = (object) => {
      if (!object) return;
      object.traverse(child => {
        if (!child.material || !child.name) return;
        const m = child.material;
        const n = child.name;
        // Skip "picker" objects (transparent hit targets)
        if (m.transparent && m.opacity < 0.5 && !n.startsWith('AXIS') && !n.includes('helper')) {
          // these are normally hit zones, leave alone
        }
        if (n === 'X' || n.startsWith('AXIS_X') || n === 'X+' || n === 'X-') {
          m.color && m.color.copy(COLOR_X);
        } else if (n === 'Y' || n.startsWith('AXIS_Y') || n === 'Y+' || n === 'Y-') {
          m.color && m.color.copy(COLOR_Y);
        } else if (n === 'Z' || n.startsWith('AXIS_Z') || n === 'Z+' || n === 'Z-') {
          m.color && m.color.copy(COLOR_Z);
        } else if (n === 'XYZ' || n === 'XYZE') {
          m.color && m.color.copy(COLOR_W);
        }
      });
    };
    // The gizmo's internal helper structure may not exist immediately —
    // wait a frame, then apply (and re-apply on mode changes).
    requestAnimationFrame(() => apply(this.gizmo.getHelper()));
    this.gizmo.addEventListener('change', () => apply(this.gizmo.getHelper()));
  }

  _attachInteraction() {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0, downY = 0;

    // Track click vs drag — only select on near-stationary click
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downX = e.clientX; downY = e.clientY;
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist > 4) return;            // it was a drag, not a click
      if (this.gizmo.dragging) return; // gizmo handled this
      const r = this.renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, this.camera);
      // Raycast strategy: gather hits against real registered objects
      // and against their helpers separately, then merge with bias.
      //
      // Filter `.visible !== false` because Raycaster.intersectObjects
      // does NOT honor `.visible` (it only tests layers + the object's
      // own raycast()). A hidden CameraHelper at the camera origin
      // would otherwise hit every click at distance 0.
      //
      // Merge rule (in priority order):
      //   1. If the closest helper hit is NOTICEABLY closer than the
      //      closest object hit, the user is clearly clicking on the
      //      helper's wireframe — pick it. "Noticeably" means the
      //      object hit is ≥ helper hit + 0.5 world units away.
      //   2. Otherwise prefer the closest object hit, even if a helper
      //      sits in front. This prevents wireframe lines from
      //      light/camera helpers from stealing clicks meant for the
      //      mesh visually behind them (a sphere with a directional
      //      light helper line crossing in front would otherwise
      //      select the light, not the sphere).
      //   3. If there are no object hits at all, fall back to the
      //      closest helper hit — so clicking a standalone light or
      //      camera helper still selects its source.
      const objectTargets = Object.values(this.objects)
        .map(o => o.object).filter(t => t && t.visible !== false);
      const helperTargets = Object.values(this.objects)
        .map(o => o.helper).filter(t => t && t.visible !== false);
      const objHits  = raycaster.intersectObjects(objectTargets, true);
      const helpHits = raycaster.intersectObjects(helperTargets, true);

      let hit = null;
      const HELPER_PRIORITY_MARGIN = 0.5;
      if (objHits.length && helpHits.length) {
        if (helpHits[0].distance + HELPER_PRIORITY_MARGIN < objHits[0].distance) {
          hit = helpHits[0].object;     // helper is clearly in front
        } else {
          hit = objHits[0].object;       // prefer the mesh
        }
      } else if (objHits.length) {
        hit = objHits[0].object;
      } else if (helpHits.length) {
        hit = helpHits[0].object;
      }

      if (hit) {
        // Walk up until we find a registered root OR a registered helper.
        let node = hit;
        while (node) {
          const match = Object.entries(this.objects).find(
            ([_n, e]) => e.object === node || e.helper === node
          );
          if (match) { this.select(match[0]); return; }
          node = node.parent;
        }
      } else {
        this.deselect();
      }
    });

    // Keyboard shortcuts:
    //   Esc                    deselect
    //   Delete / Backspace     remove the selected object from the scene
    // G / R / S are intercepted by the ModalTransform layer (modal grab /
    // rotate / scale driven by mouse position), so we deliberately skip them.
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      if (e.key === 'Escape' && this.activeName) this.deselect();
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.activeName) {
        e.preventDefault();
        const name = this.activeName;
        // No confirm — the canvas-flow assumes deliberate keypress + visible
        // outliner refresh is enough feedback. (Use Ctrl+Z later for undo.)
        this.remove(name);
      }
    });
  }

  /**
   * Register an existing Three.js Object3D for management.
   *
   * Auto-tags `kind` (and `cameraRef` for cameras) so the outliner can
   * recognize the entry even when the host used the generic
   * `register()` path. Three detection layers, cheapest first:
   *
   *   1. The object IS a Camera / Light / Mesh — duck-type via the
   *      `is*` flags Three.js sets on every node.
   *   2. The object opted in via `userData.__duiCameraRef = innerCamera`
   *      — explicit hook for wrappers that don't satisfy isCamera but
   *      conceptually represent a camera (GLTF rigs, dolly nodes, etc.).
   *   3. The object has a Camera DESCENDANT in its subtree — common for
   *      GLTF-imported scenes where the camera is a child of a named
   *      Group / Object3D wrapper. We bind to the first one found.
   *
   * Without (2) and (3), projects that pass a Group named
   * "PerspectiveCamera" containing the actual camera would see a
   * generic cube row instead of a proper camera row + focus button.
   */
  register(name, object, opts = {}) {
    if (this.objects[name]) return;
    const entry = { object };
    // Optional explicit parent for outliner nesting — so hosts don't have to
    // reach into `objects[name].parentObj`. The parent should also be registered
    // (and expandable) for the child row to nest beneath it.
    if (opts.parent) entry.parentObj = opts.parent;
    const camRef = findNestedCamera(object);
    if (camRef) {
      entry.kind = 'camera';
      entry.cameraRef = camRef;
    } else if (object?.isLight) {
      entry.kind = 'light';
    } else if (object?.isMesh) {
      entry.kind = 'mesh';
    }
    this.objects[name] = entry;
    // Mirror ObjectManager's contract — downstream views (Outliner, Cmd+V
    // paste, contextual panel) listen on 'register' / 'change' to refresh.
    this._listeners.register?.forEach(cb => { try { cb(name, object); } catch {} });
    this._listeners.change?.forEach(cb => { try { cb(this.activeName, this.objects[this.activeName]?.object); } catch {} });
  }

  /**
   * Remove an object from the scene AND the manager. Disposes geometry/material
   * to free GPU memory and triggers a 'change' event so the Outliner refreshes.
   */
  remove(name) {
    const entry = this.objects[name];
    if (!entry) return;
    // Drop from multi-selection set (and clear primary if needed)
    if (this._selectedNames?.has(name)) {
      this._selectedNames.delete(name);
      if (this.activeName === name) {
        this.activeName = this._selectedNames.size ? [...this._selectedNames].pop() : null;
      }
    }
    if (this.activeName === name) this.deselect();
    // Remove from scene graph
    if (entry.object?.parent) entry.object.parent.remove(entry.object);
    if (entry.helper?.parent)  entry.helper.parent.remove(entry.helper);
    if (entry.target?.parent)  entry.target.parent.remove(entry.target);
    // Dispose geometry + materials recursively
    entry.object?.traverse?.(node => {
      if (node.geometry?.dispose) node.geometry.dispose();
      const mat = node.material;
      const mats = Array.isArray(mat) ? mat : (mat ? [mat] : []);
      mats.forEach(m => m?.dispose?.());
    });
    // Stop any animation mixers attached
    if (entry.object?.userData?.mixer) {
      entry.object.userData.mixer.stopAllAction();
      entry.object.userData.mixer = null;
    }
    const removed = entry.object;
    delete this.objects[name];
    // 'remove' fires before 'change' so downstream views (graph editor, etc.)
    // can prune any per-object state using the actual reference.
    this._listeners.remove?.forEach(cb => { try { cb(name, removed); } catch {} });
    this._listeners.change?.forEach(cb => cb(this.activeName, null));
  }

  /**
   * Register a Light and automatically add a visualizer helper so the user
   * can see and click on it. Supports DirectionalLight, PointLight, SpotLight,
   * HemisphereLight, RectAreaLight.
   */
  registerLight(name, light) {
    if (this.objects[name] || !light) return;
    let helper;
    const type = light.type || light.constructor.name;
    if (type === 'DirectionalLight')  helper = new THREE.DirectionalLightHelper(light, 0.5);
    else if (type === 'PointLight')   helper = new THREE.PointLightHelper(light, 0.3);
    else if (type === 'SpotLight')    helper = new THREE.SpotLightHelper(light);
    else if (type === 'HemisphereLight') helper = new THREE.HemisphereLightHelper(light, 0.3);
    if (helper) this.scene.add(helper);
    this.objects[name] = { object: light, helper, kind: 'light' };
    // Update helper each frame to track light movement
    if (helper && helper.update) {
      this._helperUpdaters = this._helperUpdaters || [];
      this._helperUpdaters.push(() => helper.update());
    }
    // Notify listeners so downstream views update immediately.
    this._listeners.register?.forEach(cb => { try { cb(name, light); } catch {} });
    this._listeners.change?.forEach(cb => { try { cb(this.activeName, this.objects[this.activeName]?.object); } catch {} });
  }

  /**
   * Register a Camera and automatically attach a CameraHelper visualization.
   * Pass `attachTransformProxy: true` to attach the gizmo to an empty Object3D
   * that drives the camera position/rotation (avoids moving the active camera
   * by accident).
   */
  registerCamera(name, camera, opts = {}) {
    if (this.objects[name] || !camera) return;
    const helper = new THREE.CameraHelper(camera);
    // CameraHelper's frustum lines pass through the camera apex, so its
    // bounding sphere computes to NaN — Three.js then spams the console
    // with "Computed radius is NaN" warnings on every render. Disabling
    // frustum culling on the helper skips that bounding-sphere math
    // entirely (the helper is tiny and always near the active view so
    // culling savings would be negligible anyway).
    helper.frustumCulled = false;
    // The helper for the main viewport camera draws its near-plane
    // crosshair right through the center of the screen (because you're
    // sitting at the camera's origin). Hide it by default — POV mode
    // restores visibility when looking through a different camera.
    if (camera === this.camera) helper.visible = false;
    this.scene.add(helper);
    let target = camera;
    if (opts.attachTransformProxy) {
      const proxy = new THREE.Object3D();
      proxy.position.copy(camera.position);
      proxy.quaternion.copy(camera.quaternion);
      this.scene.add(proxy);
      // Bidirectional sync: when proxy moves → camera moves
      proxy.userData.syncCamera = () => {
        camera.position.copy(proxy.position);
        camera.quaternion.copy(proxy.quaternion);
      };
      target = proxy;
    }
    this.objects[name] = { object: target, helper, kind: 'camera', cameraRef: camera };
    if (helper && helper.update) {
      this._helperUpdaters = this._helperUpdaters || [];
      this._helperUpdaters.push(() => helper.update());
    }
    // Notify listeners so downstream views (Outliner, contextual inspector,
    // camera button) react to the new camera immediately.
    this._listeners.register?.forEach(cb => { try { cb(name, target); } catch {} });
    this._listeners.change?.forEach(cb => { try { cb(this.activeName, this.objects[this.activeName]?.object); } catch {} });
  }

  /** Call each frame so light/camera helpers track their source. */
  updateHelpers() {
    (this._helperUpdaters || []).forEach(fn => fn());
    // Also sync any camera proxies
    Object.values(this.objects).forEach(e => {
      if (e.object?.userData?.syncCamera) e.object.userData.syncCamera();
    });
  }

  /** Load a glTF/GLB and register it. Requires GLTFLoader (caller provides). */
  async loadGLTF(name, url, GLTFLoader, opts = {}) {
    await loadThree();
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(url, (gltf) => {
        const group = new THREE.Group();
        group.name = name;
        group.add(gltf.scene);
        if (opts.position) group.position.set(opts.position.x, opts.position.y, opts.position.z);
        if (opts.rotation) group.rotation.set(opts.rotation.x, opts.rotation.y, opts.rotation.z);
        if (opts.scale != null) group.scale.setScalar(opts.scale);
        if (opts.visible === false) group.visible = false;
        this.scene.add(group);
        this.objects[name] = { object: group, gltf };
        resolve(group);
      }, undefined, reject);
    });
  }

  /**
   * Select an object. Pass `{ additive: true }` to ADD to the existing
   * selection rather than replace it (the shift-click pattern).
   *
   *   om.select('Sphere');                          // single
   *   om.select('Cube', { additive: true });        // adds Cube
   *   om.select('Sphere', { additive: true });      // toggles Sphere off
   *
   * The most-recently-clicked name becomes `activeName` — that's the
   * "primary" selection, the one the mini transform toolbar drives.
   * Use `getSelectedNames()` to read the full set.
   */
  select(name, opts = {}) {
    if (!this._ready || !this.objects[name]) return;
    this._selectedNames = this._selectedNames || new Set();
    if (opts.additive) {
      // Toggle behavior: shift-clicking an already-selected row removes
      // it; otherwise the row joins the multi-selection. The primary
      // (activeName) always points at the most-recent action target.
      if (this._selectedNames.has(name)) {
        this._selectedNames.delete(name);
        // Pick a new primary if we just removed the current one.
        if (this.activeName === name) {
          this.activeName = this._selectedNames.size
            ? [...this._selectedNames].pop()
            : null;
        }
      } else {
        this._selectedNames.add(name);
        this.activeName = name;
      }
    } else {
      // Non-additive click clears multi-selection and starts fresh.
      this._selectedNames.clear();
      this._selectedNames.add(name);
      this.activeName = name;
    }
    // TransformControls.attach() expects the target to be in the active
    // scene graph; if it isn't, TransformControls re-warns every render
    // frame ("must be a part of the scene graph"). Cameras created
    // standalone (not added to the scene) and AmbientLight (no position
    // to manipulate) both fail this check. Detach the gizmo for those
    // — they're driven by the contextual Camera Settings / Light folders
    // in the inspector instead of by a canvas gizmo.
    const entry = this.objects[name];
    const obj = entry.object;
    const skipGizmo =
      // Whole built-in gizmo turned off via `createGhostPanel({ gizmo: false })`
      // — for hosts that run their own transform rig.
      this._gizmoDisabled ||
      entry.kind === 'camera' ||
      obj?.isAmbientLight ||
      obj?.type === 'AmbientLight' ||
      // Host-driven objects opt out of the built-in gizmo (e.g. a selection
      // pivot the host drives with its own TransformControls). The contextual
      // mini toolbar still binds to them so their transform stays editable.
      obj?.userData?.__duiIgnore ||
      // Per-object routing hook: return false to let the host's rig own this
      // object's transform instead of the built-in gizmo.
      (typeof this._beforeGizmoAttach === 'function' && this._beforeGizmoAttach(obj) === false) ||
      // Generic safety net: anything not currently in our scene graph.
      !this._isInScene(obj) ||
      // Multi-select: the gizmo always tracks the PRIMARY (most-recent)
      // click. Without an active primary, nothing to attach to.
      !this.activeName;
    if (skipGizmo) {
      this.gizmo.detach();
      this.gizmo.getHelper().visible = false;
    } else {
      const primary = this.objects[this.activeName]?.object;
      if (primary) {
        this.gizmo.attach(primary);
        this.gizmo.getHelper().visible = true;
        this.gizmo.setMode(this.currentMode);
      } else {
        this.gizmo.detach();
        this.gizmo.getHelper().visible = false;
      }
    }
    // Mirror the generic ObjectManager — explicit 'change' fire so the
    // contextual inspector (mini toolbar, Material folder), folder
    // visibility gates, and any other 'change' listener react reliably
    // to canvas-click selection.
    this._listeners.change?.forEach(cb => { try { cb(this.activeName, this.objects[this.activeName]?.object); } catch {} });
  }

  /** Return a snapshot of every selected name (including the primary). */
  getSelectedNames() {
    return this._selectedNames ? [...this._selectedNames] : (this.activeName ? [this.activeName] : []);
  }

  /** Walk parents up to see whether obj sits in this manager's scene. */
  _isInScene(obj) {
    if (!obj || !this.scene) return false;
    let n = obj;
    while (n) {
      if (n === this.scene) return true;
      n = n.parent;
    }
    return false;
  }
  deselect() {
    this.activeName = null;
    if (this._selectedNames) this._selectedNames.clear();
    if (this.gizmo) {
      this.gizmo.detach();
      this.gizmo.getHelper().visible = false;
    }
    this._listeners.change?.forEach(cb => { try { cb(null, null); } catch {} });
  }
  setMode(mode) {
    this.currentMode = mode;
    if (this.gizmo) this.gizmo.setMode(mode);
  }
  setSpace(space) { if (this.gizmo) this.gizmo.setSpace(space); }
  setVisible(v) { if (this.gizmo) this.gizmo.getHelper().visible = v && !!this.activeName; }

  getNames() { return Object.keys(this.objects); }
  getObject(name) { return this.objects[name]?.object || null; }
  has(name) { return !!this.objects[name]; }

  /**
   * Kind of the registered entry — 'mesh' / 'light' / 'camera' / etc.
   * Useful when `registerCamera` was called with `attachTransformProxy:
   * true`: the stored `object` is an Object3D proxy without `isCamera`,
   * so outliner / contextual rendering can't rely on duck-typing alone.
   */
  kindOf(name) { return this.objects[name]?.kind || null; }

  /**
   * The underlying camera registered against this entry. Returns the
   * raw camera even when `attachTransformProxy: true` stored a proxy
   * under `object`. For non-camera entries returns null.
   */
  getCameraRef(name) {
    const e = this.objects[name];
    if (!e || e.kind !== 'camera') return null;
    return e.cameraRef || e.object;
  }
  /** Rename a registered entry (and the underlying Object3D.name). */
  rename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return false;
    if (!this.objects[oldName] || this.objects[newName]) return false;
    this.objects[newName] = this.objects[oldName];
    delete this.objects[oldName];
    if (this.activeName === oldName) this.activeName = newName;
    const entry = this.objects[newName];
    if (entry?.object && 'name' in entry.object) entry.object.name = newName;
    this._listeners.rename?.forEach(cb => { try { cb(oldName, newName); } catch {} });
    this._listeners.change?.forEach(cb => { try { cb(this.activeName, entry?.object); } catch {} });
    return true;
  }

  getState(name) {
    const o = this.objects[name]?.object;
    if (!o) return null;
    return {
      position: { x: o.position.x, y: o.position.y, z: o.position.z },
      rotation: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
      scale: o.scale.x,
      visible: o.visible,
    };
  }
  applyState(name, state) {
    const o = this.objects[name]?.object;
    if (!o || !state) return;
    if (state.position) o.position.set(state.position.x, state.position.y, state.position.z);
    if (state.rotation) o.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
    if (state.scale != null) o.scale.setScalar(state.scale);
    if (state.visible != null) o.visible = state.visible;
  }

  on(event, cb) { (this._listeners[event] ||= []).push(cb); }

  dispose() {
    if (this.gizmo) {
      this.gizmo.detach();
      this.scene.remove(this.gizmo.getHelper());
    }
  }
}

/**
 * Add a built-in "Scene Objects" folder that lists registered objects with
 * select / show / hide / focus controls and a gizmo-mode toggle.
 */
export function addSceneObjectsFolder(panel, objectManager) {
  // Skip the header — the host panel (the "Scene" sidebar) already
  // labels what's inside this section, so "Outliner" as a sub-header
  // was just duplicate chrome. We still create a folder so the existing
  // accessor (`ui.refreshSceneObjects()`) keeps working unchanged.
  const folder = panel.addFolder('Outliner', { headerless: true });
  // Note: Move/Rotate/Scale buttons live in the workflow's Tool folder + the
  // left toolbar, not here. The Outliner is a pure scene-tree navigator.

  const listEl = document.createElement('div');
  listEl.className = 'dui-list';
  folder.addRaw(listEl);

  // All outliner glyphs come from the shared Phosphor-style icon set
  // so the row chrome reads as one family with the rest of the panel.
  // Previously these were Unicode characters (◼ ● ◯ ▭ etc) which
  // shifted weight + size with the user's system font and broke the
  // visual rhythm of the list.
  const FOCUS_ICON = icons.focusReticle;

  function iconFor(obj) {
    if (!obj) return icons.cube;
    if (obj.isCamera) return icons.camera;
    if (obj.isLight) {
      if (obj.isDirectionalLight) return icons.sun;
      if (obj.isSpotLight)        return icons.spotlight;
      if (obj.isRectAreaLight)    return icons.rectangle;
      if (obj.isPointLight)       return icons.pointLight;
      if (obj.isHemisphereLight)  return icons.ambient;
      if (obj.isAmbientLight)     return icons.ambient;
      return icons.sun;
    }
    if (obj.isMesh) {
      const g = obj.geometry?.type || '';
      if (g.includes('Box'))      return icons.cube;
      if (g.includes('Sphere'))   return icons.sphere;
      if (g.includes('Cylinder')) return icons.cylinder;
      if (g.includes('Cone'))     return icons.cone;
      if (g.includes('Plane'))    return icons.plane;
      if (g.includes('Torus'))    return icons.torus;
      return icons.cube;
    }
    if (obj.isPoints)         return icons.gridFour;
    if (obj.isGroup)          return icons.cube;
    if (obj.isHelper)         return icons.cube;
    if (obj.kind === 'rect')  return icons.rectangle;    // 2D rect
    if (obj._el)              return icons.rectangle;    // web adapter
    if (typeof obj.radius === 'number') return icons.circle; // 2D circle
    return icons.cube;
  }

  // Expand/collapse state for group rows, persisted across re-renders.
  const expanded = new Set();

  function render() {
    listEl.innerHTML = '';
    // Build the parent→children hierarchy from each entry's stored parentObj
    // (set by autoRegisterScene for group descendants). Entries with no
    // registered parent render as top-level roots.
    const names = objectManager.getNames().filter((n) => {
      const o = objectManager.getObject(n);
      return !(o && o.userData && o.userData.__duiIgnore);
    });
    const nodeToName = new Map();
    names.forEach(n => { const o = objectManager.getObject(n); if (o) nodeToName.set(o, n); });
    const childrenMap = new Map();
    const roots = [];
    names.forEach(n => {
      const pObj = objectManager.objects[n]?.parentObj;
      const pName = pObj ? nodeToName.get(pObj) : null;
      if (pName && pName !== n && objectManager.objects[pName]) {
        if (!childrenMap.has(pName)) childrenMap.set(pName, []);
        childrenMap.get(pName).push(n);
      } else {
        roots.push(n);
      }
    });

    const buildItem = (name, depth, hasChildren) => {
      const item = document.createElement('div');
      const selectedSet = new Set(objectManager.getSelectedNames?.() || []);
      const isPrimary = objectManager.activeName === name;
      const isSelected = selectedSet.has(name);
      const cls = ['dui-list-item'];
      if (isPrimary) cls.push('dui-selected');
      else if (isSelected) cls.push('dui-co-selected');
      item.className = cls.join(' ');
      item.dataset.name = name;
      item.style.cursor = 'pointer';
      item.style.paddingLeft = (10 + depth * 16) + 'px';
      const obj = objectManager.getObject(name);
      // Camera detection: prefer the entry's `kind` (set by
      // registerCamera) so this works even when the registered object
      // is a transform PROXY rather than the real camera. The proxy
      // wouldn't pass an `obj.isCamera` duck-type, which used to make
      // Shift+A-added cameras silently miss their focus button.
      const isCamera = objectManager.kindOf?.(name) === 'camera' || !!obj?.isCamera;
      const cameraRef = isCamera ? (objectManager.getCameraRef?.(name) || obj) : null;
      const icon = iconFor(isCamera ? cameraRef : obj);
      const isLookingNow = isCamera && objectManager._activeCameraRef?.() === cameraRef;
      const focusBtn = isCamera
        ? `<button data-act="focus" class="dui-action-focus ${isLookingNow ? 'dui-active' : ''}"
                    data-tooltip="${isLookingNow ? 'Exit camera view' : 'Look through this camera'}">${FOCUS_ICON}</button>`
        : '';
      const caretCell = hasChildren
        ? `<span class="dui-tree-caret" data-act="caret">${expanded.has(name) ? '▾' : '▸'}</span>`
        : `<span class="dui-tree-caret dui-tree-spacer"></span>`;
      item.innerHTML = `
        ${caretCell}
        <span class="dui-list-icon">${icon}</span>
        <span class="dui-name" data-tooltip="Double-click to rename">${name}</span>
        <span class="dui-actions">
          ${focusBtn}
          <button data-act="vis" data-tooltip="${obj?.visible ? 'Hide' : 'Show'}">${obj?.visible ? icons.eye : icons.eyeSlash}</button>
          <button data-act="del" data-tooltip="Delete from scene" class="dui-danger">${icons.trash}</button>
        </span>`;

      const nameEl = item.querySelector('.dui-name');

      // Disclosure triangle → toggle this group's expanded state.
      item.querySelector('[data-act="caret"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expanded.has(name)) expanded.delete(name);
        else expanded.add(name);
        render();
      });

      // Clicking anywhere on the row (except action buttons + the name
      // when it's being edited) selects the object. Shift- or ⌘-click is
      // additive — toggles the row into / out of the multi-selection,
      // matching Finder / Figma / outliner conventions everywhere.
      item.addEventListener('click', (e) => {
        if (e.target.closest('.dui-actions')) return;
        if (e.target.closest('[data-act="caret"]')) return;
        if (nameEl.isContentEditable) return;
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        // No render() here. A full render() rebuilds the list innerHTML,
        // which replaces this row's DOM node between the two clicks of a
        // double-click — so the browser never fires `dblclick` and inline
        // rename can never start. Selection is purely visual, so the
        // 'change' → renderBatched path updates `.dui-selected` in place.
        objectManager.select(name, { additive });
      });

      // Right-click anywhere on the row → context menu. We PRESERVE the
      // multi-selection when right-clicking a row that's already part
      // of it — Finder / Figma do this so the menu's actions can apply
      // to the whole selection. Right-clicking a row OUTSIDE the
      // current multi-selection single-selects it first.
      item.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selectedBefore = objectManager.getSelectedNames?.() || [];
        if (!selectedBefore.includes(name)) {
          objectManager.select(name);
        }
        const { ContextMenu } = await import('./context-menu.js');
        const ui = objectManager._ui || (typeof window !== 'undefined' ? window.ui : null);
        if (!ui) return;
        if (!objectManager._rowMenu) objectManager._rowMenu = new ContextMenu();
        const obj = objectManager.getObject(name);
        const isVis = !!obj?.visible;
        const multi = (objectManager.getSelectedNames?.() || [name]);
        const items = [];
        // Group / Ungroup land at the top of the menu when relevant.
        if (multi.length >= 2) {
          items.push({
            label: `Group selection (${multi.length})`,
            icon: icons.clipboard,
            shortcut: '⌘G',
            onClick: () => ui._group?.(multi),
          });
          items.push({ separator: true });
        } else if (obj?.isGroup || obj?.type === 'Group') {
          items.push({
            label: 'Ungroup',
            icon: icons.clipboard,
            shortcut: '⇧⌘G',
            onClick: () => ui._ungroup?.(name),
          });
          items.push({ separator: true });
        }
        items.push(
          { label: 'Duplicate',  icon: icons.clipboard, shortcut: '⌘D',
            onClick: () => ui._duplicate?.(name) },
          { label: 'Copy',       icon: icons.clipboard, shortcut: '⌘C',
            onClick: () => ui._copy?.(name) },
          { label: 'Paste',      icon: icons.clipboard, shortcut: '⌘V',
            disabled: !ui._clipboard,
            onClick: () => ui._paste?.() },
          { separator: true },
          { label: 'Rename…',    icon: icons.pencil,
            onClick: () => nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) },
          { label: isVis ? 'Hide' : 'Show', icon: isVis ? icons.eyeSlash : icons.eye,
            onClick: () => item.querySelector('[data-act="vis"]')?.click() },
          { separator: true },
          { label: 'Delete',     icon: icons.trash, danger: true,
            onClick: () => item.querySelector('[data-act="del"]')?.click() },
        );
        objectManager._rowMenu.open(e.clientX, e.clientY, items);
      });

      // Double-click name → inline rename. Enter commits, Esc cancels.
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const original = nameEl.textContent;
        nameEl.contentEditable = 'true';
        nameEl.classList.add('dui-name-editing');
        nameEl.focus();
        // Select all text for fast retyping
        const range = document.createRange();
        range.selectNodeContents(nameEl);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);

        const finish = (commit) => {
          nameEl.contentEditable = 'false';
          nameEl.classList.remove('dui-name-editing');
          const next = nameEl.textContent.trim();
          if (!commit || !next || next === original) {
            nameEl.textContent = original;
            return;
          }
          const ok = objectManager.rename?.(name, next);
          if (!ok) {
            nameEl.textContent = original;
            return;
          }
          // Push undo so Cmd+Z restores the previous name. Rename was
          // previously silent on the undo stack — typos in the outliner
          // had no way back without manually re-renaming.
          const ui = objectManager._ui;
          ui?._undo?.push?.({
            label: `rename ${original} → ${next}`,
            undo: () => { objectManager.rename?.(next, original); render(); },
            redo: () => { objectManager.rename?.(original, next); render(); },
          });
          render();
        };
        nameEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
          if (ev.key === 'Escape') { ev.preventDefault(); nameEl.textContent = original; nameEl.blur(); }
        }, { once: false });
        nameEl.addEventListener('blur', () => finish(true), { once: true });
      });

      item.querySelector('[data-act="focus"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isCamera) return;
        const ui = objectManager._ui || (typeof window !== 'undefined' ? window.ui : null);
        const before = ui?._activeCamera || null;
        // Hand the REAL camera to the toggle, not a transform proxy —
        // the snap-camera code in contextual.js reads `cam.fov`, `cam.near`,
        // etc, which only exist on the actual camera object.
        objectManager._toggleActiveCamera?.(cameraRef || obj);
        // _toggleActiveCamera triggers a refresh from the host already,
        // but call render() too in case the host hook isn't wired in
        // this configuration.
        render();
        // Push undo — POV switches change the visible viewport, so
        // Cmd+Z should put the user back where they were looking. We
        // use ui.setActiveCamera here (NOT _toggleActiveCamera) because
        // the toggle helper short-circuits on null, and exiting POV
        // means setting it back to null.
        const after = ui?._activeCamera || null;
        if (before === after) return;   // no-op click
        const afterLabel  = after  ? `“${name}”` : 'main';
        ui?._undo?.push?.({
          label: `look through ${afterLabel}`,
          undo: () => { ui.setActiveCamera?.(before); render(); },
          redo: () => { ui.setActiveCamera?.(after);  render(); },
        });
      });

      item.querySelector('[data-act="vis"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!obj) return;
        // Push an undo entry — visibility toggle was previously missing
        // from the undo stack, which made Cmd+Z feel unreliable after a
        // user hid/showed a few objects.
        const before = !!obj.visible;
        obj.visible = !obj.visible;
        const after = !!obj.visible;
        // The manager exposes itself on the global `ui` via `ui._undo` —
        // we don't have a direct handle here so we resolve it lazily.
        const ui = objectManager._ui || (typeof window !== 'undefined' ? window.ui : null);
        ui?._undo?.push?.({
          label: `${after ? 'show' : 'hide'} ${name}`,
          undo: () => { obj.visible = before; render(); },
          redo: () => { obj.visible = after;  render(); },
        });
        render();
      });

      item.querySelector('[data-act="del"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog(`This will remove "${name}" from the scene.`, {
          title: `Delete ${name}?`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        objectManager.remove(name);
        render();
      });

      return item;
    };

    const renderNode = (name, depth) => {
      const kids = childrenMap.get(name);
      const hasChildren = !!(kids && kids.length);
      listEl.appendChild(buildItem(name, depth, hasChildren));
      if (hasChildren && expanded.has(name)) {
        kids.forEach(c => renderNode(c, depth + 1));
      }
    };
    roots.forEach(r => renderNode(r, 0));
    lastSig = listSignature();
  }

  // A fingerprint of everything the outliner rows actually DRAW
  // (name, visibility, expand state, camera-looking state) — but NOT
  // which row is selected. If two renders would produce identical row
  // markup, we can skip the innerHTML rebuild and just retoggle the
  // `.dui-selected` class in place. That keeps a row's DOM node stable
  // across a click, so a following click can complete a `dblclick`
  // (which starts inline rename).
  function listSignature() {
    const names = objectManager.getNames().filter((n) => {
      const o = objectManager.getObject(n);
      return !(o && o.userData && o.userData.__duiIgnore);
    });
    return names.map((n) => {
      const o = objectManager.getObject(n);
      const isCam = objectManager.kindOf?.(n) === 'camera' || !!o?.isCamera;
      const camRef = isCam ? (objectManager.getCameraRef?.(n) || o) : null;
      const looking = isCam && objectManager._activeCameraRef?.() === camRef ? 1 : 0;
      return `${n}|${o?.visible ? 1 : 0}|${expanded.has(n) ? 1 : 0}|${looking}`;
    }).join('§');
  }

  function updateSelectionClasses() {
    const selectedSet = new Set(objectManager.getSelectedNames?.() || []);
    listEl.querySelectorAll('.dui-list-item').forEach((it) => {
      const isPrimary = it.dataset.name === objectManager.activeName;
      const isSelected = selectedSet.has(it.dataset.name);
      it.classList.toggle('dui-selected', isPrimary);
      it.classList.toggle('dui-co-selected', !isPrimary && isSelected);
    });
  }

  let lastSig = '';
  render();
  // Re-render when the manager changes (register/remove/select/rename).
  // Batch via MICROTASK so a burst of N change events triggers ONE
  // render at the end of the current sync task, not N. Without this,
  // registering 100 objects rebuilds the outliner 100 times = O(N²).
  //
  // Earlier we used requestAnimationFrame here, but rAF is throttled
  // (and sometimes paused entirely) for backgrounded tabs — meaning
  // any host that initialises Ghost Panel in a tab that isn't focused
  // (e.g. our preview harness, a hidden iframe, a multi-window UX)
  // would never see deferred registers reach the outliner.
  // queueMicrotask fires unconditionally at the end of the current
  // JavaScript task and still coalesces synchronous bursts.
  let renderQueued = false;
  function renderBatched() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      // Selection-only changes (the common case from clicking a row)
      // keep identical row markup — update the highlight in place rather
      // than rebuilding the list, so the clicked row's DOM node survives
      // and a double-click can fire to start inline rename.
      if (listSignature() === lastSig) {
        updateSelectionClasses();
      } else {
        render();
      }
    });
  }
  objectManager.on('change', renderBatched);
  return { folder, refresh: render };
}

/**
 * Add a built-in "Camera" folder with position / target / FOV controls.
 * Live-syncs with OrbitControls (when the user orbits, sliders update).
 */
export function addCameraFolder(panel, camera, controls) {
  const folder = panel.addFolder('Camera');

  const pos = folder.addVec3('Position', {
    min: -50, max: 50, step: 0.001,
    value: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    onChange: (v) => { camera.position.set(v.x, v.y, v.z); controls?.update(); },
  }).controls['Position'];

  const tgt = folder.addVec3('Target', {
    min: -50, max: 50, step: 0.001,
    value: controls ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : { x: 0, y: 0, z: 0 },
    onChange: (v) => { if (controls) { controls.target.set(v.x, v.y, v.z); controls.update(); } },
  }).controls['Target'];

  folder.addSlider('FOV', {
    min: 10, max: 120, step: 0.1, value: camera.fov,
    onChange: v => { camera.fov = v; camera.updateProjectionMatrix(); },
  });

  function update() {
    pos.setValue({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
    if (controls) tgt.setValue({ x: controls.target.x, y: controls.target.y, z: controls.target.z });
  }
  return { folder, update };
}

/**
 * Walk a Three.js scene and register everything we recognize with the
 * given objectManager. Skips nodes that are already registered (so it's
 * safe to call after the user manually registered a subset). Names default
 * to `node.name` and fall back to `Type.<N>` when missing.
 *
 * Result: the Outliner auto-populates the moment the host hands us a
 * scene, without the demo having to call `register()` for every mesh.
 */
export function autoRegisterScene(objectManager, scene) {
  if (!objectManager || !scene?.traverse) return [];
  const registered = [];
  const counts = {};
  const seen = new Set(objectManager.getNames?.() || []);
  // Index every node already known to the manager (as object OR helper) so
  // we never re-register a light's helper as a standalone mesh. Three.js
  // light helpers (PointLightHelper, DirectionalLightHelper, etc.) extend
  // LineSegments/Mesh, so a naïve traversal would otherwise surface them.
  const knownNodes = new Set();
  // Registered nodes whose children should be surfaced as nested tree rows.
  const expandableNodes = new Set();
  const isExpandable = (n) =>
    !!n && (n.isGroup || (n.isObject3D && !n.isMesh && !n.isLight && !n.isCamera && (n.children?.length > 0)));
  Object.values(objectManager.objects || {}).forEach(e => {
    if (e?.object) { knownNodes.add(e.object); if (isExpandable(e.object)) expandableNodes.add(e.object); }
    if (e?.helper) knownNodes.add(e.helper);
  });
  // Three.js helper classes — their *type* string ends with "Helper". We
  // also accept the explicit `userData.__duiIgnore` opt-out for hosts that
  // want to keep a node out of the outliner.
  function isHelperNode(n) {
    if (n?.userData?.__duiIgnore) return true;
    if (n?.isTransformControls) return true;
    const t = n?.type || n?.constructor?.name || '';
    return /Helper$/.test(t);
  }
  scene.traverse((node) => {
    if (!node) return;
    if (knownNodes.has(node)) return;
    if (isHelperNode(node)) return;
    // Skip nodes whose ancestor is a helper / gizmo / opted-out group, OR
    // a group that was already registered (avoids sub-mesh spam from GLTF models).
    // Walk to the nearest registered ancestor. Descendants of a registered
    // GROUP are surfaced as nested children; descendants of any other
    // registered node (mesh, light) are still skipped to avoid sub-part spam.
    let p = node.parent;
    let parentNode = null;
    while (p) {
      if (isHelperNode(p)) return;
      if (knownNodes.has(p)) {
        if (expandableNodes.has(p)) parentNode = p;
        else return;
        break;
      }
      p = p.parent;
    }
    // Decide kind + register via the right method so helpers / cameras /
    // lights get their visualizers. Named Groups that are direct children of
    // the scene (e.g. GLTF model roots) are registered as 'group' so the
    // outliner shows them as a single collapsible item instead of every
    // individual sub-mesh.
    let kind = null;
    if (node.isLight)  kind = 'light';
    else if (node.isCamera) kind = 'camera';
    else if (node.isMesh)   kind = 'mesh';
    else if (isExpandable(node) && node.name?.trim() && (node.parent === scene || parentNode)) kind = 'group';
    if (!kind) return;
    let name = node.name?.trim();
    // Skip auto-registering UNNAMED meshes: they'd get junk names (Object,
    // Object3D.02 …) that flood the outliner and pollute exports. Named meshes
    // (and lights/cameras, which are few and always useful) still register. A
    // host that wants an unnamed mesh in the outliner can give it a `.name`.
    if (!name && kind === 'mesh') return;
    if (!name || seen.has(name)) {
      const base = (node.type || node.constructor?.name || 'Object').replace(/Light$|Mesh$|Camera$/, '') || 'Object';
      counts[base] = (counts[base] || 0) + 1;
      name = counts[base] === 1 ? base : `${base}.${String(counts[base]).padStart(2, '0')}`;
      while (seen.has(name)) {
        counts[base] += 1;
        name = `${base}.${String(counts[base]).padStart(2, '0')}`;
      }
    }
    seen.add(name);
    if (kind === 'light' && objectManager.registerLight)        objectManager.registerLight(name, node);
    else if (kind === 'camera' && objectManager.registerCamera) objectManager.registerCamera(name, node);
    else objectManager.register(name, node);
    const entry = objectManager.objects[name];
    if (entry) entry.parentObj = parentNode || null;
    if (isExpandable(node)) expandableNodes.add(node);
    registered.push({ name, kind, object: node });
    // Mark the newly-registered node so the ancestor check above skips its
    // descendants on this traversal (prevents sub-meshes of a registered
    // Group from being individually surfaced in the outliner).
    knownNodes.add(node);
  });
  return registered;
}
