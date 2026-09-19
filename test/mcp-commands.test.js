/**
 * The agent surface, exercised against a fake `ui`.
 *
 * These run without a socket or a server on purpose: the transport is the
 * boring half, and what actually matters is that every tool either does what
 * it claims or fails with a message an agent can act on. A tool that silently
 * half-works is worse than one that errors — see the "control looks wired but
 * isn't" ledger in AGENTS.md.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runCommand, CommandError } from '../mcp-commands.js';
import { TOOLS, WRITE_TOOLS } from '../mcp/tools.js';

/** Minimal stand-ins — enough shape for the commands, no Three.js required. */
const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
function fakeObject(name, extra = {}) {
  return {
    name, type: 'Mesh', visible: true,
    position: vec(), rotation: vec(), scale: vec(1, 1, 1),
    children: [], updateMatrixWorld: vi.fn(), traverse(cb) { cb(this); },
    ...extra,
  };
}

function fakeUI() {
  const cube = fakeObject('Cube');
  const undoStack = [];
  const redoStack = [];
  const onChange = vi.fn();
  const control = {
    _value: 0.5,
    getValue() { return this._value; },
    setValue(v) { this._value = v; },
    _onChange: onChange,
  };
  return {
    _hostOnChange: onChange,
    _camera: { position: vec(0, 0, 5), lookAt: vi.fn(), updateMatrixWorld: vi.fn() },
    _controls: null,
    isVisible: () => true,
    toggleKeys: ['Shift+D'],
    panel: { title: 'Inspector', folders: { Material: { controls: { Roughness: control } } } },
    scenePanel: null,
    objectManager: {
      objects: { Cube: { object: cube, kind: 'mesh' } },
      activeName: null,
      getObject(n) { return this.objects[n]?.object ?? null; },
      getNames() { return Object.keys(this.objects); },
      select(n) { this.activeName = n; },
      emit: vi.fn(),
    },
    skills: {
      describe: () => ({ skills: [{ id: '3d.lighting', name: 'Lighting', applied: false }] }),
      suggest: () => [{ skill: { id: '3d.lighting' }, score: 105, reason: 'detected' }],
      apply: vi.fn(() => ({ folder: { name: 'Lighting' } })),
    },
    _undo: {
      push: (cmd) => undoStack.push(cmd),
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      undo() { const c = undoStack.pop(); c.undo(); redoStack.push(c); },
      redo() { const c = redoStack.pop(); c.redo(); undoStack.push(c); },
    },
    _undoStack: undoStack,
    _cube: cube,
    _control: control,
  };
}

let ui;
beforeEach(() => { ui = fakeUI(); });

describe('tool contract', () => {
  it('every advertised tool is implemented', () => {
    for (const t of TOOLS) {
      expect(() => runCommand(ui, t.name, {}), t.name).not.toThrow(/Unknown tool/);
    }
  });

  it('rejects an unknown tool by name', () => {
    expect(() => runCommand(ui, 'drop_database')).toThrow(CommandError);
  });

  it('names the missing argument instead of throwing a TypeError', () => {
    expect(() => runCommand(ui, 'select_object', {})).toThrow(/requires "name"/);
  });
});

describe('reads', () => {
  it('get_scene_tree reports objects and selection', () => {
    ui.objectManager.activeName = 'Cube';
    const r = runCommand(ui, 'get_scene_tree');
    expect(r.selected).toBe('Cube');
    expect(r.objects[0]).toMatchObject({ name: 'Cube', kind: 'mesh', visible: true });
  });

  it('get_object explains itself when the name is wrong, and lists what exists', () => {
    expect(() => runCommand(ui, 'get_object', { name: 'Cub' }))
      .toThrow(/No registered object named "Cub".*Known: Cube/s);
  });

  it('get_panel_state exposes live control values', () => {
    const r = runCommand(ui, 'get_panel_state');
    expect(r.panels[0].folders[0]).toMatchObject({
      name: 'Material', controls: [{ name: 'Roughness', value: 0.5 }],
    });
  });
});

