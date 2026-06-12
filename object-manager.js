/**
 * Generic object manager — the persistent, workflow-agnostic backbone for
 * the Outliner, the bind picker, the Add menu, exports, etc.
 *
 * SceneObjectManager (Three.js) is the heavyweight cousin that adds gizmos
 * and transform proxies. This file is the lightweight version that any
 * host (2D canvas, audio graph, ASCII grid) can populate. Both implement
 * the same duck-typed surface so the Outliner works against either.
 *
 * Required interface (mirrored by SceneObjectManager):
 *   getNames(): string[]
 *   getObject(name): object | null
 *   activeName: string | null
 *   select(name): void
 *   deselect(): void
 *   remove(name): void
 *   on(event, cb): unsubscribe
 *   emit(event, ...args): void
 *
 * Optional duck-typed properties on the registered object:
 *   object.visible: boolean   (Outliner show/hide toggle reads this)
 */
export class ObjectManager {
  constructor() {
    this.objects = {};                  // name -> { object }
    this.activeName = null;
    this._listeners = { change: [], select: [], deselect: [], remove: [], register: [], rename: [] };
  }

  /** Register a host object under a name. */
  register(name, object) {
    if (!name) return;
    const isNew = !this.objects[name];
    this.objects[name] = { object };
    // 'register' lets downstream views (canvas render list, outliner row,
    // contextual panel) react to *additions* without diffing on every change.
    if (isNew) this.emit('register', name, object);
    this.emit('change');
  }

  /** Remove a registered object. */
  remove(name) {
    const entry = this.objects[name];
    if (!entry) return;
    if (this.activeName === name) this.deselect();
    delete this.objects[name];
    // 'remove' fires before 'change' so downstream views (graph editor,
    // export menu, etc.) can prune any per-object state using the actual
    // reference, then 'change' triggers generic re-render.
    this.emit('remove', name, entry.object);
    this.emit('change');
  }

  /** Rename a registered entry. Returns true on success. */
  rename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return false;
    if (!this.objects[oldName] || this.objects[newName]) return false;
    this.objects[newName] = this.objects[oldName];
    delete this.objects[oldName];
    if (this.activeName === oldName) this.activeName = newName;
    // Mirror the property onto the object so adapters/lights/etc. report
    // the new name when introspected.
    const entry = this.objects[newName];
    if (entry?.object && 'name' in entry.object) entry.object.name = newName;
    this.emit('rename', oldName, newName);
    this.emit('change');
    return true;
  }

  /** Replace the entire registry (useful for hosts whose model changes en masse). */
  setAll(entries) {
    const prev = this.objects;
    this.objects = {};
    for (const [name, object] of entries) this.objects[name] = { object };
    // Emit 'remove' for entries that fell out, so subscribers can clean up.
    for (const [name, e] of Object.entries(prev)) {
      if (!this.objects[name]) this.emit('remove', name, e.object);
    }
    this.emit('change');
  }

  getNames() { return Object.keys(this.objects); }
  getObject(name) { return this.objects[name]?.object ?? null; }
  has(name) { return !!this.objects[name]; }

  select(name) {
    if (!this.objects[name]) return;
    this.activeName = name;
    this.emit('select', name);
    this.emit('change');
  }
  deselect() {
    if (!this.activeName) return;
    const prev = this.activeName;
    this.activeName = null;
    this.emit('deselect', prev);
    this.emit('change');
  }

  on(event, cb) {
    (this._listeners[event] ||= []).push(cb);
    return () => {
      this._listeners[event] = (this._listeners[event] || []).filter(f => f !== cb);
    };
  }
  emit(event, ...args) {
    (this._listeners[event] || []).forEach(cb => { try { cb(...args); } catch {} });
  }

  dispose() {
    this.objects = {};
    this.activeName = null;
    this._listeners = { change: [], select: [], deselect: [], remove: [], register: [], rename: [] };
  }
}
