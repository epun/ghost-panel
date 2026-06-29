import { BUILTIN_SKILLS, SkillsRegistry } from '../skills.js';

describe('SkillsRegistry', () => {
  let registry;
  let ui;

  beforeEach(() => {
    localStorage.clear();
    registry = new SkillsRegistry();
    ui = {
      panel: { removeFolder: vi.fn() },
      addFolder: vi.fn(() => ({})),
    };
  });

  it('registers, overwrites by id, and emits change', () => {
    const changes = vi.fn();
    registry.on('change', changes);

    expect(() => registry.register({ name: 'missing id' })).toThrow('Skill must have an id');
    expect(registry.register({ id: 'skill.one', name: 'One' })).toMatchObject({ id: 'skill.one' });
    expect(registry.register({ id: 'skill.one', name: 'Updated' })).toMatchObject({ name: 'Updated' });
    expect(registry.get('skill.one')).toMatchObject({ name: 'Updated' });
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('unregisters, tears down applied skills, and emits change', async () => {
    const teardown = vi.fn();
    const apply = vi.fn(() => ({ token: 1 }));
    registry.register({ id: 'skill.one', name: 'One', apply, teardown });

    const changes = vi.fn();
    registry.on('change', changes);

    await registry.apply(ui, 'skill.one', { scene: true });
    registry.unregister('skill.one');

    expect(apply).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledWith(ui, { token: 1 });
    expect(registry.get('skill.one')).toBeUndefined();
    expect(registry.isApplied('skill.one')).toBe(false);
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('updates existing skills and reapplies mounted ones', async () => {
    const teardown = vi.fn();
    const apply = vi.fn(() => ({ token: 'old' }));
    registry.register({ id: 'skill.one', name: 'One', description: 'old', apply, teardown, properties: [{ id: 'a' }] });
    await registry.apply(ui, 'skill.one', { foo: 1 });

    registry.update('skill.one', { description: 'new', category: 'Updated' });
    await Promise.resolve();

    expect(registry.get('skill.one')).toMatchObject({ description: 'new', category: 'Updated' });
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(registry.isApplied('skill.one')).toBe(true);
    expect(registry.update('missing', { name: 'nope' })).toBeNull();
  });

  it('filters list results, exposes getters, and describe includes deduped workflows/categories', async () => {
    registry.register({ id: 'a', name: 'A', category: 'Cat1', workflows: ['w1', 'w2'], apply: () => ({}) });
    registry.register({ id: 'b', name: 'B', category: 'Cat2', workflows: ['w2'], apply: () => ({}) });
    registry.register({ id: 'c', name: 'C', category: 'Cat1', workflows: ['w3'], apply: () => ({}) });

    await registry.apply(ui, 'a', {});

    expect(registry.list({ workflow: 'w2' }).map(s => s.id).sort()).toEqual(['a', 'b']);
    expect(registry.list({ category: 'Cat1' }).map(s => s.id).sort()).toEqual(['a', 'c']);
    expect(registry.list({ applied: true }).map(s => s.id)).toEqual(['a']);
    expect(registry.get('b')).toMatchObject({ name: 'B' });
    expect(registry.isApplied('a')).toBe(true);

    const described = registry.describe({ includeProperties: false });
    expect(described.skills.find(s => s.id === 'a')).toMatchObject({
      applied: true,
      uses: 1,
      properties: undefined,
    });
    expect(described.categories.sort()).toEqual(['Cat1', 'Cat2']);
    expect(described.workflows.sort()).toEqual(['w1', 'w2', 'w3']);
  });

  it('applies skills once, stores handles, marks usage, and returns null for missing apply hooks', async () => {
    const apply = vi.fn(async () => ({ handle: 1 }));
    registry.register({ id: 'async.skill', name: 'Async', apply });
    registry.register({ id: 'no.apply', name: 'Missing' });

    const handle = await registry.apply(ui, 'async.skill', { scene: true });
    expect(handle).toEqual({ handle: 1 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(registry.isApplied('async.skill')).toBe(true);
    expect(registry.usage.get('async.skill')).toMatchObject({ uses: 1 });

    const again = await registry.apply(ui, 'async.skill', { scene: false });
    expect(again).toBe(handle);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(await registry.apply(ui, 'missing', {})).toBeNull();
    expect(await registry.apply(ui, 'no.apply', {})).toBeNull();
  });

  it('removes applied skills, tears down handles, and no-ops when not applied', async () => {
    const teardown = vi.fn();
    const apply = vi.fn(() => ({ handle: 2 }));
    registry.register({ id: 'skill.one', name: 'One', apply, teardown });

    registry.remove('skill.one');
    expect(teardown).not.toHaveBeenCalled();

    await registry.apply(ui, 'skill.one', {});
    registry.remove('skill.one');

    expect(teardown).toHaveBeenCalledWith(ui, { handle: 2 });
    expect(registry.isApplied('skill.one')).toBe(false);
    expect(registry.appliedHandles.has('skill.one')).toBe(false);
  });

  it('auto-applies detected skills, respects strict mode, and returns newly applied ids', async () => {
    const applyA = vi.fn(() => ({ id: 'a' }));
    const applyB = vi.fn(() => ({ id: 'b' }));
    const teardownB = vi.fn();
    registry.register({ id: 'a', name: 'A', detect: () => true, apply: applyA });
    registry.register({ id: 'b', name: 'B', detect: () => false, apply: applyB, teardown: teardownB });
    registry.register({ id: 'c', name: 'C', detect: () => false, apply: vi.fn(() => ({ id: 'c' })), teardown: vi.fn() });

    await registry.apply(ui, 'b', {});

    const applied = await registry.autoApply(ui, {}, { strict: true });
    expect(applied).toEqual(['a']);
    expect(applyA).toHaveBeenCalledTimes(1);
    expect(applyB).toHaveBeenCalledTimes(1);
    expect(teardownB).toHaveBeenCalledWith(ui, { id: 'b' });
    expect(registry.isApplied('b')).toBe(false);
  });

  it('ranks suggestions by detection and usage, skips applied skills, emits through on/off, and persists usage', () => {
    registry.register({ id: 'detected', name: 'Detected', detect: () => true, apply: () => ({}) });
    registry.register({ id: 'used', name: 'Used', detect: () => false, apply: () => ({}) });
    registry.register({ id: 'applied', name: 'Applied', detect: () => true, apply: () => ({}) });
    registry.appliedHandles.set('applied', {});
    registry.usage.set('used', { uses: 4, lastUsed: 123 });
    registry.usage.set('detected', { uses: 1, lastUsed: 456 });

    const suggestions = registry.suggest({}, { max: 2 });
    expect(suggestions.map(s => s.skill.id)).toEqual(['detected', 'used']);
    expect(suggestions[0]).toMatchObject({ score: 105, reason: 'detected' });
    expect(suggestions[1]).toMatchObject({ score: 20, reason: 'frequently used' });

    const cb = vi.fn();
    const off = registry.on('change', cb);
    registry._emit('change');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    registry._emit('change');
    expect(cb).toHaveBeenCalledTimes(1);

    localStorage.setItem('skill-usage', JSON.stringify({ persisted: { uses: 7, lastUsed: 1 } }));
    registry.enablePersistence('skill-usage');
    expect(registry.usage.get('persisted')).toEqual({ uses: 7, lastUsed: 1 });
    registry.register({ id: 'persisted-skill', name: 'Persisted', apply: () => ({}) });
    registry.usage.set('persisted-skill', { uses: 2, lastUsed: 9 });
    registry._emit('change');
    expect(JSON.parse(localStorage.getItem('skill-usage'))).toMatchObject({
      persisted: { uses: 7, lastUsed: 1 },
      'persisted-skill': { uses: 2, lastUsed: 9 },
    });
  });
});

describe('BUILTIN_SKILLS', () => {
  it('exposes a non-empty builtin catalog', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);
    expect(BUILTIN_SKILLS.some(skill => skill.id === '3d.lighting' || skill.id === '2d.brush')).toBe(true);
  });
});
