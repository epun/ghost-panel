/**
 * Modal transform — Blender-style keyboard-driven transform.
 *
 * Keyboard:
 *   G            → move (all axes, follows mouse on view plane)
 *   G then X/Y/Z → move locked to that world axis
 *   R            → rotate (around camera forward; follows mouse angle)
 *   R then X/Y/Z → rotate around that world axis
 *   S            → scale uniformly (mouse distance from object center)
 *   S then X/Y/Z → scale only that axis
 *   Enter / LMB  → commit
 *   Esc   / RMB  → cancel (restore original transform)
 *   X/Y/Z again  → unlock axis (toggle)
 *
 * While modal:
 *   - OrbitControls is disabled
 *   - The normal TransformControls gizmo is hidden
 *   - A small on-screen hint shows the active mode + axis
 *   - The mouse cursor drives the transform amount continuously
 */
import * as THREE from 'three';

const AXIS_COLORS = { x: '#ff4040', y: '#40c040', z: '#4080ff' };

export class ModalTransform {
  constructor({ scene, camera, renderer, controls, objectManager, undoStack = null }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.objectManager = objectManager;
    this.undoStack = undoStack;

    this.active = false;
    this.mode = null;       // 'translate' | 'rotate' | 'scale'
    this.axis = null;       // 'x' | 'y' | 'z' | null
    this.target = null;
    this.start = null;      // captured transform + mouse state

    // On-screen hint element
    this.hint = document.createElement('div');
    this.hint.className = 'dui-modal-hint';
    document.body.appendChild(this.hint);

    this._bindEvents();
  }

  _bindEvents() {
    this._onKeyDown = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

      if (!this.active) {
        // Not in modal — pressing G/R/S starts a session on the selected object
        const key = e.key.toLowerCase();
        if (key === 'g' || key === 'r' || key === 's') {
          const name = this.objectManager?.activeName;
          const target = name ? this.objectManager.getObject(name) : null;
          if (!target) return;
          e.preventDefault();
          this.begin(
            key === 'g' ? 'translate' : key === 'r' ? 'rotate' : 'scale',
            target,
          );
        }
        return;
      }

      // ── Inside a modal session ──
      const key = e.key.toLowerCase();
      e.preventDefault();
      if (key === 'escape') { this.cancel(); return; }
      if (key === 'enter') { this.commit(); return; }
      if (key === 'x' || key === 'y' || key === 'z') {
        // Toggle axis: pressing same again removes the lock
        this.axis = this.axis === key ? null : key;
        this._renderHint();
        this._applyFromMouse(this._lastMouse);
        return;
      }
    };

    this._onMouseMove = (e) => {
      // Track the cursor at all times — otherwise the first G/R/S press
      // captures a stale (or default-to-object-center) start mouse, causing
      // the target to jump on the first real mouse move.
      this._lastMouse = { x: e.clientX, y: e.clientY };
      if (!this.active) return;
      this._applyFromMouse(this._lastMouse);
      this._renderHint();
    };

