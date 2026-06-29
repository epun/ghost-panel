import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_SKILLS, SkillsRegistry, attachSkillsAPI, globalRegistry } from '../skills.js';

describe('SkillsRegistry', () => {
  let registry;

  beforeEach(() => {
    localStorage.clear();
    registry = new SkillsRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers skills, emits change, and throws without an id', () => {
    const change = vi.fn();
    registry.on('change', change);
    const skill = { id: 'alpha', name: 'Alpha', workflows: ['3d'], category: '3D', detect: () => false, apply: () => ({}) };

    expect(() => registry.register({})).toThrow('Skill must have an id');
    expect(registry.register(skill)).toBe(skill);
    expect(registry.register(skill)).toBe(skill);
    expect(registry.get('alpha')).toBe(skill);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('unregister tears down applied skills and emits change', async () => {
    const teardown = vi.fn();
    const skill = { id: 'alpha', name: 'Alpha', workflows: ['3d'], category: '3D', detect: () => false, apply: vi.fn(() => ({})), teardown };
    registry.register(skill);
    const ui = {};

    await registry.apply(ui, 'alpha', { ctx: true });
    registry.unregister('alpha');

    expect(teardown).toHaveBeenCalledWith(ui, {});
    expect(registry.get('alpha')).toBeUndefined();
    expect(registry.isApplied('alpha')).toBe(false);
  });

  it('updates skills and re-applies if currently mounted', async () => {
    const teardown = vi.fn();
    const apply = vi.fn(() => ({ version: 1 }));
    const updatedApply = vi.fn(() => ({ version: 2 }));
    const skill = { id: 'alpha', name: 'Alpha', workflows: ['3d'], category: '3D', detect: () => false, apply, teardown };
    const ui = {};
    const ctx = { ok: true };
    registry.register(skill);
    await registry.apply(ui, 'alpha', ctx);
    registry.update('alpha', { apply: updatedApply, description: 'updated' });

    expect(teardown).toHaveBeenCalledWith(ui, { version: 1 });
    expect(updatedApply).toHaveBeenCalledWith(ui, ctx);
    expect(registry.get('alpha').description).toBe('updated');
    expect(registry.update('missing', { x: 1 })).toBeNull();
  });

  it('lists, gets, and reports applied state', () => {
    registry.register({ id: 'a', name: 'A', category: '3D', workflows: ['3d', 'shader'], detect: () => false, apply: () => ({}) });
    registry.register({ id: 'b', name: 'B', category: '2D', workflows: ['2d'], detect: () => false, apply: () => ({}) });
    registry.appliedHandles.set('b', {});

    expect(registry.list({ workflow: '3d' }).map(s => s.id)).toEqual(['a']);
    expect(registry.list({ category: '2D' }).map(s => s.id)).toEqual(['b']);
    expect(registry.list({ applied: true }).map(s => s.id)).toEqual(['b']);
    expect(registry.list({ applied: false }).map(s => s.id)).toEqual(['a']);
    expect(registry.get('a').name).toBe('A');
    expect(registry.isApplied('b')).toBe(true);
  });

  it('applies async skills, caches handles, stores empty handles for null, and marks usage', async () => {
    const apply = vi.fn(async () => {
      await Promise.resolve();
      return null;
    });
    const skill = { id: 'alpha', name: 'Alpha', workflows: ['3d'], category: '3D', detect: () => false, apply };
    registry.register(skill);

    const ui = {};
    const handle = await registry.apply(ui, 'alpha', { ctx: 1 });

    expect(handle).toBeNull();
    expect(registry.appliedHandles.get('alpha')).toEqual({});
    expect(registry.usage.get('alpha').uses).toBe(1);
    expect(await registry.apply(ui, 'alpha', { ctx: 2 })).toEqual({});
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('removes skills using teardown ui and handle', async () => {
    const teardown = vi.fn();
    registry.register({ id: 'alpha', name: 'Alpha', workflows: ['3d'], category: '3D', detect: () => false, apply: () => ({ handle: true }), teardown });
    const ui = { panel: {} };
    await registry.apply(ui, 'alpha');

    registry.remove('alpha');

    expect(teardown).toHaveBeenCalledWith(ui, { handle: true });
    expect(registry.isApplied('alpha')).toBe(false);
    registry.remove('missing');
  });

  it('autoApplies detectable skills and removes stale ones in strict mode', async () => {
    let enabled = true;
    const teardown = vi.fn();
    registry.register({ id: 'detect', name: 'Detect', workflows: ['3d'], category: '3D', detect: () => enabled, apply: () => ({ detect: true }), teardown });
    registry.register({ id: 'implicit', name: 'Implicit', workflows: ['3d'], category: '3D', apply: () => ({ implicit: true }) });
    const ui = {};

    expect(await registry.autoApply(ui, {})).toEqual(['detect', 'implicit']);
    expect(registry.isApplied('detect')).toBe(true);
    expect(registry.isApplied('implicit')).toBe(true);

    enabled = false;
    expect(await registry.autoApply(ui, {}, { strict: true })).toEqual([]);
    expect(teardown).toHaveBeenCalledWith(ui, { detect: true });
    expect(registry.isApplied('detect')).toBe(false);
  });

  it('suggests detected and frequently used skills, skips applied ones, and respects max', () => {
    registry.register({ id: 'a', name: 'A', workflows: ['3d'], category: '3D', detect: () => true, apply: () => ({}) });
    registry.register({ id: 'b', name: 'B', workflows: ['3d'], category: '3D', detect: () => false, apply: () => ({}) });
    registry.register({ id: 'c', name: 'C', workflows: ['3d'], category: '3D', detect: () => true, apply: () => ({}) });
    registry.register({ id: 'd', name: 'D', workflows: ['3d'], category: '3D', detect: () => false, apply: () => ({}) });
    registry.appliedHandles.set('d', {});
    registry.usage.set('b', { uses: 2, lastUsed: 1 });
    registry.usage.set('c', { uses: 1, lastUsed: 1 });
    registry.usage.set('d', { uses: 10, lastUsed: 1 });

    const suggestions = registry.suggest({}, { max: 3 });

    expect(suggestions.map(s => s.skill.id)).toEqual(['c', 'a', 'b']);
    expect(suggestions.map(s => s.score)).toEqual([105, 100, 10]);
    expect(suggestions.every(s => s.skill.id !== 'd')).toBe(true);
    expect(registry.suggest({}, { max: 1 })).toHaveLength(1);
  });

  it('describes skills, dedupes categories and workflows, and can omit properties', async () => {
    registry.register({ id: 'a', name: 'A', category: '3D', workflows: ['3d', 'shader', '3d'], properties: [{ id: 'p' }], detect: () => false, apply: () => ({}) });
    registry.register({ id: 'b', name: 'B', category: '3D', workflows: ['shader', 'audio'], properties: [{ id: 'q' }], detect: () => false, apply: () => ({}) });
    registry.usage.set('a', { uses: 4, lastUsed: 1 });
    registry.appliedHandles.set('a', {});

    const withProps = registry.describe();
    const withoutProps = registry.describe({ includeProperties: false });

    expect(withProps.skills[0]).toMatchObject({ id: 'a', applied: true, uses: 4, properties: [{ id: 'p' }] });
    expect(withoutProps.skills[0].properties).toBeUndefined();
    expect(withProps.categories).toEqual(['3D']);
    expect(withProps.workflows).toEqual(['3d', 'shader', 'audio']);
  });

  it('supports on/off unsubscribe and persistence round-trips usage', async () => {
    const key = 'ghost-panel-test-usage';
    registry.enablePersistence(key);
    registry.register({ id: 'alpha', name: 'Alpha', workflows: ['3d'], category: '3D', detect: () => false, apply: () => ({}) });
    await registry.apply({}, 'alpha');
    expect(JSON.parse(localStorage.getItem(key))).toMatchObject({ alpha: { uses: 1 } });

    const second = new SkillsRegistry();
    second.enablePersistence(key);
    expect(second.usage.get('alpha')).toMatchObject({ uses: 1 });
    const change = vi.fn();
    const off = second.on('change', change);
    off();
    second.register({ id: 'beta', name: 'Beta', workflows: ['3d'], category: '3D', detect: () => false, apply: () => ({}) });
    expect(change).not.toHaveBeenCalled();
  });

  it('attaches the public skills API to a ui object and proxies calls', async () => {
    const manualId = 'test.api.manual';
    const autoId = 'test.api.auto';
    const manualSkill = { id: manualId, name: 'Manual', workflows: ['3d'], category: '3D', detect: () => false, apply: () => ({ manual: true }) };
    const autoSkill = { id: autoId, name: 'Auto', workflows: ['3d'], category: '3D', detect: (ctx) => !!ctx.auto, apply: () => ({ auto: true }) };
    const ui = {};
    const seen = [];

    try {
      globalRegistry.register(manualSkill);
      globalRegistry.register(autoSkill);
      const api = attachSkillsAPI(ui, { auto: true });
      const off = api.onChange(() => seen.push('change'));

      expect(api).toBe(ui.skills);
      expect(api.describe().skills.some(s => s.id === manualId)).toBe(true);
      expect(api.list({ workflow: '3d' }).some(s => s.id === manualId)).toBe(true);
      expect(api.suggest({ auto: true }).some(s => s.skill.id === autoId)).toBe(true);

      await api.apply(manualId);
      expect(api.describe().skills.find(s => s.id === manualId).applied).toBe(true);
      api.remove(manualId);

      await api.autoApply();
      expect(api.describe().skills.find(s => s.id === autoId).applied).toBe(true);

      off();
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      globalRegistry.remove(manualId);
      globalRegistry.remove(autoId);
      globalRegistry.unregister(manualId);
      globalRegistry.unregister(autoId);
    }
  });

  it('enablePersistence ignores corrupt saved usage', () => {
    localStorage.setItem('ghost-panel-bad-usage', '{bad json');
    const fresh = new SkillsRegistry();
    expect(() => fresh.enablePersistence('ghost-panel-bad-usage')).not.toThrow();
    expect(fresh.usage.size).toBe(0);
  });
});

describe('BUILTIN_SKILLS', () => {
  it('exposes a non-empty catalog with unique ids and the expected schema', () => {
    expect(Array.isArray(BUILTIN_SKILLS)).toBe(true);
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);

    const ids = new Set();
    for (const skill of BUILTIN_SKILLS) {
      expect(typeof skill.id).toBe('string');
      expect(skill.id.length).toBeGreaterThan(0);
      expect(ids.has(skill.id)).toBe(false);
      ids.add(skill.id);
      expect(typeof skill.name).toBe('string');
      expect(typeof skill.category).toBe('string');
      expect(Array.isArray(skill.workflows)).toBe(true);
      expect(typeof skill.detect).toBe('function');
    }
  });

  it('matches representative detect predicates', () => {
    const lighting = BUILTIN_SKILLS.find(s => s.id === '3d.lighting');
    const uniforms = BUILTIN_SKILLS.find(s => s.id === 'shader.uniforms');

    expect(lighting.detect({
      scene: {
        traverse(cb) {
          cb({ isLight: false });
          cb({ isLight: true });
        },
      },
    })).toBe(true);

    expect(uniforms.detect({
      scene: {
        traverse(cb) {
          cb({ material: { type: 'ShaderMaterial' } });
          cb({ material: [{ type: 'MeshBasicMaterial' }, { type: 'RawShaderMaterial' }] });
        },
      },
    })).toBe(true);
  });

  it('executes safe builtin ASCII folder builders', () => {
    const charset = BUILTIN_SKILLS.find(s => s.id === 'ascii.charset');
    const grid = BUILTIN_SKILLS.find(s => s.id === 'ascii.grid');
    const removeFolder = vi.fn();
    const folder = {
      addSelect: vi.fn(),
      addText: vi.fn(),
      addPairedNumbers: vi.fn(),
      addSlider: vi.fn(),
    };
    const ui = {
      addFolder: vi.fn(() => folder),
      panel: { removeFolder },
    };

    const charsetHandle = charset.apply(ui, {});
    const gridHandle = grid.apply(ui, {});

    expect(charsetHandle).toEqual({ folder });
    expect(gridHandle).toEqual({ folder });
    expect(ui.addFolder).toHaveBeenNthCalledWith(1, 'Charset');
    expect(ui.addFolder).toHaveBeenNthCalledWith(2, 'Grid');
    expect(folder.addSelect).toHaveBeenCalledWith('Preset', expect.objectContaining({ value: 'Standard' }));
    expect(folder.addText).toHaveBeenCalledWith('Custom', expect.objectContaining({ value: ' .:-=+*#%@' }));
    expect(folder.addPairedNumbers).toHaveBeenCalledTimes(1);
    expect(folder.addSlider).toHaveBeenCalledTimes(2);

    charset.teardown(ui);
    grid.teardown(ui);
    expect(removeFolder).toHaveBeenNthCalledWith(1, 'Charset');
    expect(removeFolder).toHaveBeenNthCalledWith(2, 'Grid');
  });

  it('executes safe builtin audio folder builders', () => {
    const master = BUILTIN_SKILLS.find(s => s.id === 'audio.master');
    const eq = BUILTIN_SKILLS.find(s => s.id === 'audio.eq');
    const removeFolder = vi.fn();
    const folder = {
      addDial: vi.fn(),
      addXYPad: vi.fn(),
    };
    const ui = {
      addFolder: vi.fn(() => folder),
      panel: { removeFolder },
    };

    expect(master.apply(ui, {})).toEqual({ folder });
    expect(eq.apply(ui, {})).toEqual({ folder });
    expect(ui.addFolder).toHaveBeenNthCalledWith(1, 'Master');
    expect(ui.addFolder).toHaveBeenNthCalledWith(2, 'EQ');
    expect(folder.addDial).toHaveBeenCalledTimes(5);
    expect(folder.addXYPad).toHaveBeenCalledWith('Position', expect.objectContaining({ value: { x: 0.5, y: 0.5 } }));

    master.teardown(ui);
    eq.teardown(ui);
    expect(removeFolder).toHaveBeenNthCalledWith(1, 'Master');
    expect(removeFolder).toHaveBeenNthCalledWith(2, 'EQ');
  });
});
