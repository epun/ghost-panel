# Ghost Panel — AI agent surface

This document tells an AI agent (LLM, automation script, MCP server) how to
discover and modify the Ghost Panel tool's capabilities at runtime. It's
intentionally short and machine-targeted.

## The mental model

A **skill** is a self-contained unit of UI + behavior — e.g. *Material
Inspector*, *Brush Tool*, *F-Curve Graph Editor*, *EQ*. Skills belong to
one or more **workflows** (`3d`, `2d`, `shader`, `animation`, `ascii`,
`audio`). Workflows are bundles of skills that auto-detect from the project.

Skills are **data**, not imperative code. Each one declares its
`properties[]` schema, a `detect(ctx)` predicate, and an `apply(ui, ctx)`
function that mounts its UI.

## Reading the catalog

```js
const catalog = ui.skills.describe();
// {
//   skills: [
//     { id: '3d.lighting', name: 'Lighting', category: '3D',
//       workflows: ['3d'], properties: [...], applied: true, uses: 4 },
//     ...
//   ],
//   categories: ['3D', '2D', 'Shader', 'Animation', 'Audio', 'ASCII'],
//   workflows:  ['3d', '2d', 'shader', 'animation', 'audio', 'ascii'],
// }
```

The schema is stable and self-describing. Use it to decide:
- Which capabilities are available
- Which properties each one exposes (with types + ranges)
- What's already active for the current project
- How often the user reaches for each skill (`uses`)

## Suggesting tools to the user

```js
const suggestions = ui.skills.suggest();
// → [ { skill: { id, name, ... }, score: 105, reason: 'detected' }, ... ]
```

The default suggestion ranking combines:
1. `detect(ctx)` matches against the current project (+100)
2. Historical user-applied count (+5 per use)

You can pass extra context: `ui.skills.suggest({ recentEdits: [...] })`.

## Registering a NEW skill

```js
ui.skills.register({
  id: '3d.dust-particles',
  name: 'Dust Particles',
  category: '3D',
  workflows: ['3d'],
  description: 'Atmospheric floating-dust particle system.',
  properties: [
    { id: 'count',   type: 'number', min: 100, max: 10000 },
    { id: 'speed',   type: 'number', min: 0, max: 5 },
    { id: 'color',   type: 'color' },
    { id: 'opacity', type: 'number', min: 0, max: 1 },
  ],
  detect: (ctx) => !!ctx.scene,
  apply: (ui, ctx) => {
    const folder = ui.addFolder('Dust Particles');
    let count = 1000;
    // ... mount the particle system to ctx.scene ...
    folder.addSlider('Count', { min: 100, max: 10000, value: count, onChange: v => {/*…*/} });
    return { folder, dispose: () => {/*…*/} };
  },
  teardown: (ui, handle) => {
    handle?.dispose?.();
    ui.panel.removeFolder('Dust Particles');
  },
});
```

The skill is now in the catalog. It will appear in `describe()`, can be
applied via `ui.skills.apply('3d.dust-particles')`, and is auto-applied on
project load if `detect()` returns true.

## Updating an existing skill

```js
// Tighten the range on the lighting intensity property
ui.skills.update('3d.lighting', {
  properties: [
    { id: 'intensity', type: 'number', min: 0, max: 5 },   // was 0..20
    { id: 'color',     type: 'color' },
  ],
});
```

The update is reflected in `describe()` and re-applied automatically if the
skill is currently mounted.

## When the user adds new content

The library polls the scene every second and re-runs `detect()` for all
skills. If a user adds a `ShaderMaterial`, the shader-related skills
auto-mount; remove all custom shaders and they auto-unmount.

To force a re-scan (e.g. you imported a GLB):
```js
ui.skills.autoApply();
```

## Persistence

Usage stats are persisted to `localStorage` per origin so suggestions
improve across sessions:
```js
ui.skills.enablePersistence('ghost-panel-skill-usage');   // already on by default
```

## Subscribing to changes

```js
const unsub = ui.skills.onChange(() => {
  console.log('Catalog changed');
  // re-read describe() to refresh your UI / state
});
```

## Constraints for AI-generated skills