    this._onMouseDown = (e) => {
      if (!this.active) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) this.commit();
      else if (e.button === 2) this.cancel();
    };

    this._onContextMenu = (e) => {
      if (this.active) e.preventDefault();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('mousemove', this._onMouseMove);
    // Capture on the canvas (so we beat the orbit controls / gizmo)
    this.renderer.domElement.addEventListener('mousedown', this._onMouseDown, true);
    this.renderer.domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  /** Project a world-space point to screen-space pixel coords. */
  _worldToScreen(point) {
    const v = point.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * r.width + r.left,
      y: (-v.y * 0.5 + 0.5) * r.height + r.top,
    };
  }

  /** Begin a modal transform session. */
  begin(mode, target) {
    this.active = true;
    this.mode = mode;
    this.axis = null;
    this.target = target;

    // Snapshot starting transform + mouse position + object screen position
    this.start = {
      position: target.position.clone(),
      rotation: target.rotation.clone(),
      quaternion: target.quaternion.clone(),
      scale: target.scale.clone(),
      worldPos: new THREE.Vector3(),
    };
    target.getWorldPosition(this.start.worldPos);
    this.start.screenPos = this._worldToScreen(this.start.worldPos);
    // Read mouse position — we capture last-known. If the user hasn't moved
    // the mouse yet, default to object screen center to give a stable origin.
    this.start.mouse = this._lastMouse || { ...this.start.screenPos };
    this._lastMouse = { ...this.start.mouse };

    // Disable orbit + hide regular gizmo
    if (this.controls) this.controls.enabled = false;
    if (this.objectManager?.gizmo) {
      this.objectManager.gizmo.getHelper().visible = false;
      this.objectManager.gizmo.enabled = false;
    }

    // Pause mixer if animated (same as gizmo drag)
    this._mixerWasPlaying = null;
    let n = target;
    while (n) {
      if (n.userData?.mixer) {
        this._mixer = n.userData.mixer;
        this._mixerWasPlaying = this._mixer.timeScale !== 0;
        this._mixer.timeScale = 0;
        break;
      }
      n = n.parent;
    }

    this.renderer.domElement.style.cursor = 'crosshair';
    this._renderHint();
  }

  /** Compute & apply the transform based on current mouse position. */
  _applyFromMouse(mouse) {
    if (!this.active || !mouse) return;
    const dx = mouse.x - this.start.mouse.x;
    const dy = mouse.y - this.start.mouse.y;

    if (this.mode === 'translate') this._applyTranslate(dx, dy, mouse);
    else if (this.mode === 'scale') this._applyScale(dx, dy, mouse);
    else if (this.mode === 'rotate') this._applyRotate(mouse);
  }

  _applyTranslate(dx, dy, mouse) {
    const t = this.target;
    // Calculate world-space movement on the view-plane through the object
    const start3 = this.start.worldPos;
    // Convert current mouse screen to a world point on a plane through start3 facing the camera
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((mouse.x - r.left) / r.width) * 2 - 1,
      -(((mouse.y - r.top) / r.height) * 2 - 1),
    );
    const ndcStart = new THREE.Vector2(
      ((this.start.mouse.x - r.left) / r.width) * 2 - 1,
      -(((this.start.mouse.y - r.top) / r.height) * 2 - 1),
    );
    const ray = new THREE.Raycaster();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, start3);

    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    ray.ray.intersectPlane(plane, hit);
    ray.setFromCamera(ndcStart, this.camera);
    const hitStart = new THREE.Vector3();
    ray.ray.intersectPlane(plane, hitStart);
    if (!hit || !hitStart) return;

    let delta = new THREE.Vector3().subVectors(hit, hitStart);

    if (this.axis) {
      const ax = new THREE.Vector3(
        this.axis === 'x' ? 1 : 0,
        this.axis === 'y' ? 1 : 0,
        this.axis === 'z' ? 1 : 0,
      );
      // Project delta onto the axis
      const along = ax.clone().multiplyScalar(delta.dot(ax));
      delta = along;
    }
    t.position.copy(this.start.position).add(delta);
  }

  _applyScale(dx, dy) {
    const t = this.target;
    // Use distance from object screen-center as the scale "lever".
    const sp = this.start.screenPos;
    const distStart = Math.hypot(this.start.mouse.x - sp.x, this.start.mouse.y - sp.y) || 1;
    const distNow   = Math.hypot(this._lastMouse.x - sp.x, this._lastMouse.y - sp.y);
    const factor = Math.max(0.01, distNow / distStart);

    const s = this.start.scale.clone();
    if (this.axis === 'x') t.scale.set(s.x * factor, s.y, s.z);
    else if (this.axis === 'y') t.scale.set(s.x, s.y * factor, s.z);
    else if (this.axis === 'z') t.scale.set(s.x, s.y, s.z * factor);
    else t.scale.set(s.x * factor, s.y * factor, s.z * factor);
  }

  _applyRotate() {
    const t = this.target;
    const sp = this.start.screenPos;
    const a0 = Math.atan2(this.start.mouse.y - sp.y, this.start.mouse.x - sp.x);
    const a1 = Math.atan2(this._lastMouse.y - sp.y, this._lastMouse.x - sp.x);
    let delta = a1 - a0;
    // Normalize to nearest rotation direction
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    const q = new THREE.Quaternion();
    if (this.axis === 'x') q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), delta);
    else if (this.axis === 'y') q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), delta);
    else if (this.axis === 'z') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), delta);
    else {
      // Free rotate: spin around the camera's forward axis
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      q.setFromAxisAngle(camDir.negate(), delta);
    }
    t.quaternion.copy(this.start.quaternion).premultiply(q);
  }

  commit() {
    if (!this.active) return;
    // Push an undo entry capturing the start vs. current Three.js transform.
    // We clone each component so later mutations don't poison either snapshot.
    const t = this.target, start = this.start;
    const before = {
      position: start.position.clone(),
      quaternion: start.quaternion.clone(),
      scale: start.scale.clone(),
    };
    const after = {
      position: t.position.clone(),
      quaternion: t.quaternion.clone(),
      scale: t.scale.clone(),
    };
    const apply = (s) => {
      t.position.copy(s.position);
      t.quaternion.copy(s.quaternion);
      t.scale.copy(s.scale);
    };
    this.undoStack?.push({
      label: `3d ${this.mode}`,
      undo: () => apply(before),
      redo: () => apply(after),
    });
    this._end(true);
  }
  cancel() {
    if (!this.active) return;
    // Restore original transform
    this.target.position.copy(this.start.position);
    this.target.rotation.copy(this.start.rotation);
    this.target.quaternion.copy(this.start.quaternion);
    this.target.scale.copy(this.start.scale);
    this._end(false);
  }

  _end(_committed) {
    // Restore orbit + gizmo + cursor + mixer
    if (this.controls) this.controls.enabled = true;
    if (this.objectManager?.gizmo) {
      this.objectManager.gizmo.enabled = true;
      if (this.objectManager.activeName) this.objectManager.gizmo.getHelper().visible = true;
    }
    if (this._mixer && this._mixerWasPlaying) this._mixer.timeScale = 1;
    this._mixer = null;
    this.renderer.domElement.style.cursor = '';
    this.active = false;
    this.mode = null;
    this.axis = null;
    this.target = null;
    this.start = null;
    this._renderHint();
  }

  _renderHint() {
    if (!this.active) {
      this.hint.style.display = 'none';
      return;
    }
    const modeName = {
      translate: 'Move', rotate: 'Rotate', scale: 'Scale',
    }[this.mode];
    const axisLabel = this.axis
      ? `<span class="dui-modal-axis" style="color:${AXIS_COLORS[this.axis]}">${this.axis.toUpperCase()}</span>`
      : `<span class="dui-modal-axis dui-modal-axis-free">all</span>`;
    this.hint.innerHTML = `
      <span class="dui-modal-mode">${modeName}</span>
      <span class="dui-modal-sep">·</span>
      ${axisLabel}
      <span class="dui-modal-sep">·</span>
      <span class="dui-modal-tip">X/Y/Z to lock · LMB commit · Esc cancel</span>
    `;
    this.hint.style.display = 'flex';
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.renderer.domElement.removeEventListener('mousedown', this._onMouseDown, true);
    this.renderer.domElement.removeEventListener('contextmenu', this._onContextMenu);
    this.hint.remove();
  }
}

