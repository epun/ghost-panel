/**
 * Standalone example — copy this into any project to see Ghost Panel in action.
 *
 * Two modes shown:
 *   1. Pure 2D mode (no Three.js)
 *   2. Three.js mode with a cube + gizmo + scene panel
 *
 * Toggle between them by commenting out one of the two `example*()` calls
 * at the bottom.
 */
import { createGhostPanel } from './index.js';

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 1 — Pure 2D: animate a CSS box with debug controls
// ─────────────────────────────────────────────────────────────────────────────
export function example2D() {
  const box = document.createElement('div');
  box.style.cssText = `
    position: fixed; left: 50%; top: 50%;
    width: 100px; height: 100px;
    background: #88ccff; transform: translate(-50%, -50%);
    border-radius: 12px;
    transition: transform 0.05s linear;
  `;
  document.body.appendChild(box);

  const state = { size: 100, rotation: 0, color: '#88ccff', spinning: false };
  function apply() {
    box.style.width = `${state.size}px`;
    box.style.height = `${state.size}px`;
    box.style.background = state.color;
    box.style.transform = `translate(-50%, -50%) rotate(${state.rotation}deg)`;
  }
  apply();

  const ui = createGhostPanel({ title: 'Box Tweaks', visible: true });

  ui.addFolder('Shape')
    .addSlider('Size',     { min: 20, max: 400, value: 100, onChange: v => { state.size = v; apply(); } })
    .addSlider('Rotation', { min: 0, max: 360, value: 0,    onChange: v => { state.rotation = v; apply(); } })
    .addColor('Color',     { value: state.color,            onChange: c => { state.color = c; apply(); } });

  ui.addFolder('Behavior')
    .addCheckbox('Spinning', { value: false, onChange: v => { state.spinning = v; } })
    .addButton('Reset',      () => {
      state.size = 100; state.rotation = 0; state.color = '#88ccff';
      ui.getFolder('Shape').get('Size').setValue(100);
      ui.getFolder('Shape').get('Rotation').setValue(0);
      ui.getFolder('Shape').get('Color').setValue(state.color);
      apply();
    });

  // Animation loop
  function tick() {
    if (state.spinning) {
      state.rotation = (state.rotation + 1) % 360;
      apply();
      ui.getFolder('Shape').get('Rotation').setValue(state.rotation);
    }
    requestAnimationFrame(tick);
  }
  tick();

  ui.bindToggleKey('D', { shift: true });
  return ui;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXAMPLE 2 — Three.js: cube + gizmo + scene panel
// ─────────────────────────────────────────────────────────────────────────────
export async function example3D() {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

  // Standard Three.js setup
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202024);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(3, 3, 5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;

  // Scene contents
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(5, 10, 7); scene.add(dir);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffcc66, metalness: 0.3, roughness: 0.5 })
  );
  scene.add(cube);
  cube.name = 'Cube';

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xff5577, metalness: 0.6, roughness: 0.3 })
  );
  sphere.position.set(2, 0, 0);
  scene.add(sphere);
  sphere.name = 'Sphere';

  // ── Ghost Panel setup ──
  const ui = createGhostPanel({
    title: 'Inspector',
    scene, camera, renderer, controls,
    scenePanel: true,
    visible: true,
  });

  ui.objectManager.register('Cube', cube);
  ui.objectManager.register('Sphere', sphere);
  ui.refreshSceneObjects();

  // Custom controls for the cube material
  ui.addFolder('Cube Material')
    .addColor('Color',     { value: '#ffcc66', onChange: c => cube.material.color.set(c) })
    .addSlider('Metalness', { min: 0, max: 1, value: 0.3, onChange: v => cube.material.metalness = v })
    .addSlider('Roughness', { min: 0, max: 1, value: 0.5, onChange: v => cube.material.roughness = v })
    .addCheckbox('Wireframe', { value: false, onChange: v => cube.material.wireframe = v });

  ui.addFolder('Animation')
    .addCheckbox('Spin Cube', { value: false, onChange: v => state.spin = v })
    .addSlider('Spin Speed',  { min: 0, max: 5, value: 1, onChange: v => state.spinSpeed = v });

  ui.addFolder('Scene')
    .addButtonRow([
      { label: 'Save State', onClick: () => {
        localStorage.setItem('scene', JSON.stringify(ui.toJSON()));
      }},
      { label: 'Load State', onClick: () => {
        const s = localStorage.getItem('scene');
        if (s) ui.fromJSON(JSON.parse(s));
      }},
    ]);

  ui.bindToggleKey('D', { shift: true });

  // Animation
  const state = { spin: false, spinSpeed: 1 };
  function animate() {
    requestAnimationFrame(animate);
    if (state.spin) {
      cube.rotation.y += 0.01 * state.spinSpeed;
      cube.rotation.x += 0.005 * state.spinSpeed;
    }
    controls.update();
    ui.update();
    renderer.render(scene, camera);
  }
  animate();

  return ui;
}

// Uncomment one to run:
// example2D();
// example3D();
