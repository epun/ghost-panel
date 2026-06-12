import { Folder } from './folder.js';
import { THEMES } from './styles.js';

// ── Global theme coordination ──────────────────────────────────────────────
// Every live Panel registers itself here so a single theme toggle flips ALL of
// them at once (main inspector + scene outliner) instead of each panel carrying
// an independent toggle. We also mirror the active theme's CSS variables onto
// <html> (:root) so body-appended surfaces — toasts, the contextual toolbar,
// the camera badge, modals, the diagnostics overlay — which live OUTSIDE any
// .ghost-panel root and therefore can't inherit the panel's inline vars, resolve
// their var(--…) references to the active theme and flip in lockstep.
const _panelRegistry = new Set();
// Canonical set of themeable variables. `zinc` (dark) is the base CSS with an
// empty token map, so the light theme's keys are the full superset we manage on
// :root. Switching to a theme that omits a key removes it from :root, reverting
// to the dark literal baked into each surface's var() fallback.
const _THEME_VAR_KEYS = Object.keys(THEMES.light || {});

/**
 * Apply a named theme globally: mirror its vars onto :root, toggle the
 * `dui-theme-light` marker class on <html>, and flip every registered panel.
 * This is what the per-panel toggle calls so the whole UI moves together.
 */
export function applyGlobalTheme(name) {
  const tokens = THEMES[name] || {};
  const root = document.documentElement;
  _THEME_VAR_KEYS.forEach(k => {
    if (tokens[k] != null) root.style.setProperty(k, tokens[k]);
    else root.style.removeProperty(k); // revert to dark base (surface var() fallbacks)
  });
  // A marker class light-mode overrides for hard-coded surface backgrounds hang
  // off (the backgrounds aren't var-driven, so vars alone wouldn't flip them).
  root.classList.toggle('dui-theme-light', name === 'light');
  _panelRegistry.forEach(p => { if (p._currentTheme !== name) p.setTheme(name); });
}

/**
 * A floating panel — anchored to one side of the viewport, contains a header
 * and a stack of folders. Use addFolder() to organize controls.
 *
 * Stops pointer events from bubbling to the page (so dragging sliders doesn't
 * also pan a Three.js OrbitControls behind it).
 */
export class Panel {
  constructor(opts = {}) {
    const {
      title = 'Ghost Panel',
      side = 'right', // 'left' | 'right'
      width,
      visible = false,
      theme,       // string key into THEMES (e.g. 'light', 'slate', 'zinc')
      themeVars,   // object of CSS variable overrides, e.g. { '--primary': '142 76% 36%' }
    } = opts;
    this.title = title;
    this.side = side;
    this.folders = {};
    this._build(width);
    _panelRegistry.add(this);
    if (theme)     this.setTheme(theme);
    if (themeVars) this.setThemeVars(themeVars);
    if (visible) this.show();
  }

  /** Apply one of the built-in themes from THEMES (e.g. 'zinc', 'light'). */
  setTheme(name) {
    const tokens = THEMES[name];
    if (!tokens) {
      console.warn(`[Ghost Panel] Unknown theme "${name}". Available: ${Object.keys(THEMES).join(', ')}`);
      return;
    }
    this._currentTheme = name;
    // Clear any prior inline overrides (so switching themes is clean)
    this.element.style.cssText = this.element.style.cssText
      .split(';')
      .filter(s => !s.trim().startsWith('--'))
      .join(';');
    this.setThemeVars(tokens);
    // If the panel is currently in Liquid Glass mode, also toggle the
    // light-glass variant. This makes the Dark/Light theme buttons feel right
    // even when Liquid Glass is enabled.
    if (this.element.classList.contains('dui-liquid-glass')) {
      this.element.classList.toggle('dui-liquid-light', name === 'light');
    }
    this._syncThemeToggle();
  }

  /** Update the header theme-toggle icon + tooltip to reflect the active theme. */
  _syncThemeToggle() {
    if (!this._themeBtn) return;
    const isLight = this._currentTheme === 'light';
    this._themeBtn.innerHTML = isLight ? this._ICON_MOON : this._ICON_SUN;
    this._themeBtn.dataset.tooltip = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  }

