/**
 * 3D gizmos — specialized scene manipulators inspired by Blender, ZBrush,
 * and Apple's RealityKit. Each gizmo is a self-contained Three.js Object3D
 * that you can attach to any target Object3D and interact with via the
 * built-in pointer handler.
 *
 *   Available gizmo types:
 *     - 'placement'  Horizontal ring + rotation arrow (drop on ground plane)
 *     - 'mirror'     5-point star, click a vertex to mirror across that axis
 *     - 'vr'         Cube with face-aligned rings (place VR view)
 *     - 'transpose'  ZBrush-style line + handles (translate / rotate / scale chain)
 *     - 'cursor'     3D cursor — RGB axes with dashed circle (reference point)
 *     - 'shear'      X-shape, drag colored bars to shear along axes
 *     - 'camera'     Frustum + rotation rings (camera placement)
 *
 *   Usage:
 *     const gizmos = createGizmoSystem(scene, camera, renderer, orbitControls);
 *     gizmos.attach('placement', someMesh);
 *     gizmos.detach();
 *     gizmos.list();   // → ['placement', 'mirror', ...]
 *
 *   On any drag, the target object's transform is updated live. A 'change'
 *   event fires for every frame the gizmo is being dragged so consumers can
 *   sync external state (sliders, JSON saves, etc.).
 */
import * as THREE from 'three';

// ── Color palette ──
// Standard RGB-axis convention: X=red, Y=green, Z=blue. Blender uses the same.
const COLOR_X = new THREE.Color(0xee4040);   // red
const COLOR_Y = new THREE.Color(0x40c040);   // green
const COLOR_Z = new THREE.Color(0x4080ff);   // blue
const COLOR_W = new THREE.Color(0xffffff);   // white / neutral
const COLOR_YELLOW = new THREE.Color(0xffff00);

/** Build line material with given color, used everywhere. */
function lineMat(color, opts = {}) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: opts.opacity ?? 1,
    depthTest: opts.depthTest ?? false,
    linewidth: opts.linewidth ?? 1,
  });
}

/** Build a sphere "handle" with given color & size. */
function handle(color, size = 0.04) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), mat);
  mesh.userData.isGizmoHandle = true;
  mesh.renderOrder = 999;
  return mesh;
}

/** Build a ring on a plane (axis = which axis is the ring's normal). */
function ring(color, radius = 1, axis = 'y', segments = 64) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a) * radius;
    const s = Math.sin(a) * radius;
    if (axis === 'x') points.push(0, c, s);
    else if (axis === 'y') points.push(c, 0, s);
    else points.push(c, s, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const line = new THREE.Line(geo, lineMat(color));
  line.renderOrder = 999;
  return line;
}

/** Straight axis line from origin along an axis with optional cone tip. */
function axisLine(color, axis = 'x', length = 1, withTip = true) {
  const group = new THREE.Group();
  const dir = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, dir.x * length, dir.y * length, dir.z * length,
  ], 3));
  const line = new THREE.Line(geo, lineMat(color));
  group.add(line);

  if (withTip) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.12, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false }),
    );
    cone.position.copy(dir).multiplyScalar(length);
    // Cone defaults to +Y; rotate to align with axis
    if (axis === 'x') cone.rotation.z = -Math.PI / 2;
    else if (axis === 'z') cone.rotation.x = Math.PI / 2;
    cone.renderOrder = 999;
    group.add(cone);
  }
  group.renderOrder = 999;
  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gizmo factory functions — each returns a THREE.Group with .userData.gizmoType
// and either .userData.update() / .userData.handles for the interaction layer.
// ─────────────────────────────────────────────────────────────────────────────

/** PLACEMENT — horizontal blue ring (sit on ground plane) + yellow rotation arrow. */
function makePlacement() {
  const g = new THREE.Group();
  g.userData.gizmoType = 'placement';

  // Top hexagon dot (reference point above)
  const top = handle(COLOR_Z, 0.06);
  top.position.set(0, 0.7, 0);
  g.add(top);

  // Vertical guide from top to center
  const guide = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position',
      new THREE.Float32BufferAttribute([0, 0.7, 0,  0, 0, 0], 3)),
    lineMat(COLOR_Z),
  );
  guide.renderOrder = 999;
  g.add(guide);

  // Horizontal ring (placement circle) — blue
  g.add(ring(COLOR_Z, 0.6, 'y', 64));
  // White inner ellipse for grab target
  g.add(ring(COLOR_W, 0.18, 'y', 32));

  // Yellow rotation arrow pointing down
  g.add(axisLine(COLOR_YELLOW, 'y', -0.6, true));

  g.userData.handles = { ring: g.children[2], rotArrow: g.children.at(-1) };
  return g;
}