/**
 * 2D counterpart of ModalTransform — same Blender-style G/R/S keyboard,
 * but operates on plain `{ x, y, rotation?, radius?, width?, height? }`
 * objects from a Canvas2D scene instead of Three.js Object3Ds.
 *
 * Hotkeys mirror the 3D version:
 *   G        translate (mouse delta → object.x/y)
 *   G + X/Y  lock to that axis
 *   R        rotate (angle from object center → object.rotation)
 *   S        scale uniformly (mouse distance from object center)
 *   S + X/Y  scale only width or height
 *   LMB/Enter commit · RMB/Esc cancel
 */
export class Modal2DTransform {
  constructor({ canvas, objectManager, undoStack = null }) {
    this.canvas = canvas;
    this.objectManager = objectManager;
    this.undoStack = undoStack;

    this.active = false;
    this.mode = null;          // 'translate' | 'rotate' | 'scale'
    this.axis = null;          // 'x' | 'y' | null
    this.target = null;
    this.start = null;
    this._lastMouse = null;

    this.hint = document.createElement('div');
    this.hint.className = 'dui-modal-hint';
    document.body.appendChild(this.hint);

    this._bindEvents();
  }

  _bindEvents() {
    this._onKeyDown = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

      if (!this.active) {
        const key = e.key.toLowerCase();
        if (key === 'g' || key === 'r' || key === 's') {
          const name = this.objectManager?.activeName;
          const target = name ? this.objectManager.getObject(name) : null;
          // Only engage on 2D-shaped targets — leaves 3D scenes untouched.
          if (!target || !('x' in target) || !('y' in target) || target.position) return;
          e.preventDefault();
          this.begin(
            key === 'g' ? 'translate' : key === 'r' ? 'rotate' : 'scale',
            target,
          );
        }
        return;
      }

      const key = e.key.toLowerCase();
      e.preventDefault();
      if (key === 'escape') { this.cancel(); return; }
      if (key === 'enter')  { this.commit(); return; }
      if (key === 'x' || key === 'y') {
        this.axis = this.axis === key ? null : key;
        this._renderHint();
        this._applyFromMouse(this._lastMouse);
      }
    };

    this._onMouseMove = (e) => {
      this._lastMouse = { x: e.clientX, y: e.clientY };
      if (this.active) {
        this._applyFromMouse(this._lastMouse);
        this._renderHint();
      }
    };

