import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectManager } from '../object-manager.js';

describe('ObjectManager', () => {
  let om;

  beforeEach(() => {
    om = new ObjectManager();
  });

  it('register ignores falsy names, emits register only for new entries, and always emits change', () => {
    const register = vi.fn();
    const change = vi.fn();
    om.on('register', register);
    om.on('change', change);

    om.register('', { id: 1 });
    om.register('cube', { id: 1 });
    om.register('cube', { id: 2 });

    expect(om.getObject('cube')).toEqual({ id: 2 });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('cube', { id: 1 });
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('remove no-ops when absent, deselects active entries, and emits remove then change', () => {
    const events = [];
    const push = event => (...args) => events.push([event, ...args]);
    om.on('deselect', push('deselect'));
    om.on('remove', push('remove'));
    om.on('change', push('change'));

    om.register('cube', { name: 'cube' });
    om.select('cube');
    events.length = 0;

    om.remove('missing');
    om.remove('cube');

    expect(events).toEqual([
      ['deselect', 'cube'],
      ['change'],
      ['remove', 'cube', { name: 'cube' }],
      ['change'],
    ]);
    expect(om.activeName).toBeNull();
    expect(om.has('cube')).toBe(false);
  });

  it('renames with validation, mirrors object.name, and updates the active name', () => {
    const rename = vi.fn();
    const change = vi.fn();
    om.on('rename', rename);
    om.on('change', change);
    const object = { name: 'old', value: 1 };
    om.register('old', object);
    om.select('old');

    expect(om.rename('', 'new')).toBe(false);
    expect(om.rename('old', '')).toBe(false);
    expect(om.rename('old', 'old')).toBe(false);
    expect(om.rename('missing', 'new')).toBe(false);
    om.register('taken', {});
    expect(om.rename('old', 'taken')).toBe(false);

    expect(om.rename('old', 'new')).toBe(true);
    expect(om.getObject('new')).toBe(object);
    expect(om.getObject('old')).toBeNull();
    expect(om.activeName).toBe('new');
    expect(object.name).toBe('new');
    expect(rename).toHaveBeenCalledWith('old', 'new');
    expect(change).toHaveBeenCalled();
  });

  it('setAll replaces the registry, emits remove for dropped entries, and emits change', () => {
    const remove = vi.fn();
    const change = vi.fn();
    om.on('remove', remove);
    om.on('change', change);
    om.register('a', { id: 'a' });
    om.register('b', { id: 'b' });
    remove.mockClear();
    change.mockClear();

    om.setAll([
      ['b', { id: 'b2' }],
      ['c', { id: 'c' }],
    ]);

    expect(om.getNames().sort()).toEqual(['b', 'c']);
    expect(om.getObject('b')).toEqual({ id: 'b2' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('a', { id: 'a' });
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('getNames, getObject, has, getState, and applyState filter correctly', () => {
    om.register('thing', {
      name: 'thing',
      x: 1,
      y: '2',
      visible: true,
      nested: { nope: true },
      list: [1],
      fn() {},
      _secret: 4,
    });

    expect(om.getNames()).toEqual(['thing']);
    expect(om.getObject('thing')?.x).toBe(1);
    expect(om.has('thing')).toBe(true);
    expect(om.has('missing')).toBe(false);
    expect(om.getState('thing')).toEqual({ x: 1, y: '2', visible: true });

    const change = vi.fn();
    om.on('change', change);
    om.applyState('thing', {
      name: 'skip',
      x: 3,
      y: 4,
      visible: false,
      nested: {},
      list: [],
      fn: () => {},
      _secret: 10,
    });

    expect(om.getObject('thing')).toMatchObject({ x: 3, y: 4, visible: false, name: 'thing' });
    expect(change).toHaveBeenCalledTimes(1);
    om.applyState('missing', { x: 1 });
    om.applyState('thing', null);
    om.applyState('thing', 'bad');
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('select and deselect guard invalid inputs, emit events, and return through unsubscribe/off', () => {
    const select = vi.fn();
    const deselect = vi.fn();
    const change = vi.fn();
    const offSelect = om.on('select', select);
    om.on('deselect', deselect);
    om.on('change', change);
    om.register('cube', {});

    om.select('missing');
    expect(select).not.toHaveBeenCalled();

    om.select('cube');
    expect(select).toHaveBeenCalledWith('cube');
    expect(change).toHaveBeenCalledTimes(2);

    offSelect();
    om.select('cube');
    expect(select).toHaveBeenCalledTimes(1);

    om.deselect();
    expect(deselect).toHaveBeenCalledWith('cube');
    expect(change).toHaveBeenCalledTimes(4);

    om.deselect();
    expect(deselect).toHaveBeenCalledTimes(1);
  });

  it('emit swallows listener errors and dispose resets state', () => {
    const good = vi.fn();
    const bad = vi.fn(() => { throw new Error('boom'); });
    om.on('change', bad);
    om.on('change', good);

    expect(() => om.emit('change', 'x')).not.toThrow();
    expect(good).toHaveBeenCalledWith('x');

    om.register('cube', {});
    om.select('cube');
    om.dispose();

    expect(om.getNames()).toEqual([]);
    expect(om.activeName).toBeNull();
    expect(om._listeners).toEqual({ change: [], select: [], deselect: [], remove: [], register: [], rename: [] });
  });
});