describe('writes', () => {
  it('set_transform moves the object and is undoable', () => {
    runCommand(ui, 'set_transform', { name: 'Cube', position: { x: 3 } });
    expect(ui._cube.position.x).toBe(3);

    ui._undo.undo();
    expect(ui._cube.position.x).toBe(0);
    ui._undo.redo();
    expect(ui._cube.position.x).toBe(3);
  });

  it('set_transform leaves untouched axes and components alone', () => {
    ui._cube.scale = vec(2, 2, 2);
    runCommand(ui, 'set_transform', { name: 'Cube', position: { y: 5 } });
    expect(ui._cube.position).toMatchObject({ x: 0, y: 5, z: 0 });
    expect(ui._cube.scale).toMatchObject({ x: 2, y: 2, z: 2 });
  });

  it('set_transform refuses a non-numeric axis rather than writing NaN', () => {
    expect(() => runCommand(ui, 'set_transform', { name: 'Cube', position: { x: 'far' } }))
      .toThrow(/position.x must be a finite number/);
    expect(ui._cube.position.x).toBe(0);
  });

  it('set_transform requires something to set', () => {
    expect(() => runCommand(ui, 'set_transform', { name: 'Cube' }))
      .toThrow(/at least one of position, rotation or scale/);
  });

  it('set_control drives the host handler, not just the widget', () => {
    const r = runCommand(ui, 'set_control', { folder: 'Material', control: 'Roughness', value: 0.9 });
    expect(ui._control.getValue()).toBe(0.9);
    expect(ui._hostOnChange).toHaveBeenCalledWith(0.9);   // the half that actually changes the scene
    expect(r).toMatchObject({ before: 0.5, value: 0.9 });
  });

  it('set_control refuses a control with no handler instead of reporting a phantom change', () => {
    ui.panel.folders.Material.controls.Readout = { getValue: () => 1, setValue: vi.fn() };
    expect(() => runCommand(ui, 'set_control', { folder: 'Material', control: 'Readout', value: 2 }))
      .toThrow(/no change handler/);
  });

  it('set_control lists the available names when asked for one that is missing', () => {
    expect(() => runCommand(ui, 'set_control', { folder: 'Material', control: 'Rughness', value: 1 }))
      .toThrow(/It has: Roughness/);
    expect(() => runCommand(ui, 'set_control', { folder: 'Nope', control: 'x', value: 1 }))
      .toThrow(/Mounted: Material/);
  });

  it('apply_skill refuses an id that is not in the catalog', () => {
    expect(() => runCommand(ui, 'apply_skill', { id: '3d.nope' })).toThrow(/Known ids: 3d.lighting/);
    expect(ui.skills.apply).not.toHaveBeenCalled();
  });

  it('undo and redo report honestly when there is nothing to do', () => {
    expect(runCommand(ui, 'undo')).toMatchObject({ undone: false });
    expect(runCommand(ui, 'redo')).toMatchObject({ redone: false });
  });
});

describe('read-only mode', () => {
  it('refuses every mutating tool', () => {
    for (const name of WRITE_TOOLS) {
      expect(() => runCommand(ui, name, { name: 'Cube', id: 'x', folder: 'Material', control: 'Roughness', value: 1, material: 'm', object: 'Cube' }, { readOnly: true }), name)
        .toThrow(/read-only/);
    }
  });

  it('still allows reads', () => {
    expect(runCommand(ui, 'get_scene_tree', {}, { readOnly: true }).count).toBe(1);
  });

  it('does not mutate anything while refusing', () => {
    try { runCommand(ui, 'set_transform', { name: 'Cube', position: { x: 9 } }, { readOnly: true }); } catch { /* expected */ }
    expect(ui._cube.position.x).toBe(0);
  });
});

describe('the confirm() veto gates writes only', () => {
  // The hook is documented as gating mutations. An implementation that also
  // asked about get_scene_tree would make it unusable in practice, so the
  // split is part of the contract, not an optimisation.
  it('classifies every tool as read or write, with no overlap', () => {
    const reads = TOOLS.filter(t => t.readOnly).map(t => t.name);
    expect(reads.length + WRITE_TOOLS.length).toBe(TOOLS.length);
    expect(reads.filter(n => WRITE_TOOLS.includes(n))).toEqual([]);
  });

  it('lists the mutating tools a host would be asked to approve', () => {
    expect(WRITE_TOOLS).toEqual([
      'select_object', 'set_transform', 'set_control', 'apply_skill',
      'assign_material', 'set_camera', 'focus_object', 'undo', 'redo',
    ]);
  });
});

describe('hosts without the optional pieces', () => {
  it('explains a missing materials palette rather than throwing a TypeError', () => {
    delete ui.materials;
    expect(() => runCommand(ui, 'list_materials')).toThrow(/Three.js hosts only/);
  });

  it('explains a missing object manager on a 2D host', () => {
    delete ui.objectManager;
    expect(() => runCommand(ui, 'get_scene_tree')).toThrow(/no object manager/);
  });
});