/** MIRROR — 5-point star with colored vertex dots for mirroring across axes. */
function makeMirror() {
  const g = new THREE.Group();
  g.userData.gizmoType = 'mirror';

  // 5 vertices arranged in a star pattern
  const points = [
    { color: COLOR_Z,      pos: [0, 0.7, 0],     label: '+Y' },
    { color: 0x999999,     pos: [-0.55, 0.18, 0], label: '-X faded' },
    { color: COLOR_X,      pos: [-0.45, -0.35, 0], label: '-X' },
    { color: COLOR_Y,      pos: [0.45, -0.35, 0],  label: '+Y' },
    { color: 0x999999,     pos: [0.55, 0.18, 0],   label: '+X faded' },
  ];
  const lineColors = [
    [COLOR_Z, 0],
    [COLOR_X, 2],
    [COLOR_Y, 3],
  ];

  // Lines from center out to each colored vertex
  const handles = [];
  points.forEach((p, i) => {
    const h = handle(new THREE.Color(p.color), 0.05);
    h.position.set(...p.pos);
    g.add(h);
    handles.push(h);

    // Line from center to vertex
    const line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position',
        new THREE.Float32BufferAttribute([0, 0, 0, p.pos[0], p.pos[1], p.pos[2]], 3)),
      lineMat(new THREE.Color(p.color), { opacity: 0.6 }),
    );
    line.renderOrder = 999;
    g.add(line);
  });

  g.userData.handles = { vertices: handles };
  return g;
}

/** VR — cube wireframe with rings on each face. */
function makeVR() {
  const g = new THREE.Group();
  g.userData.gizmoType = 'vr';

  // Cube edges
  const cube = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 0.9, 0.9)),
    lineMat(0x999999, { opacity: 0.8 }),
  );
  cube.renderOrder = 999;
  g.add(cube);

  // Add a ring on each visible face
  const faceRings = [
    { axis: 'z', pos: [0, 0, 0.45],  color: COLOR_Z, scale: 0.32 },     // front: blue (or top in iso)
    { axis: 'y', pos: [0, 0.45, 0],  color: COLOR_Z, scale: 0.32 },     // top:   blue
    { axis: 'x', pos: [-0.45, 0, 0], color: COLOR_X, scale: 0.32 },     // left:  red
    { axis: 'x', pos: [0.45, 0, 0],  color: COLOR_X, scale: 0.32 },     // right: red
    { axis: 'z', pos: [0, 0, -0.45], color: COLOR_Y, scale: 0.32 },     // back:  green
    { axis: 'y', pos: [0, -0.45, 0], color: COLOR_Y, scale: 0.32 },     // bottom: green
  ];
  faceRings.forEach(f => {
    const r = ring(new THREE.Color(f.color), f.scale, f.axis);
    r.position.set(...f.pos);
    g.add(r);
  });
  return g;
}

/** TRANSPOSE — ZBrush-style line with two ring handles for chain manipulation. */
function makeTranspose() {
  const g = new THREE.Group();
  g.userData.gizmoType = 'transpose';

  // Dashed vertical line
  const geo = new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute([0, -0.9, 0,  0, 0.9, 0], 3));
  const mat = new THREE.LineDashedMaterial({
    color: 0xffffaa, dashSize: 0.05, gapSize: 0.03,
    transparent: true, depthTest: false,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 999;
  g.add(line);

  // Three ring handles along the line — top, mid, bottom
  const ringTop = ring(COLOR_W, 0.18, 'y');
  ringTop.position.y = 0.9;
  g.add(ringTop);

  const ringMid = ring(COLOR_W, 0.15, 'y');
  g.add(ringMid);

  const ringBot = ring(COLOR_W, 0.18, 'y');
  ringBot.position.y = -0.9;
  g.add(ringBot);

  g.userData.handles = { top: ringTop, mid: ringMid, bottom: ringBot };
  return g;
}

/** 3D CURSOR — RGB axes + center dot + dashed circle. */
function makeCursor() {
  const g = new THREE.Group();
  g.userData.gizmoType = 'cursor';

  // Three axes with colored cones
  g.add(axisLine(COLOR_X, 'x', 0.7, true));
  g.add(axisLine(COLOR_Y, 'y', 0.7, true));
  g.add(axisLine(COLOR_Z, 'z', 0.7, true));

  // Center dot
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
  );
  dot.renderOrder = 999;
  g.add(dot);

  // Dashed reference circle in the XZ plane
  const segments = 32;
  const radius = 0.22;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const ringGeo = new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute(points, 3));
  const ringMat = new THREE.LineDashedMaterial({
    color: 0xffffff, dashSize: 0.03, gapSize: 0.02,
    transparent: true, opacity: 0.7, depthTest: false,
  });
  const dashed = new THREE.Line(ringGeo, ringMat);
  dashed.computeLineDistances();
  dashed.renderOrder = 999;
  g.add(dashed);

  return g;
}

/** SHEAR — three thick colored bars in an X pattern. */
function makeShear() {
  const g = new THREE.Group();
  g.userData.gizmoType = 'shear';

  // Center cone (yellow tip)
  g.add(axisLine(COLOR_YELLOW, 'y', 0.7, true));

  // 3 colored shear bars — each goes diagonally outward
  const bars = [
    { color: COLOR_X, dir: new THREE.Vector3(-0.5, 0,  0.4) },
    { color: COLOR_Y, dir: new THREE.Vector3( 0.5, 0,  0.4) },
    { color: COLOR_Z, dir: new THREE.Vector3( 0,   0, -0.6) },
  ];
  bars.forEach(b => {
    // Thick cylindrical bar
    const len = b.dir.length();
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, len, 12),
      new THREE.MeshBasicMaterial({ color: b.color, transparent: true, depthTest: false }),
    );
    // Orient: cylinder is along +Y by default, point it toward b.dir
    cyl.position.copy(b.dir).multiplyScalar(0.5);
    cyl.lookAt(b.dir);
    cyl.rotateX(Math.PI / 2);
    cyl.renderOrder = 999;
    g.add(cyl);
  });
  return g;
}