  /**
   * Switch this panel to Blender-style 3D UI (compact rows, pixel-rectangular
   * buttons, Blender-blue selection). The shadcn theming variables are
   * overridden by the .dui-blender3d class. Pass false to remove.
   */
  setBlenderStyle(on = true) {
    this.element.classList.toggle('dui-blender3d', !!on);
  }

  /**
   * Switch this panel to Apple Liquid Glass styling (iOS 26 design language).
   * Frosted backdrop, specular edge highlights, translucent pill controls.
   * Inspired by LiquidGlassKit (DnV1eX/LiquidGlassKit).
   * Pass { variant: 'light' } for a light-mode variant that works over bright
   * backgrounds.
   */
  setLiquidGlass(on = true, opts = {}) {
    this.element.classList.toggle('dui-liquid-glass', !!on);
    // If a variant was explicitly passed, honor it. Otherwise infer from the
    // currently-selected theme (so theme + liquid glass stay in sync).
    let useLight;
    if (opts.variant === 'light') useLight = true;
    else if (opts.variant === 'dark') useLight = false;
    else useLight = this._currentTheme === 'light';
    this.element.classList.toggle('dui-liquid-light', !!(on && useLight));
  }

  /**
   * Wire save/load callbacks to the header buttons. Pass `null` to hide a button.
   *
   * The host typically calls this to forward save → their own scene
   * serializer (e.g. a project-specific JSON dump). Historically that
   * REPLACED the export menu entirely, leaving the user with only the
   * host's JSON download.
   *
   * Now the host's save callback is treated as ONE exporter among the
   * built-in catalog: clicking the save button always opens the export
   * menu, with the host's custom save listed at the top. Hosts that
   * want the old direct-download behavior can opt out via
   * `setSaveLoadHandlers({ save: fn, replaceMenu: true })`.
   *
   *   panel.setSaveLoadHandlers({ save: () => download(), load: () => upload() });
   */
  setSaveLoadHandlers({ save, load, replaceMenu = false, label } = {}) {
    this._handlers.save = save;
    this._handlers.load = load;
    this._handlers.replaceMenuOnSave = replaceMenu;
    this._handlers.saveLabel = label;
    if (this._saveBtn) this._saveBtn.style.display = save ? '' : 'none';
    if (this._loadBtn) this._loadBtn.style.display = load ? '' : 'none';
  }

  /** Set individual CSS variables on the panel root for fine-grained theming. */
  setThemeVars(vars) {
    if (!vars) return;
    Object.entries(vars).forEach(([k, v]) => {
      const prop = k.startsWith('--') ? k : `--${k}`;
      this.element.style.setProperty(prop, v);
    });
  }

