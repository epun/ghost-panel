/**
 * Project scanner — sniffs the host page and registered scene to figure
 * out what kind of project Ghost Panel has been dropped into, then auto-
 * registers Shift+A factories that match.
 *
 * The intent is that a user shouldn't have to manually register
 * `Button` / `Heading` / `Image` factories for a web project, or
 * `Circle` / `Rect` for a 2D canvas: Ghost Panel should look at what's
 * already on the page and offer the obvious next moves.
 *
 * Heuristics are intentionally lightweight and conservative — they only
 * fire if there's clear evidence (a sized canvas, a populated scene,
 * recognizable CSS classes). Nothing here calls the network or reads
 * source files; the "project file" the user sees is the live DOM +
 * the registered scene tree, since that's what's actually accessible
 * from the browser.
 *
 *   import { scanAndRegister } from './project-scanner.js';
 *   scanAndRegister(ui);   // call once after createGhostPanel()
 *
 * Custom factories registered by the host (via `ui._addMenu.register`)
 * always take precedence — we only inject what isn't already there.
 */

import { icons } from './icons.js';

/**
 * Inspect the page + ui state and return an array of detected
 * signatures. The caller uses these tags to decide which factory
 * packs to register.
 */
export function scanProject(ui) {
  const signatures = new Set();

  // ── Three.js scene ────────────────────────────────────────────────
  // Most reliable signal — if the host passed a scene to createGhostPanel,
  // it's definitely a 3D project. Also surface specific sub-signatures
  // so we can register only the bits that fit (e.g. don't add lights
  // if the scene has no renderer).
  const scene = ui._scene;
  if (scene?.isScene || scene?.isObject3D) {
    signatures.add('three');
    let lightCount = 0, meshCount = 0, cameraCount = 0, hasAnim = false;
    scene.traverse?.(obj => {
      if (obj.isLight) lightCount++;
      if (obj.isMesh) meshCount++;
      if (obj.isCamera) cameraCount++;
      // Same detection table as detectWorkflows so the two systems
      // agree on what counts as "animated". Any positive hit raises
      // the `animation` signature so consumers (export menu, add menu,
      // workflow setup) can react.
      if (
        obj.userData?.mixer ||
        obj.userData?.animations?.length ||
        obj.userData?.clips?.length ||
        obj.animations?.length ||
        obj.isSkinnedMesh ||
        obj.isBone
      ) {
        hasAnim = true;
      }
    });
    if (lightCount > 0)  signatures.add('three-lit');
    if (meshCount > 0)   signatures.add('three-meshes');
    if (cameraCount > 1) signatures.add('three-multi-cam');
    if (hasAnim)         signatures.add('animation');
  }
  // Outside Three.js: web adapters or 2D canvases sometimes drive
  // CSS / WAAPI animations the user wants to scrub via the graph
  // editor. We surface `animation` when the host explicitly passed
  // animation opts to createGhostPanel (handled in detectWorkflows) —
  // here we only need to add a flag for already-existing tracks.
  if (Array.isArray(ui._graphEditor?.state?.tracks) && ui._graphEditor.state.tracks.length > 0) {
    signatures.add('animation');
  }

  // ── 2D canvas — only if NOT three.js, since three uses canvas too ─
  if (!signatures.has('three')) {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const has2D = canvases.some(c => {
      try { return !!c.getContext('2d'); } catch { return false; }
    });
    if (has2D) signatures.add('canvas-2d');
  }

  // ── Web / DOM project — sniff for telltale styling systems ────────
  // We test for these in cascade order: more specific systems first so
  // we can offer matching component shells. Heuristics fire on a
  // single class match because production bundles often strip class
  // duplication.
  const html = document.documentElement;
  const allClasses = collectClassSample(html, 800);
  const hasTailwind = /\b(bg-(red|blue|green|gray|black|white|slate|zinc|neutral|stone)-\d{2,3}|rounded-(sm|md|lg|xl|2xl|3xl|full)|p[xytrbl]?-\d|m[xytrbl]?-\d|flex|grid|gap-\d)\b/.test(allClasses);
  const hasShadcn   = /\b(shadcn|peer|data-\[state=)\b/.test(allClasses);
  const hasMui      = /\bMui[A-Z]/.test(allClasses);
  if (hasShadcn) signatures.add('shadcn');
  if (hasMui)    signatures.add('mui');
  if (hasTailwind) signatures.add('tailwind');

  // ── Generic web markers (forms, nav, lists, media) ────────────────
  // These light up "this is a real page" factories regardless of
  // styling system. Counts are capped via .slice(0, 1) so we don't
  // walk the whole DOM repeatedly.
  if (document.querySelector('form, input[type="text"], input[type="email"], input[type="password"]'))
    signatures.add('forms');
  if (document.querySelector('nav, [role="navigation"], header, [role="banner"]'))
    signatures.add('nav');
  if (document.querySelectorAll('img').length >= 3)
    signatures.add('media-rich');
  if (document.querySelector('h1, h2, h3, [class*="heading"], [class*="title"]'))
    signatures.add('typographic');
  if (document.querySelector('button, [role="button"], a.button, .btn'))
    signatures.add('interactive');

  // ── Web adapter present (already-registered adapters, or explicit opt-in)
  // Original check: adapters already in the manager (works after manual register).
  const names = ui.objectManager?.getNames?.() || [];
  if (names.some(n => ui.objectManager.getObject(n)?._el)) signatures.add('web');
  // Also detect before any adapters are registered: elements with the explicit
  // data-ghost-panel opt-in attribute, OR elements using the .el + position:fixed
  // convention from the demos. This breaks the chicken-and-egg where the 'web'
  // factory pack never seeded the add menu for fresh projects.
  if (document.querySelector('[data-ghost-panel]')) signatures.add('web');
  if (Array.from(document.querySelectorAll('.el')).some(el =>
    ['fixed', 'absolute'].includes(getComputedStyle(el).position))) {
    signatures.add('web');
  }

  return Array.from(signatures);
}

/**
 * Walk an element's tree collecting className strings up to a
 * character budget. Bounded so even pages with thousands of nodes
 * scan in O(1) wall-clock time.
 */
function collectClassSample(root, charBudget) {
  let acc = '';
  const stack = [root];
  while (stack.length && acc.length < charBudget) {
    const el = stack.shift();
    if (el?.classList?.length) acc += ' ' + el.className;
    for (const c of (el?.children || [])) stack.push(c);
  }
  return acc;
}

/** Run scanProject and auto-register the factories that match. */
export function scanAndRegister(ui) {
  if (!ui?._addMenu) return [];
  const sigs = scanProject(ui);
  // Skip a factory if the host already registered ANYTHING with the
  // same id OR the same label — the host's explicit choice wins,
  // and we don't want "Button" appearing twice just because the demo
  // happened to call its primary button "Button" too.
  const existingIds    = new Set(ui._addMenu._factories?.map(f => f.id) || []);
  const existingLabels = new Set(
    (ui._addMenu._factories || []).map(f => (f.label || '').toLowerCase()));
  const registered = [];

  // Three.js projects are gated separately: the help banner on a 3D
  // demo always trips `typographic` and `interactive`, but the user
  // doesn't want a "Ghost Button" sitting next to "Cube". When the
  // host has a real Three.js scene, only register packs that make
  // sense in that context (none, currently — built-in 3D factories
  // cover the obvious moves).
  const isThree = sigs.includes('three');
  const WEB_SIGNATURES = new Set(['web', 'tailwind', 'shadcn', 'mui', 'forms', 'nav', 'media-rich', 'typographic', 'interactive']);

  // For each signature, pick a small curated set of factories. These
  // are the "obvious next moves" — not the entire web component
  // library, just the most common building blocks a user would reach
  // for in a project of that shape.
  const packs = buildPacks(ui);
  for (const sig of sigs) {
    if (isThree && WEB_SIGNATURES.has(sig)) continue;   // skip web packs in 3D
    for (const f of (packs[sig] || [])) {
      if (existingIds.has(f.id)) continue;
      if (existingLabels.has((f.label || '').toLowerCase())) continue;
      ui._addMenu.register(f);
      existingIds.add(f.id);
      existingLabels.add((f.label || '').toLowerCase());
      registered.push(f.id);
    }
  }
  // Auto-wrap DOM elements that opted in (non-Three.js projects only, to avoid
  // "Ghost Button" next to "Cube" confusion). Checks two sources:
  //   • [data-ghost-panel] — explicit opt-in attribute for any project
  //   • .el + position:fixed/absolute — the established demo convention
  // Already-wrapped elements (element.dataset.ghostPanelAdapter is set by
  // createWebAdapter) are skipped so calling scanAndRegister multiple times
  // is idempotent.
  if (!isThree && ui.objectManager) {
    _autoRegisterWebElements(ui);
  }

  return { signatures: sigs, registered };
}

/**
 * Each pack is a small group of factories the scanner contributes when
 * its signature lights up. We omit `workflows` so the add menu treats
 * them as universal (visible in every workflow) — gating happens at
 * the SCAN layer instead: we only register the pack at all if the
 * matching signature was detected. That keeps the workflow-filter
 * code in add-menu.js simple AND avoids registering a "Button"
 * factory in a project that has no DOM to attach it to.
 */
function buildPacks(ui) {
  // Shared base — every auto-factory tags itself so the user can tell
  // them apart from built-ins (e.g. in DevTools) and so we can re-run
  // the scanner later without double-registering.
  const auto = { _autoRegistered: true };
  // Web-component factories spawn a freshly styled <div> element and
  // wrap it in createWebAdapter — so the new element is selectable,
  // animatable, and undoable like any other registered object.
  async function buildWebElement(opts) {
    const { createWebAdapter } = await import('./web-adapter.js');
    const el = document.createElement(opts.tag || 'div');
    if (opts.text) el.textContent = opts.text;
    Object.assign(el.style, {
      position: 'fixed', top: '0', left: '0', transformOrigin: '0 0',
      ...opts.style,
    });
    document.body.appendChild(el);
    const a = createWebAdapter(el, {
      x: innerWidth  * (0.2 + Math.random() * 0.6),
      y: innerHeight * (0.2 + Math.random() * 0.6),
    });
    ui.objectManager?.register?.(a.name, a);
    ui.objectManager?.select?.(a.name);
    return a;
  }

  const webBase = { ...auto };
  return {
    'web': [
      { ...webBase, id: 'auto-button', label: 'Button', category: 'Element', icon: icons.cursorClick,
        build: () => buildWebElement({
          text: 'Button',
          style: { padding: '10px 22px', background: 'hsl(220 90% 55%)', color: '#fff',
                   borderRadius: '8px', fontWeight: '600', cursor: 'pointer',
                   boxShadow: '0 4px 16px hsl(220 80% 30% / 0.4)' },
        }),
      },
      { ...webBase, id: 'auto-heading', label: 'Heading', category: 'Text', icon: icons.heading,
        build: () => buildWebElement({
          text: 'Heading',
          style: { fontSize: '48px', fontWeight: '700', color: 'hsl(0 0% 100%)',
                   width: 'auto', height: 'auto', display: 'block' },
        }),
      },
      { ...webBase, id: 'auto-paragraph', label: 'Paragraph', category: 'Text', icon: icons.textT,
        build: () => buildWebElement({
          text: 'A short block of body copy.',
          style: { fontSize: '15px', color: 'hsl(0 0% 88%)', lineHeight: '1.5',
                   width: '320px', height: 'auto', display: 'block' },
        }),
      },
    ],

    // Tailwind-style projects → register components with rounded corners
    // + the kind of spacing tokens Tailwind users expect.
    'tailwind': [
      { ...webBase, id: 'auto-tw-card', label: 'Tailwind Card', category: 'Element', icon: icons.rectangle,
        build: () => buildWebElement({
          text: 'Card',
          style: { width: '320px', height: '180px', padding: '24px',
                   background: 'hsl(0 0% 100%)', color: 'hsl(0 0% 10%)',
                   borderRadius: '16px', boxShadow: '0 10px 30px hsl(0 0% 0% / 0.15)',
                   display: 'flex', alignItems: 'flex-end', fontWeight: '600' },
        }),
      },
      { ...webBase, id: 'auto-tw-pill', label: 'Tailwind Pill', category: 'Element', icon: icons.buttonPill,
        build: () => buildWebElement({
          text: 'Tag',
          style: { padding: '6px 14px', background: 'hsl(220 90% 55% / 0.15)',
                   color: 'hsl(220 90% 75%)', borderRadius: '9999px',
                   fontSize: '12px', fontWeight: '600' },
        }),
      },
    ],

    // Forms — a project with <form> / <input> likely wants a labelled
    // text field and a primary submit button.
    'forms': [
      { ...webBase, id: 'auto-input', label: 'Text Input', category: 'Form', icon: icons.pencil,
        build: () => buildWebElement({
          tag: 'input',
          style: { padding: '10px 14px', width: '240px',
                   background: 'hsl(0 0% 100%)', color: 'hsl(0 0% 10%)',
                   border: '1px solid hsl(0 0% 80%)', borderRadius: '6px',
                   fontSize: '14px', boxSizing: 'border-box' },
        }),
      },
    ],

    // Nav-heavy pages → header bar with a primary action.
    'nav': [
      { ...webBase, id: 'auto-nav-link', label: 'Nav Link', category: 'Element', icon: icons.cursorClick,
        build: () => buildWebElement({
          text: 'Link',
          style: { padding: '6px 12px', color: 'hsl(0 0% 90%)',
                   borderRadius: '4px', fontWeight: '500', fontSize: '14px' },
        }),
      },
    ],

    // Image / media galleries → file-picker image factory.
    'media-rich': [
      { ...webBase, id: 'auto-image', label: 'Image', category: 'Media', icon: icons.image,
        needsFile: 'image/*',
        build: ({ file }) => new Promise((resolve, reject) => {
          if (!file) return reject(new Error('no image selected'));
          const url = URL.createObjectURL(file);
          const img = new Image();
          img.onload = () => {
            const el = document.createElement('img');
            el.className = 'el';
            el.src = url;
            const maxW = 320;
            const aspect = img.naturalWidth / img.naturalHeight;
            const w = Math.min(maxW, img.naturalWidth);
            const h = w / aspect;
            Object.assign(el.style, {
              position: 'fixed', top: '0', left: '0', transformOrigin: '0 0',
              width: `${w}px`, height: `${h}px`, borderRadius: '12px',
              boxShadow: '0 10px 24px hsl(0 0% 0% / 0.5)', objectFit: 'cover',
            });
            document.body.appendChild(el);
            buildWebElement.__placeAt = el;   // handover
            import('./web-adapter.js').then(({ createWebAdapter }) => {
              const a = createWebAdapter(el, {
                x: innerWidth  * (0.2 + Math.random() * 0.6),
                y: innerHeight * (0.2 + Math.random() * 0.6),
              });
              ui.objectManager?.register?.(a.name, a);
              ui.objectManager?.select?.(a.name);
              resolve(a);
            });
          };
          img.onerror = reject;
          img.src = url;
        }),
      },
    ],

    // Typographic content → easy-add heading + paragraph (same as
    // 'web' pack, just kicked in by an h1/h2/h3 sighting).
    'typographic': [
      { ...webBase, id: 'auto-display-text', label: 'Display Text', category: 'Text', icon: icons.heading,
        build: () => buildWebElement({
          text: 'Display',
          style: { fontSize: '64px', fontWeight: '800', color: 'hsl(0 0% 100%)',
                   letterSpacing: '-0.02em', width: 'auto', height: 'auto', display: 'block' },
        }),
      },
    ],

    // Interactive page → ghost button (secondary CTA pattern).
    'interactive': [
      { ...webBase, id: 'auto-ghost-button', label: 'Ghost Button', category: 'Element', icon: icons.cursorClick,
        build: () => buildWebElement({
          text: 'Ghost',
          style: { padding: '10px 22px', background: 'transparent',
                   border: '1px solid hsl(0 0% 100% / 0.25)', color: 'hsl(0 0% 100%)',
                   borderRadius: '8px', fontWeight: '500', cursor: 'pointer' },
        }),
      },
    ],

    // 2D canvas projects — register the 2D shape primitives the canvas
    // demo already ships, scoped to the actual canvas the host owns.
    'canvas-2d': [
      // Empty by default. The 2D demo registers its own circle/rect
      // factories that wire into its render loop; we don't want to
      // spawn shapes that nothing draws. Adding this pack keeps the
      // signature list complete for downstream tooling.
    ],
  };
}

/**
 * Scan for DOM elements that should be auto-registered in the ObjectManager.
 * Two sources:
 *   • [data-ghost-panel]         — explicit opt-in, any project
 *   • .el + position:fixed/absolute — the demo convention
 *
 * Already-wrapped elements are skipped (createWebAdapter stamps
 * element.dataset.ghostPanelAdapter on first wrap, so this is idempotent).
 */
function _autoRegisterWebElements(ui) {
  const dataAttrEls = Array.from(document.querySelectorAll('[data-ghost-panel]'))
    .filter(el => !el.dataset.ghostPanelAdapter);
  const dotElEls = Array.from(document.querySelectorAll('.el'))
    .filter(el => {
      if (el.dataset.ghostPanelAdapter) return false;
      const pos = getComputedStyle(el).position;
      return pos === 'fixed' || pos === 'absolute';
    });
  const toWrap = [...dataAttrEls, ...dotElEls];
  if (!toWrap.length) return;

  import('./web-adapter.js').then(({ createWebAdapter }) => {
    toWrap.forEach(el => {
      if (el.dataset.ghostPanelAdapter) return; // guard against races
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const adapter = createWebAdapter(el, { x: rect.left, y: rect.top });
      ui.objectManager.register(adapter.name, adapter);
    });
  }).catch(() => {});
}
