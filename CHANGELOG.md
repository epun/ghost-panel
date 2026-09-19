# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Panels are reachable out of the box. They mounted hidden AND never bound the
  `Shift+D` shortcut the README documented, so a textbook-correct integration
  produced an invisible tool with no error — the one combination a host cannot
  recover from. `visible` now defaults to `true`, the shortcut is bound on
  mount, and opting back into the unreachable state logs a warning.
- `bindToggleKey()` is idempotent per chord, so hosts that follow the old
  README and bind `Shift+D` themselves no longer get two listeners and a
  shortcut that toggles twice.
- `ui.hide()` now hides the helpers Ghost Panel draws into the host's scene
  (transform gizmo, light and camera visualizers) instead of leaving them
  rendering as stray lines in production views and screenshots. `ui.show()`
  restores exactly what was on before.
- The free camera works on hosts whose WebGL canvas sits below other layers.
  Camera controls bind to `document.body`, so drags landing on a scroll
  runway, HUD or overlay canvas still orbit the scene.
- An optional layer that throws (contextual inspector, canvas context menu,
  learning store) no longer takes the whole `createGhostPanel()` call down
  with it.
- README installs from GitHub; the package is not published to npm, so
  `npm install ghost-panel` and the unpkg URL both 404'd.

### Added

- `toggleKey` option — the chord bound on mount, `{ key: 'D', shift: true }`
  by default. `false` hands the gesture back to the host.
- `ui.toggleKeys` — the chords currently bound to show/hide.
- `cameraControl` option and `ui.cameraControl` — a built-in orbit camera for
  hosts that don't pass `controls` of their own, with a "Free camera" toggle
  in the Scene panel's View folder.
- `onCameraTakeover(active)` — fired when the free camera takes and releases
  the camera. Hosts whose render loop writes the camera every frame (scroll
  scenes, camera-path players) pause that while `active` is `true`; Ghost
  Panel detects the conflict and logs the remedy if they don't.
- Diagnostics rule `panel-unreachable`, for a panel mounted hidden with no
  toggle key bound.
- Vite `resolve.dedupe: ['three']` documented, for the duplicate-Three.js
  warning.

### Added

- **Agent control over MCP.** `npx ghost-panel-mcp` bridges an MCP client to a
  live panel: 8 read tools (catalog, scene tree, objects, materials, panel
  state, diagnostics, screenshot) and 9 bounded writes (select, transform,
  panel controls, apply skill, assign material, camera, focus, undo, redo).
  Opt in from the page with `attachMCPBridge(ui, { token })`.
  - Writes go through the same public API a click would, so an agent's edit
    lands on the shared undo stack and the user can Cmd+Z it.
  - `register_skill` is deliberately not exposed: a skill carries `apply()` and
    `teardown()` bodies, so registering one remotely is arbitrary code
    execution in the user's browser.
  - Loopback-only and opt-in, with `readOnly` and a `confirm(tool, args)` hook
    for hosts that want inspection only or a human in the loop.
  - Transport is SSE down and `fetch` up, so the browser library keeps its zero
    runtime dependencies; the MCP SDK is an optional, server-only dependency.
- Control handles expose `_onChange`, the undo-wrapped committed handler, so
  anything driving a control programmatically completes the round trip instead
  of repainting the widget while the host hears nothing.

### Added

- Materials palette in the Scene panel: every scene material as a rendered
  sphere swatch, filtered by All / Unused / Active Object.
- Clicking a swatch opens that material's properties in the Inspector, bound
  to the material instance so unassigned materials are editable too.
- Drag a swatch onto viewport geometry or an Outliner row to apply it. A plain
  drop re-skins the whole object — the whole model for an imported group, not
  just the sub-mesh under the ray. `Alt`/`⌥` narrows to the geometry group
  under the cursor (splitting a single-material mesh into per-group slots), or
  to that one sub-mesh when its geometry has no groups.
- `materialsPanel` option, `ui.materials` handle, `ui.refreshMaterials()`, and
  the `ghost-panel/materials` subpath export.

## [0.1.0] - 2026-06-16

### Added

- Initial public release of Ghost Panel — workflow-aware inspector for Three.js, 2D canvas, and web/DOM projects.
- Auto-scanning project detection, contextual inspector folders, outliner, mini transform toolbar, graph editor, undo/redo, exporters.
- Framework adapters: React, Vue, Svelte, Solid (`ghost-panel/react`, `/vue`, `/svelte`, `/solid`).
- Skills registry with machine-readable [AGENTS.md](AGENTS.md) surface for AI coding agents.
- Natural-language augmentation bar (`augment`) and diagnostics health overlay.
- Vite library build (ESM, CJS, UMD) with optional `three` peer dependency.
- Demo pages for 3D, 2D, web, and grid workflows.

[0.1.0]: https://github.com/epun/ghost-panel/releases/tag/v0.1.0