  _build(width) {
    const el = document.createElement('div');
    el.className = `ghost-panel dui-${this.side}`;
    if (width) el.style.width = `${width}px`;

    // Header
    const header = document.createElement('div');
    header.className = 'dui-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'dui-header-title';
    titleEl.textContent = this.title;

    // Header actions (save / load / collapse)
    const actions = document.createElement('span');
    actions.className = 'dui-header-actions';

    // SVG icons — outline style, match Apple SF Symbols / iOS aesthetic.
    // Download: tray/inbox with arrow pointing in.
    // Upload:   tray/inbox with arrow pointing out.
    const ICON_DOWNLOAD = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <path d="M8 2v8M4.5 7l3.5 3.5L11.5 7M2.5 13.5h11"/>
      </svg>`;
    const ICON_UPLOAD = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <path d="M8 13.5V5.5M4.5 9L8 5.5 11.5 9M2.5 2.5h11"/>
      </svg>`;
    const ICON_CLOSE = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="1.6" stroke-linecap="round" width="14" height="14">
        <path d="M4 8h8"/>
      </svg>`;
    // Sun: shown in dark mode (click → go light). Circle + 8 rays.
    const ICON_SUN = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <circle cx="8" cy="8" r="3"/>
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1.1 1.1M11.9 11.9L13 13M13 3l-1.1 1.1M4.1 11.9L3 13"/>
      </svg>`;
    // Moon: shown in light mode (click → go dark). Crescent.
    const ICON_MOON = `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <path d="M13.5 9.2A5.5 5.5 0 0 1 6.8 2.5 5.5 5.5 0 1 0 13.5 9.2Z"/>
      </svg>`;

    // Dark / light theme toggle. Lives in core so every demo gets it for free.
    // The icon shows the mode you'll switch TO (sun = "go light", moon = "go dark").
    const themeBtn = document.createElement('button');
    themeBtn.className = 'dui-header-btn dui-theme-toggle';
    this._themeBtn = themeBtn;
    this._ICON_SUN = ICON_SUN;
    this._ICON_MOON = ICON_MOON;
    this._syncThemeToggle();
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const goingLight = this._currentTheme !== 'light';
      // Drive the WHOLE UI from this one toggle: both panels + every
      // body-appended surface, not just the panel this button lives on.
      applyGlobalTheme(goingLight ? 'light' : 'zinc');
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'dui-header-btn';
    saveBtn.dataset.tooltip = 'Download settings as JSON';
    saveBtn.innerHTML = ICON_DOWNLOAD;
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handlers.save?.();
    });

    const loadBtn = document.createElement('button');
    loadBtn.className = 'dui-header-btn';
    loadBtn.dataset.tooltip = 'Load settings from JSON file';
    loadBtn.innerHTML = ICON_UPLOAD;
    loadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handlers.load?.();
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'dui-header-btn dui-collapse';
    collapseBtn.dataset.tooltip = 'Collapse panel';
    collapseBtn.innerHTML = ICON_CLOSE;
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCollapsed();
      collapseBtn.dataset.tooltip = this._collapsed ? 'Expand panel' : 'Collapse panel';
    });

    actions.appendChild(themeBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(loadBtn);
    actions.appendChild(collapseBtn);
    header.appendChild(titleEl);
    header.appendChild(actions);
    el.appendChild(header);

    this._handlers = { save: null, load: null };
    this._saveBtn = saveBtn;
    this._loadBtn = loadBtn;

    // Body (folder container)
    const body = document.createElement('div');
    body.className = 'dui-panel-body';
    el.appendChild(body);

    // Resize handle — anchored on the edge OPPOSITE the panel's docking side
    // so dragging outward widens the panel from where the user is grabbing it.
    const resizer = document.createElement('div');
    resizer.className = `dui-resizer dui-resizer-${this.side === 'right' ? 'left' : 'right'}`;
    el.appendChild(resizer);

    this.element = el;
    this.header = header;
    this.body = body;
    this.resizer = resizer;

    // Stop pointer events from bubbling to canvas / OrbitControls
    const stop = (e) => e.stopPropagation();
    ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup',
     'wheel', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick']
      .forEach(evt => el.addEventListener(evt, stop));

    // Make the header draggable for repositioning
    this._setupDrag(header);

    // Make the resizer functional
    this._setupResize(resizer);

    document.body.appendChild(el);
  }

  _setupResize(handle) {
    const MIN_WIDTH = 200;
    const MAX_WIDTH = 800;
    let resizing = false;
    let startX, startWidth, startLeft;
    let wasRightAnchored = false;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizing = true;
      startX = e.clientX;
      const r = this.element.getBoundingClientRect();
      startWidth = r.width;
      startLeft = r.left;
      // Detect whether panel is right-anchored (computed style 'right' is auto only after drag)
      const cs = getComputedStyle(this.element);
      wasRightAnchored = cs.right !== 'auto' && cs.right !== '';
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'ew-resize';
    });

    handle.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      // For LEFT-edge resizer on a right-docked panel: dragging left = wider.
      // For RIGHT-edge resizer on a left-docked panel: dragging right = wider.
      const widthDelta = this.side === 'right' ? -dx : dx;
      let newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + widthDelta));

      this.element.style.width = `${newWidth}px`;

      // For right-anchored panels we want the right edge to stay fixed.
      // For left-anchored panels we want the left edge to stay fixed.
      // CSS already handles this via the dui-left/dui-right anchor unless the
      // panel was dragged (then it's positioned absolutely via `left`). In
      // the dragged case, we need to adjust `left` to keep the grabbed edge
      // anchored under the cursor.
      if (!wasRightAnchored && this.side === 'right') {
        // Right-side panel that was dragged: anchor the right edge
        this.element.style.left = `${startLeft + (startWidth - newWidth)}px`;
      }
    });

    handle.addEventListener('pointerup', (e) => {
      resizing = false;
      handle.releasePointerCapture(e.pointerId);
      document.body.style.cursor = '';
    });
  }

  _setupDrag(handle) {
    let dragging = false;
    let startX, startY, startLeft, startTop;
    handle.addEventListener('pointerdown', (e) => {
      // Skip drag if the user clicked any header button (save/load/collapse
      // or anything else interactive). Using closest() catches clicks on
      // inner SVG glyphs too.
      if (e.target.closest('.dui-header-btn')) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const r = this.element.getBoundingClientRect();
      startLeft = r.left; startTop = r.top;
      // Switch to absolute positioning so we can drag
      this.element.style.right = 'auto'; this.element.style.left = `${startLeft}px`;
      this.element.style.top = `${startTop}px`;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // Clamp the new position so the panel can never be dragged
      // completely off-screen. We require the header (drag handle)
      // to remain reachable: at least a small horizontal slice of the
      // panel must stay inside the viewport, and the header itself
      // must remain on-screen vertically. Without this the user can
      // fling a panel off the edge and lose access to it.
      const w = this.element.offsetWidth;
      const h = this.element.offsetHeight;
      const MIN_VISIBLE_X = 80;          // px of panel that must remain horizontally visible
      const HEADER_MARGIN = 8;           // top must stay at least this far from the bottom edge
      const proposedLeft = startLeft + (e.clientX - startX);
      const proposedTop  = startTop  + (e.clientY - startY);
      const minLeft = MIN_VISIBLE_X - w;
      const maxLeft = window.innerWidth  - MIN_VISIBLE_X;
      const minTop  = 0;
      const maxTop  = window.innerHeight - (handle.offsetHeight || 40) - HEADER_MARGIN;
      const left = Math.max(minLeft, Math.min(maxLeft, proposedLeft));
      const top  = Math.max(minTop,  Math.min(maxTop,  proposedTop));
      this.element.style.left = `${left}px`;
      this.element.style.top  = `${top}px`;
    });
    handle.addEventListener('pointerup', (e) => {
      dragging = false;
      handle.releasePointerCapture(e.pointerId);
    });
  }

  toggleCollapsed() {
    this._collapsed = !this._collapsed;
    // Drive collapse via class so the CSS transition can animate
    // max-height + opacity smoothly. The body element keeps `display: flex`
    // throughout so layout doesn't snap.
    this.element.classList.toggle('dui-panel-collapsed', this._collapsed);
  }

  show()    { this.element.classList.add('visible'); this._visible = true; }
  hide()    { this.element.classList.remove('visible'); this._visible = false; }
  toggle()  { this._visible ? this.hide() : this.show(); }
  isVisible() { return !!this._visible; }

  /**
   * Add a folder. Returns the Folder instance for chaining.
   *   const folder = panel.addFolder('Camera');
   *   folder.addSlider('FOV', { ... });
   */
  addFolder(name, opts = {}) {
    if (this.folders[name]) return this.folders[name];
    const folder = new Folder(name, opts);
    // Back-link so the folder can find ui._undo and auto-wrap onChange
    // handlers with undo recording. Without this link, the folder runs
    // in passthrough mode (no undo) — which is what happens before
    // index.js wires `panel.ui = ui` (early controls added by workflows
    // get their undo wiring on the first interaction once ui exists).
    folder.panel = this;
    this.folders[name] = folder;
    this.body.appendChild(folder.element);
    return folder;
  }

  getFolder(name) { return this.folders[name]; }

  removeFolder(name) {
    const f = this.folders[name];
    if (f) { f.dispose(); delete this.folders[name]; }
  }

  dispose() {
    _panelRegistry.delete(this);
    Object.values(this.folders).forEach(f => f.dispose());
    this.element.remove();
  }
}
