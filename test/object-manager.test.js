import { ObjectManager } from '../object-manager.js';

describe('ObjectManager', () => {
  let manager;

  beforeEach(() => {
    manager = new ObjectManager();
  });

  it('registers objects, re-registers without duplicate register events, and ignores falsy names', () => {
    const events = [];
    manager.on('register', (name, object) => events.push(['register', name, object]));
    manager.on('change', () => events.push(['change']));

    const object = { name: 'Cube' };
    manager.register('Cube', object);
    manager.register('Cube', { name: 'Cube', updated: true });
    manager.register('', { name: 'ignored' });

    expect(manager.getNames()).toEqual(['Cube']);
    expect(manager.getObject('Cube')).toEqual({ name: 'Cube', updated: true });
    expect(manager.has('Cube')).toBe(true);
    expect(events.map(([type]) => type)).toEqual(['register', 'change', 'change']);
  });

  it('removes objects, deselects active entries, and no-ops for unknown names', () => {
    const events = [];
    manager.on('deselect', name => events.push(['deselect', name]));
    manager.on('remove', (name, object) => events.push(['remove', name, object]));
    manager.on('change', () => events.push(['change']));

    const object = { name: 'Cube' };
    manager.register('Cube', object);
    events.length = 0;
    manager.select('Cube');
    events.length = 0;

    manager.remove('Cube');
    manager.remove('missing');

    expect(manager.activeName).toBeNull();
    expect(manager.getNames()).toEqual([]);
    expect(events).toEqual([
      ['deselect', 'Cube'],
      ['change'],
      ['remove', 'Cube', object],
      ['change'],
    ]);
  });

  it('renames entries, mirrors object.name, and rejects invalid or colliding names', () => {
    const events = [];
    manager.on('rename', (oldName, newName) => events.push(['rename', oldName, newName]));
    manager.on('change', () => events.push(['change']));

    const object = { name: 'Old' };
    manager.register('Old', object);
    manager.select('Old');
    events.length = 0;

    expect(manager.rename('', 'New')).toBe(false);
    expect(manager.rename('Old', 'Old')).toBe(false);
    expect(manager.rename('Missing', 'New')).toBe(false);
    manager.register('Other', {});
    events.length = 0;
    expect(manager.rename('Old', 'Other')).toBe(false);

    expect(manager.rename('Old', 'New')).toBe(true);
    expect(manager.getObject('New')).toBe(object);
    expect(manager.getObject('Old')).toBeNull();
    expect(manager.activeName).toBe('New');
    expect(object.name).toBe('New');
    expect(events).toEqual([
      ['rename', 'Old', 'New'],
      ['change'],
    ]);
  });

  it('serializes and reapplies only scalar state', () => {
    const object = {
      name: 'Thing',
      x: 1,
      label: 'hello',
      visible: true,
      nested: { a: 1 },
      list: [1, 2],
      fn() {},
      _private: 10,
    };
    manager.register('Thing', object);

    expect(manager.getState('Thing')).toEqual({
      x: 1,
      label: 'hello',
      visible: true,
    });

    const change = vi.fn();
    manager.on('change', change);
    manager.applyState('Thing', {
      x: 4,
      label: 'world',
      visible: false,
      name: 'skip',
      _hidden: 99,
      nested: { nope: true },
      list: [3],
      fn: () => {},
    });

    expect(object).toMatchObject({
      x: 4,
      label: 'world',
      visible: false,
      name: 'Thing',
    });
    expect(object.nested).toEqual({ a: 1 });
    expect(object.list).toEqual([1, 2]);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('selects and deselects with change events and ignores unknown names', () => {
    const events = [];
    manager.on('select', name => events.push(['select', name]));
    manager.on('deselect', name => events.push(['deselect', name]));
    manager.on('change', () => events.push(['change']));

    manager.select('missing');
    expect(events).toEqual([]);

    manager.register('Cube', {});
    events.length = 0;
    manager.select('Cube');
    manager.deselect();
    manager.deselect();

    expect(manager.activeName).toBeNull();
    expect(events).toEqual([
      ['select', 'Cube'],
      ['change'],
      ['deselect', 'Cube'],
      ['change'],
    ]);
  });

  it('replaces the full registry, emits remove for dropped entries, unsubscribes, swallows listener errors, and disposes', () => {
    const events = [];
    const listener = vi.fn(() => { throw new Error('listener failed'); });
    const unsub = manager.on('change', listener);
    manager.on('remove', name => events.push(['remove', name]));
    manager.on('change', () => events.push(['change']));

    manager.register('A', { id: 'A' });
    manager.register('B', { id: 'B' });
    events.length = 0;

    manager.setAll([
      ['B', { id: 'B', updated: true }],
      ['C', { id: 'C' }],
    ]);

    expect(events).toEqual([
      ['remove', 'A'],
      ['change'],
    ]);

    unsub();
    events.length = 0;
    manager.emit('change');
    expect(listener).toHaveBeenCalledTimes(3);

    manager.dispose();
    expect(manager.getNames()).toEqual([]);
    expect(manager.activeName).toBeNull();
    expect(manager._listeners).toEqual({
      change: [],
      select: [],
      deselect: [],
      remove: [],
      register: [],
      rename: [],
    });
  });
});