/** CAMERA — frustum + 3 rotation rings (cyan/green/red). */
function makeCamera() {
  const g = new THREE.Group();
  g.userData.gizmoType = 'camera';

  // Frustum (4 lines from apex out to a rectangle)
  const apex = new THREE.Vector3(0, 0, 0);
  const corners = [
    new THREE.Vector3(-0.4, -0.3, -0.7),
    new THREE.Vector3( 0.4, -0.3, -0.7),
    new THREE.Vector3( 0.4,  0.3, -0.7),
    new THREE.Vector3(-0.4,  0.3, -0.7),
  ];
  const frustumPoints = [];
  // 4 edges from apex to corners
  corners.forEach(c => {
    frustumPoints.push(apex.x, apex.y, apex.z, c.x, c.y, c.z);
  });
  // 4 edges around the far rectangle
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    frustumPoints.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const frustumGeo = new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute(frustumPoints, 3));
  const frustum = new THREE.LineSegments(frustumGeo, lineMat(0xffff66));
  frustum.renderOrder = 999;
  g.add(frustum);

  // 3 rotation rings around the apex
  const ringY = ring(0x66ffff, 0.45, 'y');                    // cyan — yaw
  const ringX = ring(0x66ff66, 0.45, 'x');                    // green — pitch
  const ringZ = ring(0xff6666, 0.45, 'z');                    // red — roll
  g.add(ringY, ringX, ringZ);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gizmo system — manages a single active gizmo, handles raycasting + drag.
// ─────────────────────────────────────────────────────────────────────────────

const FACTORIES = {
  placement: makePlacement,
  mirror:    makeMirror,
  vr:        makeVR,
  transpose: makeTranspose,
  cursor:    makeCursor,
  shear:     makeShear,
  camera:    makeCamera,
};

export function createGizmoSystem(scene, camera, renderer, orbitControls) {
  let active = null;       // { type, mesh, target }
  let dragging = null;     // { handle, plane, offset }
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const listeners = { change: [] };

  function on(event, cb) { (listeners[event] ||= []).push(cb); }
  function emit(event, ...args) { (listeners[event] || []).forEach(cb => cb(...args)); }

  /**
   * Attach a gizmo of the given type to a target Object3D (or to a free-floating
   * position in the scene if no target). Detaches any previous gizmo.
   */
  function attach(type, target) {
    detach();
    const factory = FACTORIES[type];
    if (!factory) {
      console.warn(`[gizmos] Unknown type "${type}". Available: ${list().join(', ')}`);
      return null;
    }
    const mesh = factory();
    mesh.scale.setScalar(target ? Math.max(0.5, getObjectSize(target)) : 1);
    if (target) {
      target.add(mesh);
    } else {
      scene.add(mesh);
    }
    active = { type, mesh, target };
    return mesh;
  }

  function detach() {
    if (!active) return;
    if (active.mesh.parent) active.mesh.parent.remove(active.mesh);
    active = null;
  }

  function list() { return Object.keys(FACTORIES); }

  function getObjectSize(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) || 1;
  }

  // ── Pointer interaction ──
  function onPointerDown(e) {
    if (!active) return;
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    // Find any gizmo handle under the cursor
    const handles = [];
    active.mesh.traverse(o => { if (o.userData.isGizmoHandle) handles.push(o); });
    const hits = raycaster.intersectObjects(handles, false);
    if (hits.length === 0) return;
    if (orbitControls) orbitControls.enabled = false;
    const hit = hits[0];
    // Create a drag plane at the handle facing the camera
    const plane = new THREE.Plane();
    plane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(),
      hit.point,
    );
    const offset = hit.point.clone().sub(active.mesh.getWorldPosition(new THREE.Vector3()));
    dragging = { handle: hit.object, plane, offset, startPoint: hit.point.clone() };
  }
  function onPointerMove(e) {
    if (!dragging) return;
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragging.plane, hit)) {
      // Move the gizmo's target (or the gizmo itself) toward the new point.
      const delta = hit.clone().sub(dragging.startPoint);
      dragging.startPoint.copy(hit);
      const subject = active.target || active.mesh;
      subject.position.add(delta);
      emit('change', { type: active.type, target: subject, delta });
    }
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = null;
    if (orbitControls) orbitControls.enabled = true;
  }
  function setPointer(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  function dispose() {
    detach();
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  return {
    attach,
    detach,
    list,
    on,
    get active() { return active; },
    dispose,
  };
}

// Convenience: also expose the factory map so users can create stand-alone
// gizmo visuals without the pointer system attached.
export const gizmoFactories = FACTORIES;
