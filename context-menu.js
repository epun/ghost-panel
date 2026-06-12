/**
 * In-canvas context menu — surfaces actions for the object under the cursor
 * when the user right-clicks the 3D viewport. Mirrors Blender / Maya
 * conventions: actions vary by what was hit (Mesh, Light, Camera, nothing).
 *
 *   const menu = attachCanvasContextMenu(ui);
 *
 * The menu is a single shared DOM node owned by Ghost Panel; each open call
 * rebuilds the items from the current hit. Closes on outside-click or Esc.
 */

import { icons } from './icons.js';

export class ContextMenu {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'dui-context-menu';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
    this._onDocClick = (e) => {
      if (!this.el.contains(e.target)) this.close();
    };
    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
  }

  /**
   * Open at screen coords (x, y) with the given items.
   *   items: [{ label, icon?, danger?, disabled?, separator?, onClick }]
   */
  open(x, y, items) {
    this.el.innerHTML = items.map((it, i) => {
      if (it.separator) return `<div class="dui-cm-sep"></div>`;
      const cls = [
        'dui-cm-item',
        it.danger    ? 'dui-cm-danger'   : '',
        it.disabled  ? 'dui-cm-disabled' : '',
      ].filter(Boolean).join(' ');
      const icon = it.icon ? `<span class="dui-cm-icon">${it.icon}</span>` : '';
      return `<button class="${cls}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
        ${icon}<span class="dui-cm-label">${escapeHtml(it.label || '')}</span>
        ${it.shortcut ? `<span class="dui-cm-shortcut">${escapeHtml(it.shortcut)}</span>` : ''}
      </button>`;
    }).join('');
    this.el.style.display = 'block';
    // Pin within viewport — flip to the left/up if the menu would overflow.
    const r = this.el.getBoundingClientRect();
    const w = this.el.offsetWidth || 200;
    const h = this.el.offsetHeight || 100;
    const left = Math.min(x, innerWidth  - w - 4);
    const top  = Math.min(y, innerHeight - h - 4);
    this.el.style.left = `${Math.max(4, left)}px`;
    this.el.style.top  = `${Math.max(4, top)}px`;
    this.el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.i;
        const item = items[idx];
        if (item?.disabled || !item?.onClick) return;
        this.close();
        try { item.onClick(); } catch (e) { console.warn('[context-menu] action failed:', e); }
      });
    });
    setTimeout(() => {
      document.addEventListener('click', this._onDocClick, true);
      window.addEventListener('keydown', this._onKey);
    }, 0);
  }
  close() {
    this.el.style.display = 'none';
    document.removeEventListener('click', this._onDocClick, true);
    window.removeEventListener('keydown', this._onKey);
  }
  dispose() { this.close(); this.el.remove(); }
}

/**
 * Attach right-click handling to the 3D canvas. When the user right-clicks,
 * we raycast against the registered objects (and their helpers) and surface
 * a menu of actions. Selecting an item runs the bound function.
 */
export function attachCanvasContextMenu(ui) {
  const om = ui?.objectManager;
  if (!om || !om.renderer?.domElement || !om.camera) return null;

  const menu = new ContextMenu();
  const canvas = om.renderer.domElement;
  const onContext = async (e) => {
    // Skip when a modal transform owns input — RMB cancels there.
    if (ui._modalTransform?.active) return;
    e.preventDefault();
    const THREE = await import('three');
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const r = canvas.getBoundingClientRect();
    pointer.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    pointer.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, om.camera);
    const targets = Object.values(om.objects)
      .flatMap(o => [o.object, o.helper]).filter(Boolean);
    const hits = raycaster.intersectObjects(targets, true);
    let hitName = null;
    if (hits.length) {
      let node = hits[0].object;
      while (node) {
        const match = Object.entries(om.objects).find(
          ([_n, ent]) => ent.object === node || ent.helper === node);
        if (match) { hitName = match[0]; break; }
        node = node.parent;
      }
    }
    // Select what we hit so the action targets the right thing.
    if (hitName) om.select(hitName);
    const obj = hitName ? om.getObject(hitName) : null;
    const items = buildItems(ui, obj, hitName, hits[0]?.point);
    menu.open(e.clientX, e.clientY, items);
  };
  canvas.addEventListener('contextmenu', onContext);
  return {
    menu,
    dispose() { canvas.removeEventListener('contextmenu', onContext); menu.dispose(); },
  };
}

