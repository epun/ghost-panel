import { log } from './log.js';
/**
 * Workflow-agnostic undo / redo stack.
 *
 * The harness owns one UndoStack on `ui._undo`. Each workflow / surface
 * (mini toolbar, modal transform, outliner delete, graph editor) pushes
 * inverse-command pairs when it commits a user-visible mutation. Cmd+Z
 * (Ctrl+Z on non-Mac) pops the most recent command and runs `.undo()`;
 * Cmd+Shift+Z runs `.redo()`.
 *
 * A "command" is just `{ undo(): void, redo(): void, label?: string }`.
 * Helpers below build common shapes (property edits, list adds/removes).
 *
 *   ui._undo.push({
 *     label: 'edit circle.01.radius',
 *     undo: () => circle.radius = 40,
 *     redo: () => circle.radius = 90,
 *   });
 *
 * Coalescing: rapid edits to the same prop within `coalesceMs` collapse
 * into one entry — so dragging a slider doesn't bury the rest of history.
 */
export class UndoStack {
  constructor({ limit = 200, coalesceMs = 350 } = {}) {
    this.limit = limit;
    this.coalesceMs = coalesceMs;
    this._past = [];
    this._future = [];
    this._listeners = [];
  }

  /** Push a new command. Clears the redo stack and may coalesce with last entry. */
  push(cmd) {
    if (!cmd || typeof cmd.undo !== 'function' || typeof cmd.redo !== 'function') return;
    cmd._t = performance.now();
    const last = this._past[this._past.length - 1];
    // Coalesce: same coalesce-key + within window → fold into the previous
    // command (its `redo` becomes this one's, undo stays the original).
    if (last && cmd.coalesceKey && last.coalesceKey === cmd.coalesceKey
        && (cmd._t - last._t) <= this.coalesceMs) {
      last.redo = cmd.redo;
      last._t = cmd._t;
    } else {
      this._past.push(cmd);
      if (this._past.length > this.limit) this._past.shift();
    }
    this._future.length = 0;
    this._emit('push');
  }

  canUndo() { return this._past.length > 0; }
  canRedo() { return this._future.length > 0; }

  undo() {
    const cmd = this._past.pop();
    if (!cmd) return false;
    try { cmd.undo(); } catch (e) { log.debug('undo', 'failed:', e); }
    this._future.push(cmd);
    this._emit('undo');
    return true;
  }

  redo() {
    const cmd = this._future.pop();
    if (!cmd) return false;
    try { cmd.redo(); } catch (e) { log.debug('redo', 'failed:', e); }
    this._past.push(cmd);
    this._emit('redo');
    return true;
  }

  clear() { this._past.length = 0; this._future.length = 0; this._emit('clear'); }

  // Listeners receive `(stack, reason)` where reason is one of
  // 'push' | 'undo' | 'redo' | 'clear'. The reason lets subscribers react
  // differently to a time-travel event (undo/redo) versus a fresh edit —
  // e.g. the contextual inspector rebuilds its folders only on undo/redo so
  // stale widget values re-read live object state, while ignoring 'push'
  // (which fires mid-edit, when rebuilding would destroy the active control).
  on(cb) { this._listeners.push(cb); return () => { this._listeners = this._listeners.filter(f => f !== cb); }; }
  _emit(reason) { this._listeners.forEach(cb => { try { cb(this, reason); } catch (e) { log.debug('undo', 'listener failed:', e); } }); }

  /** Convenience: build a property-edit command for a flat numeric prop. */
  static propEdit(obj, prop, before, after, label) {
    return {
      label: label || `edit ${prop}`,
      coalesceKey: `prop:${prop}:${objKey(obj)}`,
      undo: () => { obj[prop] = before; },
      redo: () => { obj[prop] = after; },
    };
  }

  /** Convenience: build a nested property-edit (e.g. position.x). */
  static nestedPropEdit(obj, prop, axis, before, after, label) {
    return {
      label: label || `edit ${prop}.${axis}`,
      coalesceKey: `nested:${prop}.${axis}:${objKey(obj)}`,
      undo: () => { if (obj[prop]) obj[prop][axis] = before; },
      redo: () => { if (obj[prop]) obj[prop][axis] = after; },
    };
  }
}

// Stable-ish key for coalescing per-object edits. Uses obj.name when present
// so coalescing keeps working even after a redo replaces references.
function objKey(obj) {
  if (!obj) return 'null';
  if (obj.name) return `name:${obj.name}`;
  return 'obj';
}
