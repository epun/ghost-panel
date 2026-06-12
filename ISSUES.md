# Ghost Panel — Integration Issue Log

Bugs, feature gaps, and integration friction surfaced while embedding Ghost Panel
in a host Three.js project. Each entry notes the symptom as reported, the root
cause found, and the workaround applied in the HOST project — i.e., what the
library could absorb so the next host doesn't have to.

---

## 1. Gizmo

### 1.1 Built-in gizmo can't disable the host's OrbitControls
- **Symptom:** "The gizmo is not working in general when I try to move things."
  Dragging the built-in TransformControls also orbited the camera.
- **Root cause:** `SceneObjectManager`'s `dragging-changed` handler only disables
  `this.orbitControls` — which is only set when the host passes `controls` into
  `createGhostPanel`. A host that intentionally withholds `controls` (so Ghost
  Panel doesn't override the establishing-shot camera/target) leaves the built-in
  gizmo fighting the camera, making it effectively unusable.
- **Host workaround:** layered a separate `TransformControls` instance that
  disables OrbitControls itself; suppressed the library gizmo per-selection.
- **Suggested fix:** accept an `onDraggingChanged` callback (or emit an event) so
  hosts can pause their own camera controls without surrendering the camera to
  Ghost Panel. Also: a public `gizmo: false` option — suppressing it currently
  requires the `userData.__duiIgnore` opt-out or reaching into
  `objectManager.gizmo.detach()` + `getHelper().visible = false`.

### 1.2 Selection-pivot reparenting silently corrupts the JSON export
- **Symptom:** "The scale, rotation, and location of a moved object aren't saving
  in the JSON file." Export contained pivot-local coordinates.
- **Root cause:** `getState(name)` serializes the object's **local**
  position/rotation/scale. A host multi-select rig that reparents the selection
  under a pivot group means any export taken while an object is selected captures
  pivot-relative values. Nothing warns about this.
- **Host workaround:** single selections now attach the gizmo directly (no
  reparenting); the pivot rig is multi-select only.
- **Suggested fix:** `getState` should serialize **world** transforms (or both),
  or at minimum document that registered objects must stay under their original
  parent for exports to be meaningful.

### 1.3 Two coexisting gizmos are easy to end up with, hard to coordinate
- **Symptom:** picking one child mesh of a registered group drove the *library*
  gizmo on that one mesh (only that mesh moved/scaled — its siblings left behind)
  while the host's gizmo handled everything else.
- **Root cause:** the library auto-attaches its gizmo to any selected registered
  object unless it's `__duiIgnore`/camera/ambient. There's no routing hook for
  "this object should be handled by the host's transform rig."
- **Host workaround:** selection 'change' listener intercepts movable objects,
  deselects, re-selects a pseudo-object ('Selection'), and suppresses the library
  gizmo — with `suppressing` re-entrancy flags and a microtask dedupe because
  `select()` re-fires 'change' synchronously for the same object.
- **Suggested fix:** a `beforeGizmoAttach(obj) => boolean` hook, and don't emit
  duplicate synchronous 'change' events for the same selection.

---

## 2. Outliner: hierarchy, embedded modules, scan noise

### 2.1 No public API for parent/child rows
- **Symptom:** wanted "the ability to expand a parent so that you can see all the
  children within it, and click a child to edit it."
- **Root cause:** the outliner nests by `entry.parentObj`, which is only set
  internally by `autoRegisterScene`. `register(name, obj)` has no `parent`
  option, so module code must reach into internals:
  `ui.objectManager.objects[name].parentObj = root`.
- **Suggested fix:** `register(name, obj, { parent })`, or infer `parentObj` from
  the scene graph when the parent is also registered.

### 2.2 All-or-nothing `__duiIgnore` on groups: outliner noise vs. export presence
- **Symptom:** an embedded module's group transform was missing from the JSON
  export entirely.
- **Root cause:** the embedded group's root was tagged `__duiIgnore` to stop the
  auto-scan flooding the outliner with ~50 internal meshes (sub-parts). But
  ignored ⇒ never registered ⇒ never exported. There's no "register the group,
  hide its internals" mode.
- **Host workaround:** registered the root, then individually tagged every
  internal mesh `__duiIgnore` at creation time.
- **Suggested fix:** a `__duiCollapsed` / `registerGroup(name, obj, { children:
  'none' | 'named' })` concept: group registered + exported, descendants opted
  out by default unless explicitly registered.

### 2.3 Auto-scan double-registers the same nodes under junk names
- **Symptom:** exports contain `Object`, `Object.02` … and `Object3D` …
  `Object3D.07` with transforms identical to intentionally-registered entries.
  Pure noise, and confusing when diffing exports.
- **Root cause:** unnamed nodes get auto-names from their type; nodes reachable
  both as registered entries and as scan candidates can surface twice.
- **Suggested fix:** skip auto-registering nodes whose object is already
  registered under another name; require opt-in for unnamed-node registration.

---

## 3. Right-hand panel: property bloat & selection gating

### 3.1 No built-in "show folder only for this object's selection"
- **Symptom:** "The right-hand properties panel is too bloated all the time. Only
  show relevant properties for objects selected in the scene."
- **What exists:** `addFolder(name, { showWhen })` works and is re-checked every
  `ui.update()` tick and on selection change — this was the right primitive.
- **Friction:** every host/module must hand-roll the predicate (resolve
  activeName → object → walk ancestors), and embedded modules need the host to
  thread a predicate in (`folderShowWhen` option). Before discovering `showWhen`,
  the host had manually toggled `folder.element.style.display` from 'change'
  listeners.
- **Suggested fix:** sugar like `addFolder(name, { forObject: nameOrObj })` that
  shows the folder only while that object (or a descendant) is the active
  selection — embedded modules could then self-gate without host plumbing.

### 3.2 Embedded-module folders import as always-on clutter
- **Symptom:** folders contributed by embedded modules (several folders from one
  module, several from another) were all permanently visible — "showing
  properties imported from other modules" that should have been scoped.
- **Host workaround:** consolidated one module's several `X · *` folders into a
  single folder; gated every module folder behind selection predicates.
- **Suggested fix:** same as 3.1, plus a convention for module-contributed folder
  *groups* (one collapsible namespace per embedded module).

---

## 4. JSON export / import inconsistencies

### 4.1 Panel control values go stale (panels vs. objects disagree)
- **Symptom:** export shows `Widget · Placement → Pos X: 0, Scale: 0.2` while
  `objects.Widget` (correctly) shows the gizmo-moved transform
  `(1.24, 0.267, -2.15), 0.43`. Same export, two answers.
- **Root cause:** `toJSON()` reads each control's `getValue()`, which only
  reflects values set *through the control*. Moving the object with the gizmo
  (or any external code) never updates the slider, so the panels section
  snapshots stale UI state.
- **Suggested fix:** controls need a `bind`/`refresh` path (read-back function
  evaluated at export time), or `toJSON` should prefer live object state for
  transform-like controls.

### 4.2 Contextual folders leak into exports nondeterministically
- **Symptom:** "JSON missing different properties" between exports: one export
  has a `Camera Settings` panel, another has `Material`, another has `Spot` —
  depending on what happened to be selected when the user hit export.
- **Root cause:** `toJSON` snapshots every folder currently in the panel,
  including selection-contextual ones (Material inspector, Camera Settings,
  light folders). Exports aren't stable across sessions, which breaks diffing.
- **Suggested fix:** mark contextual/transient folders (`transient: true`
  already exists on folders) and exclude them from `toJSON`, or namespace them
  separately.

### 4.3 Pseudo-objects and empty folders exported as noise
- `Selection` (the host's gizmo pivot) exports with whatever transform it last
  had; empty folders export as `"Move selection": {}`, `"Graph Editor": {}`.
  Suggest skipping empty folders and providing an `exclude` flag for registered
  pseudo-objects.

### 4.4 No float hygiene
- Exports contain `5.753463817835024e-17`, `2.392511977739448e-38`,
  `0.12000000000000001`, `0.8599192186924915` etc. A small `toPrecision(7)`
  pass would make exports diffable and hand-editable.

### 4.5 Per-face drift on "linked" objects
- Two faces of the same two-sided card (front / back copy) exported at slightly
  different scales (0.8112 vs 0.7979) after separate gizmo drags — there's no
  way to link objects so they edit together. Host had to normalize by hand.
  (Related: recurring accidental light nudges — `x 0.6→1.035`,
  `y 2.2→2.273→2.542`, `scale→0.997` across consecutive exports with no
  intentional lighting edits. Easy to bump a selected light's gizmo without
  noticing; an undo-history or "locked" flag per object would help.)

---

## 5. Material inspector

### 5.1 Texture upload mutates shared materials
- **Symptom:** uploading a texture through the Material inspector onto one GLB
  mesh restyled every mesh sharing that material.
- **Host workaround:** cloned the material for the target mesh up front so
  inspector edits stay scoped.
- **Suggested fix:** offer "clone material on first edit" (copy-on-write) in the
  inspector, or at least a warning badge when the material has multiple users.

---

## 6. Misc

- **Host debug globals vs. React StrictMode:** double mounting creates two
  instances; debug globals end up owned by whichever instance resolved last
  (sometimes the disposed one). Bit us repeatedly during verification (a host
  debug handle pointing at a disposed scene while the live one rendered). Hosts
  embedding in React should be warned, and library-owned globals (if any) should
  self-invalidate on dispose — a host `dispose()` guard
  (`if (window.handle.__root === root) delete window.handle`) is the right
  pattern.
- **toJSON has no schema/version field.** Round-tripping exports across code
  changes (controls renamed, folders merged) silently drops values. A
  `version`/`schema` field plus unknown-key reporting on `fromJSON` would surface
  this.
