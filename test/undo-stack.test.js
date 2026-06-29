import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { UndoStack } from '../undo-stack.js';

describe('UndoStack', () => {
  let nowSpy;

  beforeEach(() => {
    nowSpy = vi.spyOn(performance, 'now');
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('rejects invalid commands', () => {
    const stack = new UndoStack();
    const emitted = vi.fn();
    stack.on(emitted);

    stack.push(null);
    stack.push({});
    stack.push({ undo: vi.fn() });
    stack.push({ redo: vi.fn() });

    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(emitted).not.toHaveBeenCalled();
  });

  it('push clears redo history and emits push', () => {
    const stack = new UndoStack();
    const reasons = [];
    stack.on((s, reason) => reasons.push(reason));

    const first = { undo: vi.fn(), redo: vi.fn() };
    const second = { undo: vi.fn(), redo: vi.fn() };
    nowSpy.mockReturnValueOnce(1).mockReturnValueOnce(2);

    stack.push(first);
    stack.undo();
    expect(stack.canRedo()).toBe(true);

    stack.push(second);

    expect(stack.canRedo()).toBe(false);
    expect(reasons).toEqual(['push', 'undo', 'push']);
  });

  it('coalesces commands with the same key within the window', () => {
    const stack = new UndoStack({ coalesceMs: 200 });
    const first = { undo: vi.fn(), redo: vi.fn(), coalesceKey: 'same' };
    const second = { undo: vi.fn(), redo: vi.fn(), coalesceKey: 'same' };

    nowSpy.mockReturnValueOnce(10).mockReturnValueOnce(100);

    stack.push(first);
    stack.push(second);

    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
    expect(stack._past).toHaveLength(1);
    expect(stack._past[0]).toBe(first);
    expect(stack._past[0].redo).toBe(second.redo);
  });

  it('does not coalesce when the key differs or the window elapsed', () => {
    const stack = new UndoStack({ coalesceMs: 50 });
    const first = { undo: vi.fn(), redo: vi.fn(), coalesceKey: 'one' };
    const differentKey = { undo: vi.fn(), redo: vi.fn(), coalesceKey: 'two' };
    const late = { undo: vi.fn(), redo: vi.fn(), coalesceKey: 'one' };

    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(10).mockReturnValueOnce(100);

    stack.push(first);
    stack.push(differentKey);
    stack.push(late);

    expect(stack._past).toHaveLength(3);
    expect(stack._past[0]).toBe(first);
    expect(stack._past[1]).toBe(differentKey);
    expect(stack._past[2]).toBe(late);
  });

  it('evicts the oldest command when the limit is exceeded', () => {
    const stack = new UndoStack({ limit: 2 });
    nowSpy.mockReturnValue(1);

    const cmds = [0, 1, 2].map(i => ({ undo: vi.fn(), redo: vi.fn(), label: `c${i}` }));
    cmds.forEach(cmd => stack.push(cmd));

    expect(stack._past).toHaveLength(2);
    expect(stack._past.map(c => c.label)).toEqual(['c1', 'c2']);
  });

  it('undo and redo run commands, move between stacks, and respect boundaries', () => {
    const stack = new UndoStack();
    const cmd = { undo: vi.fn(), redo: vi.fn() };
    nowSpy.mockReturnValue(1);

    stack.push(cmd);

    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
    expect(stack.undo()).toBe(true);
    expect(cmd.undo).toHaveBeenCalledTimes(1);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);
    expect(stack.redo()).toBe(true);
    expect(cmd.redo).toHaveBeenCalledTimes(1);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
    expect(stack.undo()).toBe(true);
    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(true);
    expect(stack.redo()).toBe(false);
  });

  it('swallows thrown undo and redo errors while preserving history moves', () => {
    const stack = new UndoStack();
    const cmd = { undo: vi.fn(() => { throw new Error('undo fail'); }), redo: vi.fn(() => { throw new Error('redo fail'); }) };
    nowSpy.mockReturnValue(1);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    stack.push(cmd);

    expect(stack.undo()).toBe(true);
    expect(stack.canRedo()).toBe(true);
    expect(stack.redo()).toBe(true);
    expect(stack.canUndo()).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('clear empties both stacks and emits clear', () => {
    const stack = new UndoStack();
    const reasons = [];
    stack.on((s, reason) => reasons.push(reason));
    nowSpy.mockReturnValue(1);

    stack.push({ undo: vi.fn(), redo: vi.fn() });
    stack.undo();
    stack.clear();

    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(reasons).toEqual(['push', 'undo', 'clear']);
  });

  it('supports unsubscribe and swallows listener exceptions', () => {
    const stack = new UndoStack();
    const hits = [];
    const listener = vi.fn((s, reason) => hits.push(reason));
    const bad = vi.fn(() => { throw new Error('listener'); });
    const unsubscribe = stack.on(listener);
    stack.on(bad);
    nowSpy.mockReturnValue(1);

    stack.push({ undo: vi.fn(), redo: vi.fn() });
    unsubscribe();
    stack.clear();

    expect(hits).toEqual(['push']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it('builds propEdit and nestedPropEdit commands with objKey coalescing', () => {
    const a = { name: 'Cube', value: 1, position: { x: 2 } };
    const b = { name: 'Cube', value: 9 };
    const flat = UndoStack.propEdit(a, 'value', 1, 2);
    const sameNamed = UndoStack.propEdit(b, 'value', 9, 10);
    const nested = UndoStack.nestedPropEdit(a, 'position', 'x', 2, 3);
    const missing = UndoStack.nestedPropEdit({ name: 'Sphere' }, 'position', 'x', 0, 1);

    expect(flat.label).toBe('edit value');
    expect(flat.coalesceKey).toBe('prop:value:name:Cube');
    expect(sameNamed.coalesceKey).toBe(flat.coalesceKey);

    flat.undo();
    expect(a.value).toBe(1);
    flat.redo();
    expect(a.value).toBe(2);

    nested.undo();
    expect(a.position.x).toBe(2);
    nested.redo();
    expect(a.position.x).toBe(3);

    expect(() => missing.undo()).not.toThrow();
    expect(() => missing.redo()).not.toThrow();
  });
});
