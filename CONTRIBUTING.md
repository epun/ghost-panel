# Contributing to Ghost Panel

Thanks for your interest in Ghost Panel! This project is early-stage (`0.1.0`); small, focused PRs are especially welcome.

## Development setup

```bash
git clone https://github.com/epun/ghost-panel.git
cd ghost-panel
npm install
npm run dev
```

Open one of the demo pages (e.g. `ghost-panel-demo.html`) from the Vite dev server. Press `Shift+D` to toggle the panel.

## Build

```bash
npm run build          # dist/ghost-panel.{js,cjs,umd.js}
npm run pack:tgz       # dry-run publish tarball
node --check styles.js # fast sanity check after editing styles.js
```

## Pull requests

1. Fork and branch from `main`.
2. Keep changes scoped — one fix or feature per PR when possible.
3. Run `npm run build` before opening the PR.
4. Manually smoke-test at least one demo page if you touched UI or interaction code.
5. Describe what you changed and how you tested it.

## Dev-only tooling

Some features only run under `npm run dev` (Vite `serve` mode):

- **`learning.js`** — records integration patterns and can propose source fixes.
- **`vite-plugin-ghost-panel.js`** — exposes `POST /__ghost-panel/analytics` and `POST /__ghost-panel/apply-fix` for the learning loop.

These endpoints **do not ship** in production builds. The Vite plugin may write patches to source files on disk when you accept a fix in dev — review diffs before committing.

## AI agents

See [AGENTS.md](AGENTS.md) for the machine-readable skill registry and verification protocol when adding or modifying skills.

## Questions

Open a [GitHub Discussion](https://github.com/epun/ghost-panel/discussions) or an [issue](https://github.com/epun/ghost-panel/issues) if you're unsure whether a change fits.
