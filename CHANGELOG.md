# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Materials palette in the Scene panel: every scene material as a rendered
  sphere swatch, filtered by All / Unused / Active Object.
- Clicking a swatch opens that material's properties in the Inspector, bound
  to the material instance so unassigned materials are editable too.
- Drag a swatch onto viewport geometry or an Outliner row to apply it. A plain
  drop re-skins the whole object; `Alt`/`⌥` drops onto the geometry group
  under the cursor, splitting a single-material mesh into per-group slots.
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
