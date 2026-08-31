/**
 * Built-in free camera for Three.js hosts.
 *
 * Two things stop an inspector from moving the camera on a real page, and a
 * host has to solve both before the panel is usable:
 *
 *   1. The host's render loop owns the camera. Scrollytelling pages, camera-path
 *      players and cutscene systems re-derive position/quaternion/fov from
 *      progress on every rAF tick, so anything the inspector moves is
 *      overwritten within ~16ms. There was no signal meaning "the inspector
 *      wants the camera now", so hosts had no cue to pause that.
 *
 *   2. Pointer events never reach the WebGL canvas. The canvas is usually the
 *      BOTTOM layer — scroll runways, HUDs and overlay canvases sit above it —
 *      so controls bound to `renderer.domElement` never hear a single drag.
 *
 * So: we bind to `document.body`, not the canvas. Events landing on any host
 * layer bubble up to body, which makes the takeover independent of stacking
 * order. Ghost Panel's own surfaces already stop propagation on their elements
 * (see panel.js), so dragging inside a panel never orbits the scene.
 *
 * The host side of the contract is one callback: while `onCameraTakeover(true)`
 * is in effect, the host must not write the camera.
 */
import * as THREE from 'three';
import { log } from './log.js';

/** How far ahead of the camera to put the orbit pivot when none can be derived. */
const DEFAULT_PIVOT_DISTANCE = 5;

/**
 * Pick an orbit target that doesn't snap the view: aim at whatever the camera
 * is already looking at. Preference order is the middle of the scene's bounds
 * when the camera is actually pointed near it, otherwise a point straight
 * ahead at a distance scaled to the scene.
 */
function seedTarget(camera, scene) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  let distance = DEFAULT_PIVOT_DISTANCE;
  try {
    const box = new THREE.Box3().setFromObject(scene);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const toCenter = center.clone().sub(camera.position);
      const along = toCenter.dot(forward);
      // Only pivot on the scene center when it is genuinely in front of the
      // camera and roughly on-axis; otherwise orbiting would swing the view.
      if (along > 0 && toCenter.angleTo(forward) < Math.PI / 6) return center;
      const size = box.getSize(new THREE.Vector3()).length();
      if (Number.isFinite(size) && size > 0) distance = Math.min(Math.max(size * 0.15, 1), 50);
    }
  } catch (e) {
    log.debug('camera-control', 'scene bounds failed, using fixed pivot distance:', e);
  }
  return camera.position.clone().addScaledVector(forward, distance);
}

/**
 * @param {object} ui        the Ghost Panel handle (used for logging context only)
 * @param {object} opts
 * @param {THREE.Camera}   opts.camera
 * @param {THREE.Scene}    opts.scene
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {object} [opts.controls]  the host's own controls, disabled during takeover
 * @param {(active:boolean)=>void} [opts.onCameraTakeover]
 * @param {boolean} [opts.detect=true] warn when the host keeps writing the camera
 */
export function attachCameraControl(ui, opts = {}) {
  const { camera, scene, renderer, controls: hostControls, onCameraTakeover, detect = true } = opts;
  if (!camera || !scene) return null;

  let controls = null;       // our OrbitControls, created on first enable()
  let active = false;
  let loading = null;        // in-flight import, so double enable() doesn't race
  let disposed = false;
  let warnedOverwrite = false;
  const lastKnown = new THREE.Vector3();
  let hasLastKnown = false;

  function notify(on) {
    try { onCameraTakeover?.(on); }
    catch (e) { log.error('camera-control', 'onCameraTakeover threw:', e); }
  }

  async function build() {
    if (controls || loading) return loading;
    loading = (async () => {
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      if (disposed) return null;
      // document.body, NOT renderer.domElement — see the module docblock.
      const c = new OrbitControls(camera, document.body);
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      c.enabled = false;
      c.target.copy(seedTarget(camera, scene));
      c.update();
      controls = c;
      return c;
    })().catch((e) => {
      log.error('camera-control',
        'Could not load OrbitControls from "three/addons/controls/OrbitControls.js". ' +
        'Pass your own controls, or set cameraControl: false.', e);
      return null;
    }).finally(() => { loading = null; });
    return loading;
  }

  async function enable() {
    if (disposed || active) return controls;
    await build();
    if (!controls || disposed) return null;
    // Re-seed on every takeover: the host may have moved the camera a long way
    // since the last time we had it.
    controls.target.copy(seedTarget(camera, scene));
    controls.enabled = true;
    controls.update();
    active = true;
    hasLastKnown = false;
    warnedOverwrite = false;
    // The host's own controls would fight ours over the same camera.
    if (hostControls && hostControls !== controls) {
      hostControls.__duiWasEnabled = hostControls.enabled;
      hostControls.enabled = false;
    }
    notify(true);
    return controls;
  }

  function disable() {
    if (!active) return;
    active = false;
    if (controls) controls.enabled = false;
    if (hostControls && hostControls !== controls && hostControls.__duiWasEnabled !== undefined) {
      hostControls.enabled = hostControls.__duiWasEnabled;
      delete hostControls.__duiWasEnabled;
    }
    notify(false);
  }

  function toggle() { return active ? (disable(), false) : (enable(), true); }

  /**
   * Called from ui.update(). Advances damping, and — the diagnostic half —
   * notices when the camera keeps moving between our frames even though our
   * controls are the only thing that should be writing it. That is the exact
   * signature of a host render loop overwriting the camera, which otherwise
   * just reads as "Ghost Panel is broken".
   */
  function update() {
    if (!active || !controls) return;
    if (detect && hasLastKnown && !warnedOverwrite) {
      // Compare against where WE left the camera at the end of the last frame.
      // Any drift is somebody else's write.
      if (camera.position.distanceToSquared(lastKnown) > 1e-8) {
        warnedOverwrite = true;
        log.warn('camera-control',
          'The host is writing the camera every frame, so the free camera cannot move it. ' +
          'Pause your camera choreography while Ghost Panel has the camera — pass ' +
          'onCameraTakeover(active) to createGhostPanel() and stop writing the camera while active is true.');
      }
    }
    controls.update();
    lastKnown.copy(camera.position);
    hasLastKnown = true;
  }

  function dispose() {
    disposed = true;
    if (active) disable();
    controls?.dispose?.();
    controls = null;
  }

  return {
    enable, disable, toggle, update, dispose,
    get isActive() { return active; },
    get controls() { return controls; },
  };
}