// ── Item factory ──
// Builds the visible action list based on what was right-clicked. The
// "Recenter origin to geometry" item is the one the user explicitly
// asked for; the rest fall in naturally alongside it.
function buildItems(ui, obj, name, worldPoint) {
  const om = ui.objectManager;
  const items = [];
  if (obj && name) {
    items.push({
      label: `Select: ${name}`,
      icon: icons.cube,
      onClick: () => om.select(name),
    });
    if (obj.isMesh && obj.geometry) {
      items.push({
        label: 'Recenter origin to geometry',
        icon: icons.focusReticle,
        onClick: () => recenterOriginToGeometry(obj),
      });
    }
    if (obj.isObject3D && worldPoint) {
      items.push({
        label: 'Set origin to cursor',
        icon: icons.focusReticle,
        onClick: () => setOriginToPoint(obj, worldPoint),
      });
    }
    if (obj.position && ui.objectManager.orbitControls?.target) {
      items.push({
        label: 'Focus camera here',
        icon: icons.camera,
        onClick: () => {
          const tgt = ui.objectManager.orbitControls.target;
          tgt.copy(obj.position);
          ui.objectManager.orbitControls.update?.();
        },
      });
    }
    items.push({ separator: true });
    items.push({
      label: 'Rename…',
      icon: icons.pencil,
      onClick: () => {
        const nameEl = document.querySelector(`.dui-list-item .dui-name`);
        if (!nameEl) return;
        // Find the row matching this object and trigger its dblclick.
        const rows = document.querySelectorAll('.dui-list-item');
        rows.forEach(row => {
          if (row.querySelector('.dui-name')?.textContent === name) {
            row.querySelector('.dui-name')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          }
        });
      },
    });
    items.push({
      label: `Delete "${name}"`,
      icon: icons.trash,
      danger: true,
      onClick: () => { om.remove(name); },
    });
  } else {
    // Nothing under the cursor — offer scene-level actions.
    items.push({
      label: 'Deselect',
      icon: icons.x,
      disabled: !om.activeName,
      onClick: () => om.deselect?.(),
    });
    if (ui._addMenu?.open) {
      items.push({
        label: 'Add object…',
        icon: icons.arrowsOut,
        shortcut: 'Shift+A',
        onClick: () => ui._addMenu.open?.(),
      });
    }
  }
  return items;
}

/**
 * Shift the mesh's geometry so its bounding-box center sits at (0,0,0) in
 * local space, then move the mesh by the inverse so the world position
 * doesn't change. End result: the gizmo / transform pivot lines up with
 * what the user perceives as the object's center.
 */
function recenterOriginToGeometry(mesh) {
  const geom = mesh.geometry;
  if (!geom) return;
  geom.computeBoundingBox();
  if (!geom.boundingBox) return;
  const center = geom.boundingBox.getCenter(new geom.boundingBox.min.constructor());
  if (center.lengthSq() < 1e-12) return;        // already centered
  geom.translate(-center.x, -center.y, -center.z);
  mesh.position.add(center.applyQuaternion(mesh.quaternion).multiply(mesh.scale));
  geom.computeBoundingBox();
  geom.computeBoundingSphere?.();
  mesh.updateMatrixWorld(true);
}

/** Set the object's origin to an arbitrary world point. */
function setOriginToPoint(obj, worldPoint) {
  if (!obj.geometry) {
    // For non-mesh Object3Ds, just move them.
    obj.position.copy(worldPoint);
    return;
  }
  // Convert world point to mesh-local space, then re-translate the geometry.
  const local = worldPoint.clone();
  obj.worldToLocal(local);
  obj.geometry.translate(-local.x, -local.y, -local.z);
  obj.position.copy(worldPoint);
  obj.geometry.computeBoundingBox?.();
  obj.geometry.computeBoundingSphere?.();
  obj.updateMatrixWorld(true);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;',
  }[ch]));
}
