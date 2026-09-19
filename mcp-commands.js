/**
 * Browser-side execution of the MCP tool contract.
 *
 * Deliberately transport-free: every command is `(ui, args) => result`, so the
 * whole agent surface can be unit-tested against a fake `ui` without a socket,
 * a server, or a browser. `mcp-bridge.js` supplies the transport.
 *
 * Writes go through the same public API a user's click would: set_control
 * drives the control's own onChange (so the Folder's auto-undo wrapper records
 * an entry), set_transform pushes its own undo entry, and assign_material goes
 * through the palette. An agent's edit should be as undoable as a human's.
 */
import { TOOLS_BY_NAME, WRITE_TOOLS } from './mcp/tools.js';

/** Thrown for anything the agent can fix by calling a different tool or argument. */
export class CommandError extends Error {}

const num = (v) => (typeof v === 'number' && Number.isFinite(v));

function requireObject(ui, name) {
  const om = ui?.objectManager;
  if (!om) throw new CommandError('This panel has no object manager — not a 3D or scene-backed host.');
  const obj = om.getObject?.(name);
  if (!obj) {
    const known = om.getNames?.() || [];
    throw new CommandError(
      `No registered object named ${JSON.stringify(name)}.` +
      (known.length ? ` Known: ${known.slice(0, 20).join(', ')}` : ' The scene has none registered.'));
  }
  return obj;
}

/** {x,y,z} → plain numbers, tolerating Three.js Vector3/Euler. */
function readVec(v) {
  if (!v) return null;
  return { x: +v.x || 0, y: +v.y || 0, z: +v.z || 0 };
}

function validateVec(v, label) {
  if (v == null) return null;
  if (typeof v !== 'object') throw new CommandError(`${label} must be an object like {x,y,z}.`);
  const out = {};
  for (const axis of ['x', 'y', 'z']) {
    if (v[axis] === undefined) continue;
    if (!num(v[axis])) throw new CommandError(`${label}.${axis} must be a finite number.`);
    out[axis] = v[axis];
  }
  if (!Object.keys(out).length) throw new CommandError(`${label} needs at least one of x, y, z.`);
  return out;
}

function materialSummary(m, users) {
  if (!m) return null;
  return {
    id: m.uuid,
    name: m.name || null,
    type: m.type || null,
    color: m.color?.getHexString ? `#${m.color.getHexString()}` : null,
    opacity: m.opacity,
    transparent: !!m.transparent,
    ...(users === undefined ? {} : { users }),
  };
}

function objectSummary(name, entry) {
  const o = entry?.object;
  if (!o) return { name, kind: entry?.kind || 'unknown' };
  const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
  return {
    name,
    kind: entry.kind || o.type || 'object',
    type: o.type || null,
    visible: o.visible !== false,
    position: readVec(o.position),
    rotation: readVec(o.rotation),
    scale: readVec(o.scale),
    materials: mats.map(m => materialSummary(m)).filter(Boolean),
    children: typeof o.children?.length === 'number' ? o.children.length : 0,
  };
}