    this._onMouseDown = (e) => {
      if (!this.active) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) this.commit();
      else if (e.button === 2) this.cancel();
    };

    this._onContextMenu = (e) => { if (this.active) e.preventDefault(); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('mousemove', this._onMouseMove);
    // Capture phase so we beat any pointer handlers on the canvas itself.
    this.canvas.addEventListener('mousedown', this._onMouseDown, true);
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
  }

  begin(mode, target) {
    this.active = true;
    this.mode = mode;
    this.axis = null;
    this.target = target;

    this.start = {
      x:        target.x,
      y:        target.y,
      rotation: target.rotation || 0,
      radius:   target.radius,
      width:    target.width,
      height:   target.height,
      mouse:    this._lastMouse ? { ...this._lastMouse } : { x: target.x, y: target.y },
    };
    if (!this._lastMouse) this._lastMouse = { ...this.start.mouse };

    this.canvas.style.cursor = 'crosshair';
    this._renderHint();
  }

  _applyFromMouse(mouse) {
    if (!this.active || !mouse) return;
    const t = this.target;
    const start = this.start;
    const sx = start.mouse.x, sy = start.mouse.y;
    const dx = mouse.x - sx;
    const dy = mouse.y - sy;

    if (this.mode === 'translate') {
      t.x = this.axis === 'y' ? start.x : start.x + dx;
      t.y = this.axis === 'x' ? start.y : start.y + dy;
    } else if (this.mode === 'rotate') {
      // Angle around the object's start position, screen-space.
      const a0 = Math.atan2(sy - start.y, sx - start.x);
      const a1 = Math.atan2(mouse.y - start.y, mouse.x - start.x);
      t.rotation = start.rotation + (a1 - a0);
    } else if (this.mode === 'scale') {
      const d0 = Math.hypot(sx - start.x, sy - start.y) || 1;
      const d1 = Math.hypot(mouse.x - start.x, mouse.y - start.y);
      const factor = Math.max(0.01, d1 / d0);
      if (typeof start.radius === 'number') {
        t.radius = start.radius * factor;
      }
      if (typeof start.width === 'number' && typeof start.height === 'number') {
        if (this.axis === 'x')      { t.width = start.width * factor; t.height = start.height; }
        else if (this.axis === 'y') { t.width = start.width;          t.height = start.height * factor; }
        else                         { t.width = start.width * factor; t.height = start.height * factor; }
      }
    }
  }

  commit() {
    if (!this.active) return;
    // Snapshot the post-transform values so undo can restore the pre-state
    // captured in `this.start`. Only fields the mode could have changed are
    // included in the inverse — keeps coalescing-by-prop accurate.
    const t = this.target, start = this.start;
    const after = { x: t.x, y: t.y };
    if ('rotation' in t)                  after.rotation = t.rotation;
    if (typeof start.radius === 'number') after.radius   = t.radius;
    if (typeof start.width === 'number')  after.width    = t.width;
    if (typeof start.height === 'number') after.height   = t.height;
    const before = {
      x: start.x, y: start.y,
      ...(start.rotation !== undefined ? { rotation: start.rotation } : {}),
      ...(typeof start.radius === 'number' ? { radius: start.radius } : {}),
      ...(typeof start.width  === 'number' ? { width:  start.width  } : {}),
      ...(typeof start.height === 'number' ? { height: start.height } : {}),
    };
    const apply = (snap) => { for (const k in snap) t[k] = snap[k]; };
    this.undoStack?.push({
      label: `2d ${this.mode}`,
      undo: () => apply(before),
      redo: () => apply(after),
    });
    this._end();
  }
  cancel() {
    if (!this.active) return;
    const t = this.target;
    t.x = this.start.x;
    t.y = this.start.y;
    if ('rotation' in t) t.rotation = this.start.rotation;
    if (typeof this.start.radius === 'number') t.radius = this.start.radius;
    if (typeof this.start.width === 'number')  t.width  = this.start.width;
    if (typeof this.start.height === 'number') t.height = this.start.height;
    this._end();
  }

  _end() {
    this.canvas.style.cursor = '';
    this.active = false;
    this.mode = null;
    this.axis = null;
    this.target = null;
    this.start = null;
    this._renderHint();
  }

  _renderHint() {
    if (!this.active) { this.hint.style.display = 'none'; return; }
    const modeName = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[this.mode];
    const axisLabel = this.axis
      ? `<span class="dui-modal-axis" style="color:${AXIS_COLORS[this.axis]}">${this.axis.toUpperCase()}</span>`
      : `<span class="dui-modal-axis dui-modal-axis-free">all</span>`;
    this.hint.innerHTML = `
      <span class="dui-modal-mode">${modeName}</span>
      <span class="dui-modal-sep">·</span>
      ${axisLabel}
      <span class="dui-modal-sep">·</span>
      <span class="dui-modal-tip">X/Y to lock · LMB commit · Esc cancel</span>
    `;
    this.hint.style.display = 'flex';
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown, true);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    this.hint.remove();
  }
}
