import { UndoStack } from '../undo-stack.js';

describe('UndoStack', () => {
  let nowSpy;
  let warnSpy;

  beforeEach(() => {
    nowSpy = vi.spyOn(performance, 'now');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    nowSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('pushes, undoes, and redoes commands, including empty-stack return values', () => {
    const stack = new UndoStack();
    const state = { value: 0 };

    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(false);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);

    nowSpy.mockReturnValue(10);
    stack.push({
      undo: () => { state.value = 0; },
      redo: () => { state.value = 1; },
    });

    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);

    state.value = 1;
    expect(stack.undo()).toBe(true);
    expect(state.value).toBe(0);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);

    expect(stack.redo()).toBe(true);
    expect(state.value).toBe(1);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it('ignores invalid commands and clears future history on push', () => {
    const stack = new UndoStack();

    stack.push(null);
    stack.push({ undo: () => {} });
    stack.push({ redo: () => {} });
    expect(stack.canUndo()).toBe(false);

    nowSpy.mockReturnValueOnce(1);
    stack.push({
      undo: () => {},
      redo: () => {},
    });
    expect(stack.canUndo()).toBe(true);

    expect(stack.undo()).toBe(true);
    expect(stack.canRedo()).toBe(true);

    nowSpy.mockReturnValueOnce(2);
    stack.push({
      undo: () => {},
      redo: () => {},
    });
    expect(stack.canRedo()).toBe(false);
  });

  it('coalesces matching commands inside the window and keeps the latest redo', () => {
    const stack = new UndoStack({ coalesceMs: 100 });
    const obj = { name: 'cube', value: 0 };
    const events = [];
    stack.on((s, reason) => events.push([s, reason]));

    nowSpy.mockReturnValueOnce(10).mockReturnValueOnce(40);
    stack.push(UndoStack.propEdit(obj, 'value', 0, 1));
    stack.push(UndoStack.propEdit(obj, 'value', 1, 2));

    expect(stack.canUndo()).toBe(true);
    expect(events.map(([, reason]) => reason)).toEqual(['push', 'push']);

    expect(stack.undo()).toBe(true);
    expect(obj.value).toBe(0);
    expect(stack.canRedo()).toBe(true);

    expect(stack.redo()).toBe(true);
    expect(obj.value).toBe(2);
    expect(stack.canUndo()).toBe(true);

    expect(stack.undo()).toBe(true);
    expect(stack.canUndo()).toBe(false);
  });

  it('treats different keys, no key, and expired edits as separate entries and enforces the limit', () => {
    const stack = new UndoStack({ limit: 2, coalesceMs: 0 });
    const obj = { name: 'mesh', a: 0, b: 0, c: 0, d: 0 };

    nowSpy.mockReturnValueOnce(1);
    stack.push(UndoStack.propEdit(obj, 'a', 0, 1));

    nowSpy.mockReturnValueOnce(2);
    stack.push(UndoStack.propEdit(obj, 'b', 0, 2));

    nowSpy.mockReturnValueOnce(3);
    stack.push({
      undo: () => { obj.c = 0; },
      redo: () => { obj.c = 3; },
    });

    expect(stack.canUndo()).toBe(true);
    expect(stack.undo()).toBe(true);
    expect(obj.c).toBe(0);
    expect(stack.undo()).toBe(true);
    expect(obj.b).toBe(0);
    expect(stack.undo()).toBe(false);
  });

  it('swallows undo/redo exceptions, warns, and still moves commands between stacks', () => {
    const stack = new UndoStack();
    const cmd = {
      undo: () => { throw new Error('boom undo'); },
      redo: () => { throw new Error('boom redo'); },
    };

    nowSpy.mockReturnValue(1);
    stack.push(cmd);

    expect(stack.undo()).toBe(true);
    expect(console.warn).toHaveBeenCalledWith('[undo] failed:', expect.any(Error));
    expect(stack.canRedo()).toBe(true);

    expect(stack.redo()).toBe(true);
    expect(console.warn).toHaveBeenCalledWith('[redo] failed:', expect.any(Error));
    expect(stack.canUndo()).toBe(true);
  });

  it('supports listeners, clear, and nestedPropEdit guards', () => {
    const stack = new UndoStack();
    const calls = [];
    const throwing = vi.fn(() => { throw new Error('listener'); });
    const listener = vi.fn((s, reason) => calls.push([s, reason]));
    const unsub = stack.on(listener);
    stack.on(throwing);

    nowSpy.mockReturnValueOnce(1);
    stack.push(UndoStack.nestedPropEdit({ name: 'obj', position: { x: 1 } }, 'position', 'x', 1, 2));
    expect(listener).toHaveBeenCalledWith(stack, 'push');
    expect(throwing).toHaveBeenCalled();

    const holder = { name: 'holder', position: null };
    const nested = UndoStack.nestedPropEdit(holder, 'position', 'x', 1, 2);
    nested.undo();
    nested.redo();
    expect(holder.position).toBeNull();

    unsub();
    stack.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(calls.map(([, reason]) => reason)).toEqual(['push']);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });
});