export const COMMANDS = {
  // ── Reads ───────────────────────────────────────────────────────────────
  describe_skills(ui) {
    if (!ui.skills) throw new CommandError('The skills registry is not attached to this panel.');
    return ui.skills.describe();
  },

  suggest_skills(ui) {
    if (!ui.skills) throw new CommandError('The skills registry is not attached to this panel.');
    return { suggestions: ui.skills.suggest() };
  },

  get_scene_tree(ui) {
    const om = ui.objectManager;
    if (!om) throw new CommandError('This panel has no object manager — not a 3D or scene-backed host.');
    const objects = Object.entries(om.objects || {}).map(([n, e]) => objectSummary(n, e));
    return {
      selected: om.activeName ?? null,
      count: objects.length,
      objects,
      workflows: ui.activeWorkflows ?? [],
    };
  },

  get_object(ui, { name }) {
    requireObject(ui, name);
    return objectSummary(name, ui.objectManager.objects[name]);
  },

  list_materials(ui) {
    if (!ui.materials) throw new CommandError('No materials palette on this panel (Three.js hosts only).');
    const om = ui.objectManager;
    const countUsers = (mat) => {
      let n = 0;
      Object.values(om?.objects || {}).forEach(({ object }) => {
        object?.traverse?.((c) => {
          const mats = Array.isArray(c.material) ? c.material : (c.material ? [c.material] : []);
          if (mats.includes(mat)) n++;
        });
      });
      return n;
    };
    return { materials: ui.materials.getMaterials().map(m => materialSummary(m, countUsers(m))) };
  },

  get_panel_state(ui) {
    const panels = [ui.panel, ui.scenePanel].filter(Boolean);
    return {
      visible: ui.isVisible?.() ?? null,
      toggleKeys: ui.toggleKeys ?? [],
      panels: panels.map(p => ({
        title: p.title,
        folders: Object.entries(p.folders || {}).map(([fname, f]) => ({
          name: fname,
          controls: Object.entries(f.controls || {}).map(([cname, c]) => {
            let value;
            try { value = c.getValue?.(); } catch { value = undefined; }
            return { name: cname, value: value === undefined ? null : value };
          }),
        })),
      })),
    };
  },

  get_diagnostics(ui) {
    const d = ui._diagnostics;
    if (!d) throw new CommandError('Diagnostics are not attached (they self-strip outside dev).');
    try { d.run?.(); } catch { /* report whatever the last pass found */ }
    return {
      status: d.status,
      issues: (d.issues || []).map(i => ({
        id: i.id, level: i.level, title: i.title, detail: i.detail, codeHint: i.codeHint ?? null,
      })),
    };
  },

  screenshot(ui) {
    const canvas = ui.objectManager?.renderer?.domElement
      || (typeof document !== 'undefined' ? document.querySelector('canvas') : null);
    if (!canvas?.toDataURL) throw new CommandError('No canvas found to capture.');
    const dataURL = canvas.toDataURL('image/png');
    // An all-black or zero-length image almost always means the context was
    // created without preserveDrawingBuffer. Say so rather than handing back a
    // blank PNG that looks like a rendering bug.
    if (!dataURL || dataURL.length < 128) {
      throw new CommandError(
        'The canvas returned an empty image. Create the renderer with ' +
        '{ preserveDrawingBuffer: true } to capture it.');
    }
    return { dataURL, width: canvas.width, height: canvas.height };
  },

  // ── Bounded writes ──────────────────────────────────────────────────────
  select_object(ui, { name }) {
    requireObject(ui, name);
    ui.objectManager.select(name);
    return { selected: ui.objectManager.activeName };
  },

  set_transform(ui, { name, position, rotation, scale }) {
    const obj = requireObject(ui, name);
    const wanted = {
      position: validateVec(position, 'position'),
      rotation: validateVec(rotation, 'rotation'),
      scale: validateVec(scale, 'scale'),
    };
    if (!wanted.position && !wanted.rotation && !wanted.scale) {
      throw new CommandError('Pass at least one of position, rotation or scale.');
    }
    const before = { position: readVec(obj.position), rotation: readVec(obj.rotation), scale: readVec(obj.scale) };
    const write = (state) => {
      for (const key of ['position', 'rotation', 'scale']) {
        const v = state[key];
        if (!v || !obj[key]) continue;
        for (const axis of ['x', 'y', 'z']) if (v[axis] !== undefined) obj[key][axis] = v[axis];
      }
      obj.updateMatrixWorld?.(true);
    };
    write(wanted);
    // Same stack the user's Cmd+Z reaches, so an agent's edit is as reversible
    // as a human's — the whole point of routing through the public API.
    ui._undo?.push({
      label: `Transform ${name}`,
      undo: () => { write(before); ui.objectManager?.emit?.('change', name, obj); },
      redo: () => { write(wanted); ui.objectManager?.emit?.('change', name, obj); },
    });
    ui.refreshSceneObjects?.();
    return objectSummary(name, ui.objectManager.objects[name]);
  },

  set_control(ui, { folder, control, value }) {
    const panels = [ui.panel, ui.scenePanel].filter(Boolean);
    const found = panels.map(p => p.folders?.[folder]).find(Boolean);
    if (!found) {
      const names = panels.flatMap(p => Object.keys(p.folders || {}));
      throw new CommandError(
        `No folder named ${JSON.stringify(folder)}.` +
        (names.length ? ` Mounted: ${names.join(', ')}` : ' No folders are mounted.'));
    }
    const ctrl = found.controls?.[control];
    if (!ctrl) {
      const names = Object.keys(found.controls || {});
      throw new CommandError(
        `Folder ${JSON.stringify(folder)} has no control named ${JSON.stringify(control)}.` +
        (names.length ? ` It has: ${names.join(', ')}` : ' It has none.'));
    }
    if (typeof ctrl.setValue !== 'function') {
      throw new CommandError(`${folder} › ${control} is not a value control (buttons cannot be set).`);
    }
    const before = ctrl.getValue?.();
    ctrl.setValue(value);
    // setValue alone repaints the widget without telling the host — the
    // "control looks wired but isn't" trap from AGENTS.md, seen from the
    // writing side. Folder._bindUndo exposes the committed handler so we can
    // finish the round trip, and because it's the undo-wrapped one, an agent's
    // edit lands on the same stack as a user's drag.
    if (typeof ctrl._onChange === 'function') {
      try { ctrl._onChange(value); }
      catch (e) { throw new CommandError(`The control rejected that value: ${e.message}`); }
    } else {
      throw new CommandError(
        `${folder} › ${control} has no change handler, so setting it would update the widget ` +
        'without affecting anything. Refusing rather than reporting a change that did not happen.');
    }
    return { folder, control, before: before === undefined ? null : before, value: ctrl.getValue?.() ?? value };
  },

  apply_skill(ui, { id }) {
    if (!ui.skills) throw new CommandError('The skills registry is not attached to this panel.');
    const known = (ui.skills.describe()?.skills || []).map(s => s.id);
    if (!known.includes(id)) {
      throw new CommandError(`No skill with id ${JSON.stringify(id)}. Known ids: ${known.join(', ')}`);
    }
    const handle = ui.skills.apply(id);
    return { id, applied: !!handle, folder: handle?.folder?.name ?? null };
  },

  assign_material(ui, { material, object, slot }) {
    if (!ui.materials) throw new CommandError('No materials palette on this panel (Three.js hosts only).');
    const target = requireObject(ui, object);
    const mat = ui.materials.getMaterials().find(m => m.uuid === material);
    if (!mat) throw new CommandError(`No material with id ${JSON.stringify(material)}. Call list_materials first.`);
    ui.materials.assign(target, mat, slot === undefined ? {} : { slot });
    return { object, material: materialSummary(mat), slot: slot ?? null };
  },

  set_camera(ui, { position, target }) {
    const cam = ui._camera;
    if (!cam) throw new CommandError('This panel has no camera reference.');
    const pos = validateVec(position, 'position');
    const tgt = validateVec(target, 'target');
    if (!pos && !tgt) throw new CommandError('Pass position, target, or both.');
    if (pos) for (const axis of ['x', 'y', 'z']) if (pos[axis] !== undefined) cam.position[axis] = pos[axis];
    if (tgt) {
      const controls = ui.cameraControl?.controls || ui._controls;
      if (controls?.target) {
        for (const axis of ['x', 'y', 'z']) if (tgt[axis] !== undefined) controls.target[axis] = tgt[axis];
        controls.update?.();
      } else {
        cam.lookAt?.(tgt.x ?? 0, tgt.y ?? 0, tgt.z ?? 0);
      }
    }
    cam.updateMatrixWorld?.(true);
    return { position: readVec(cam.position) };
  },

  focus_object(ui, { name }) {
    requireObject(ui, name);
    const om = ui.objectManager;
    if (typeof om.focus !== 'function') {
      throw new CommandError('This host has no focus support; use set_camera instead.');
    }
    om.focus(name);
    return { focused: name, camera: readVec(ui._camera?.position) };
  },

  undo(ui) {
    if (!ui._undo) throw new CommandError('No undo stack on this panel.');
    if (!ui._undo.canUndo()) return { undone: false, reason: 'Nothing to undo.' };
    ui._undo.undo();
    return { undone: true, canUndo: ui._undo.canUndo(), canRedo: ui._undo.canRedo() };
  },

  redo(ui) {
    if (!ui._undo) throw new CommandError('No undo stack on this panel.');
    if (!ui._undo.canRedo()) return { redone: false, reason: 'Nothing to redo.' };
    ui._undo.redo();
    return { redone: true, canUndo: ui._undo.canUndo(), canRedo: ui._undo.canRedo() };
  },
};

/**
 * Run one tool against a live `ui`.
 *
 * @param {object} ui
 * @param {string} name
 * @param {object} [args]
 * @param {{ readOnly?: boolean }} [opts] readOnly rejects every mutating tool,
 *   so a host can expose the panel for inspection without handing over control.
 */
export function runCommand(ui, name, args = {}, opts = {}) {
  const spec = TOOLS_BY_NAME[name];
  if (!spec) throw new CommandError(`Unknown tool ${JSON.stringify(name)}.`);
  if (opts.readOnly && WRITE_TOOLS.includes(name)) {
    throw new CommandError(`${name} mutates the scene, and this bridge is read-only.`);
  }
  if (!ui) throw new CommandError('No Ghost Panel instance is connected.');
  const required = spec.inputSchema?.required || [];
  for (const key of required) {
    if (args?.[key] === undefined) throw new CommandError(`${name} requires "${key}".`);
  }
  return COMMANDS[name](ui, args || {});
}