When generating a new skill, the agent MUST:
- Use a unique `id` (recommended convention: `<workflow>.<feature>`)
- Provide a JSON-serializable `properties[]` schema
- Implement `apply(ui, ctx)` that returns a handle (or null)
- Implement `teardown(ui, handle)` that cleans up any DOM / scene mutations
- Use only the public Folder API (`addSlider`, `addColor`, `addCheckbox`,
  `addButton`, `addSelect`, `addText`, `addFile`, `addVec3`, `addDial`,
  `addCurveEditor`, `addTimeline`, `addStepper`, `addXYPad`)
- Avoid global state — store handles on the returned object

## Conventional property `type` values

`number`, `int`, `boolean`, `string`, `color`, `vec3`, `euler`, `enum`
(plus `options: []`), `track[]`, `color[]`, custom strings are tolerated.

## Telemetry an agent can read

For each skill:
- `applied: boolean` — currently mounted
- `uses: number` — historical count

For each property (when bound to a control), the live value is reachable
via the folder handle returned from `apply()`. Standard pattern:
```js
const handle = ui.skills.apply('3d.lighting');
const intensity = handle?.folder?.get('L1 Intensity')?.getValue();
```

## Pitfall ledger — controls that look wired but aren't

This class of bug bit us repeatedly. Treat every new control as suspect
until you've **verified the live target actually responded** (screenshot,
eval, or the learning store's pattern detectors). Specific traps:

| Symptom | Root cause | Mandatory check |
|---|---|---|
| `material.map = tex` does nothing | Material's shader doesn't sample `.map` (`ShaderMaterial`, `MeshNormalMaterial`, `MeshDepthMaterial`, …) | Verify `material.type` is in `TEXTURE_CAPABLE_MATERIALS` before assigning. Auto-promote to `MeshStandardMaterial` otherwise. |
| Texture renders dim / tinted | `material.color` is non-white; Three.js multiplies map × color | When uploading a texture, force `material.color.set(0xffffff)` unless the user explicitly tints it after. |
| Property changed but no visual change | Missing `material.needsUpdate = true` after a property that requires shader recompile (map presence change, side change, transparent flip, defines flip) | Set `needsUpdate = true` on any structural change. Map adds/removes always require it. |
| Slider's `onChange` fires but the value doesn't move | Setter writes to a stale `mat` ref captured by closure, while the live object's `material` was swapped (e.g. by a type-swap select) | Always look up the live material at write time: `object.material.foo = v`, not `mat.foo = v`. |
| Click handler doesn't fire | Event registered before the element was in the DOM, or `stopPropagation` from an ancestor swallowed it | Attach handlers AFTER `appendChild`. Use capture phase for handlers that must beat orbit controls. |
| Outliner action doesn't refresh | `SceneObjectManager.select / register / remove` didn't emit `'change'` | Every mutating method must emit. Seed pattern `select-without-change` covers the missing-emit case. |
| Mini-toolbar input updates `mat` but viewport still shows old value | Render loop reads from a different camera/material than the one the input wrote to (e.g. user activated POV camera, OrbitControls swapped) | Read the active reference at write time: `(ui._activeCamera || originalCamera)`. |
| Texture upload silently fails | `URL.revokeObjectURL` ran before the loader callback resolved, OR the file didn't pass through `<input>.files` correctly | Revoke inside both success **and** error callbacks. For programmatic tests, use `DataTransfer` to populate `<input>.files`. |
| Whole module refuses to load (`ReferenceError: ui is not defined` or `Unexpected token '{'` in styles.js) | A backtick or `${…}` inside a **comment** inside the giant `export const css = \`…\`` template literal in `styles.js` closed the string early — the rest of the file is now parsed as code | NEVER use backticks or `${` in comments inside `styles.js`. Refer to selectors with plain dots (`.dui-foo`), never wrap them in backticks. **Fastest check after any styles.js edit: `node --check styles.js`** — it points to the exact line where the template broke. If the page won't load and `__demoStep` is undefined, this is almost always the cause. |
| Collapsed folder still occupies ~18px instead of just the header | The liquid-glass theme override (`.ghost-panel.dui-liquid-glass .dui-folder-body { padding: 4px 18px 14px }`) has the same specificity as `.dui-folder.dui-collapsed .dui-folder-body { padding-top: 0; padding-bottom: 0 }` but appears later in the file → wins on cascade order. Padding-top + padding-bottom keep the body 18px tall even with `max-height: 0` | The collapsed override must chain `.ghost-panel` (and the theme class for safety) to outscore theme rules. Verify with `getBoundingClientRect().height` on a collapsed `.dui-folder-body` — must be 0, not 18. |
| Ghost Panel's panel/menu/toolbar deviates from the design in a host project (wrong font, italicized text, weird letter-spacing) | The host page set `body { font-family: Georgia }` or `* { letter-spacing: 0.05em }`, and our elements mount directly to `document.body` so they inherit it. | The "Style isolation" block near the top of `styles.js` resets typography on every body-mounted root. **Any new element that does `document.body.appendChild(...)` MUST be added to both comma-lists in that block** (the root reset list AND the `* { font-family: inherit }` descendant list). The roots currently isolated: `.ghost-panel`, `.dui-context-toolbar`, `.dui-camera-badge`, `.dui-camera-grid`, `.dui-add-menu`, `.dui-export-menu`, `.dui-modal-host`, `.dui-modal-backdrop`, `.dui-toast-host`, `.dui-color-popover`, `.dui-combo-popover`, `.dui-easing-popover`, `.dui-tooltip`, `.dui-bind-popup`, `.dui-context-menu`, `.dui-modal-hint`, `.dui-toolbar`, `.dui-demo-switcher`, `.dui-gizmo-2d`. |
| Ghost Panel buttons inside a host project render unstyled (no background, no rounded corners) after the form-isolation reset was added | The form reset selectors (`.ghost-panel button { background: transparent; padding: 0; ... }`) had specificity (0,1,1) — beating `.dui-btn` at (0,1,0). They were clobbering our own classed controls. | The reset MUST exclude our classed controls via `:not([class*="dui-"])`. That keeps the reset's job intact (zero out host CSS on plain elements inside our panels) while leaving our own `.dui-btn`/`.dui-number-input`/`.dui-header-btn` styles untouched. If you add a new isolation rule, keep the `:not([class*="dui-"])` filter on every selector. |
| Workflow-specific folders (Material / Graph Editor / Shader uniforms / Camera Settings) inconsistently appear in host projects — present on some loads, missing on others | `detectAndSync()` only ran once at init + via a 1-second `setInterval` poll (Three-only). Hosts that load content asynchronously (GLTF, fetched JSON, dynamic mesh creation) miss the init detection window. The poll smooths it over within 0–1000ms for Three hosts but does nothing for 2D / web hosts. | Bind `detectAndSync` to `objectManager.on('register')` AND `'remove')` with a microtask-debounced wrapper (`_detectSoon`). Folders surface within one microtask of the host registering a new object — works for every workflow type and every host. The 1Hz poll remains as a safety net for hosts that mutate the scene without using `om.register`. |
| Every canvas click selects the same wrong object (typically "Camera"), even on clearly-different meshes | `THREE.Raycaster.intersectObjects` does NOT respect the `.visible` flag — it only tests `.layers` + the object's own `raycast()`. So an invisible `CameraHelper` (e.g. the main viewport camera's, which we deliberately hide) still registers a hit at distance 0 because it sits at the camera origin where the ray starts. Every click top-hits that hidden helper, walks up to find its registered name, and selects "Camera". | In `_attachInteraction` (three-extensions.js), filter targets with `t.visible !== false` before raycasting. Also use a **two-pass raycast**: try `objectTargets` first, fall back to `helperTargets` only when the first pass returns nothing. Without the two-pass, light/camera helper line geometry intercepts clicks that should hit the actual mesh behind them (e.g. a DirectionalLightHelper line drawn in front of a sphere). |
| Outliner skips later-registered objects in headless/background contexts (Claude Preview, hidden iframes, multi-window UX) | Originally batched outliner re-renders via `requestAnimationFrame`. Browsers PAUSE rAF for backgrounded tabs (some platforms throttle, some halt entirely). The first rAF render fires while the tab is foregrounded; deferred registers via `queueMicrotask`/rAF that fire later never trigger a re-render because the rAF callback is paused. | Batch outliner re-renders via **`queueMicrotask`**, not `requestAnimationFrame`. Microtasks always run at the end of the current JS task regardless of tab visibility, AND still coalesce a synchronous burst of N change events into one render (the `renderQueued` flag in `addSceneObjectsFolder`). Trade-off: microtask render fires sooner than 16ms, which is fine because rendering ~1000 rows still completes in <1ms. Don't put visibility-gated work in rAF unless you genuinely only care about the foreground case. |
| New inspector control "works" (state changes, screen reflects it) but **Cmd+Z does nothing** | The control's `onChange` mutated host state directly, but never pushed an undo entry. Every host previously had to wrap onChange manually — easy to forget when adding a new control. | The `Folder` API auto-wraps every value-emitting `add*` (`addSlider/Color/Checkbox/Select/Number/Curve/Vec3/Dial/XYPad/...`) via `_wrapOnChange` (folder.js). Snapshot is the previous COMMITTED value (tracked inside the wrapper — NOT polled from the control, which would return the already-mutated state). Drags are coalesced into one undo entry per 250ms idle. Undo/redo call BOTH `setValue()` (so the widget rebounds) AND `userOnChange()` (so host state stays in sync). The wrapper sets `stack._suppress` during replay so recursive undo pushes don't multiply. Opt out per-call with `opts.undo: false`. Buttons / Triggers / Sequences / Timelines.onUpdate are intentionally NOT wrapped — they're actions / playback ticks, not value commits. Hosts that want a button to be undoable do `ui._undo.push({ label, undo, redo })` manually. |
| Workflow's `Page > Background` picker fires onChange but nothing visibly changes | The 'web' workflow's default `onChange` sets `document.body.style.background`. Hosts whose visible surface is a fixed-position container (canvas, stage, app shell) cover body, so the picker appears broken even though it "works". | Pass `workflowOpts.backgroundTargets: ['.stage', myCanvasEl]` (selectors or elements). The picker paints body AND every target. For full takeover (CSS variables, themed routing, etc.), pass `workflowOpts.onBackgroundChange: (c) => …` — your callback replaces the default entirely. Same pattern applies to any future workflow control that mutates DOM: prefer a target-list or callback opt over hardcoded selectors. |
| Gaussian-splat `.ply` upload renders as a fluffy white blob | Splat PLYs (from INRIA's repo, Polycam, LumaAI, etc.) don't store color as `red/green/blue`. They store it as the DC spherical-harmonic coefficients `f_dc_0/1/2`. PLYLoader doesn't recognize these, so `geom.getAttribute('color')` is null, the material falls back to `0xcccccc`, and millions of tiny white points pile up into a white cloud. Same pitfall hits any third-party loader that doesn't know about SH attributes. | The `Add → Gaussian Splat` factory in `add-menu.js` now sniffs for `f_dc_0/1/2` and decodes them via `rgb = clamp01(0.5 + SH_C0 * f_dc)` where `SH_C0 = 0.28209479177387814` (DC term of the SH basis). Opacity is `sigmoid(opacity)` if the attribute exists. PLYs with neither standard nor SH colors get a position-based palette so structure is visible (better than a blob). Point size auto-scales from bbox diagonal (0.2%) so 1cm and 100m models both render reasonably. Also includes a built-in `.splat` binary parser (32-byte records: pos×3 f32, scale×3 f32, color×4 u8, rot×4 u8) so the menu works without `ui._splatLoader` for the common formats. If you add support for a NEW point-cloud format, mirror this triage path: detect known color encodings → decode → fall back to position palette → set vertexColors. |

**Verification protocol for every new UI control:**
1. Mount the control.
2. Programmatically dispatch the user gesture (`change` / `input` / `click`) — not `setValue()`, which often bypasses `onChange`.
3. Assert the *target object property* changed (not just the input value).
4. Where possible, screenshot the canvas before + after.
5. If the change involves a Three.js material, audit `mat.needsUpdate` was set
   and the material type can actually consume the property.

Any failure in steps 3–5 must surface as a Learning-store proposal, not
a silent regression. See `learning.js` patterns:
`material-prop-no-effect`, `silent-control`, `tinted-texture`.
