/**
 * Injected CSS for Ghost Panel. Styled to match shadcn/ui design tokens —
 * neutral zinc palette, HSL-based theming, system font stack.
 *
 * All tokens live as CSS custom properties on .ghost-panel. Override any
 * of them in your own CSS to retheme, or use the built-in THEMES export.
 *
 * Reference: https://ui.shadcn.com/docs/theming
 */
const CSS = /* css */ `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root {
  /* Tabular numeric font — used for slider readouts, hex values, number
     inputs, monospace labels, anything where digits should line up and
     read with a slight ghosty-utilitarian character. Falls back to the
     OS native monospace if IBM Plex Mono hasn't loaded yet. */
  --dui-font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

.ghost-panel {
  /* ── shadcn-style design tokens (HSL components, no commas/percent) ── */
  --background:             240 6% 9%;        /* zinc-950ish */
  --foreground:             0 0% 98%;
  --card:                   240 6% 11%;
  --card-foreground:        0 0% 98%;
  --muted:                  240 5% 15%;
  --muted-foreground:       240 4% 60%;
  --border:                 240 5% 18%;
  --input:                  240 5% 16%;
  --primary:                0 0% 98%;
  --primary-foreground:     240 6% 10%;
  --secondary:              240 5% 16%;
  --secondary-foreground:   0 0% 98%;
  --accent:                 240 5% 18%;
  --accent-foreground:      0 0% 98%;
  --destructive:            0 63% 31%;
  --destructive-foreground: 0 0% 98%;
  --ring:                   240 5% 65%;
  --radius:                 0.5rem;

  /* Layout */
  position: fixed; z-index: 9999;
  background: hsl(var(--card) / 0.96);
  color: hsl(var(--card-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  box-shadow: 0 10px 38px -10px rgba(0, 0, 0, 0.35),
              0 10px 20px -15px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  display: none;
  /* overflow visible so child elements anchored to the outer edges (e.g. the
     contextual mini toolbar at right:100%) can extend beyond the panel rect. */
  overflow: visible;
  max-height: 92vh;
  pointer-events: auto;

  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
               'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  font-feature-settings: 'cv11', 'ss01';
  -webkit-font-smoothing: antialiased;
}
.ghost-panel.visible {
  display: flex; flex-direction: column;
  animation: dui-panel-in 0.22s cubic-bezier(0.32, 0.72, 0.24, 1.05);
}
.ghost-panel.dui-right { top: 16px; right: 16px; width: 320px; }
.ghost-panel.dui-left  { top: 16px; left: 16px;  width: 280px; }
.ghost-panel * { box-sizing: border-box; }

/* ── Style isolation ───────────────────────────────────────────────────
   Every Ghost Panel root that mounts to document.body inherits the host
   page's typography by default — body { font-family: Georgia }, or a
   universal * { letter-spacing: 0.05em }, or html { font-size: 18px }
   will silently deviate our UI from the design we shipped. This block
   resets every inheritance-prone property on every root to known-good
   values, then forces descendants to inherit from us. Keep the comma
   list in sync with anything that does document.body.appendChild(). */
.ghost-panel,
.dui-context-toolbar,
.dui-camera-badge,
.dui-camera-grid,
.dui-add-menu,
.dui-export-menu,
.dui-modal-host,
.dui-modal-backdrop,
.dui-toast-host,
.dui-color-popover,
.dui-combo-popover,
.dui-easing-popover,
.dui-tooltip,
.dui-bind-popup,
.dui-context-menu,
.dui-modal-hint,
.dui-toolbar,
.dui-demo-switcher,
.dui-gizmo-2d,
.dui-diag-overlay {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
               'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  font-weight: 400;
  font-style: normal;
  font-variant: normal;
  line-height: 1.4;
  letter-spacing: 0;
  word-spacing: normal;
  text-align: left;
  text-transform: none;
  text-decoration: none;
  text-indent: 0;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  direction: ltr;
  color: hsl(var(--card-foreground, 0 0% 98%));
}

/* Force descendants to inherit our typography rather than picking up
   host-page universal rules. Specificity (0,1,1) outscores plain
   universal selectors like body's * { font-family: ... }. We only
   reset font-family here — resetting every typography prop on every
   node would clobber intentional variations (hex monospace inputs,
   icon glyph sizing, etc.). */
.ghost-panel *,
.dui-context-toolbar *,
.dui-camera-badge *,
.dui-add-menu *,
.dui-export-menu *,
.dui-modal-host *,
.dui-toast-host *,
.dui-color-popover *,
.dui-combo-popover *,
.dui-easing-popover *,
.dui-tooltip *,
.dui-bind-popup *,
.dui-context-menu *,
.dui-modal-hint *,
.dui-toolbar *,
.dui-demo-switcher *,
.dui-diag-overlay *,
.dui-augment-bar * {
  font-family: inherit;
  box-sizing: border-box;
}

/* ── Form element isolation ─────────────────────────────────────────────
   Host CSS resets (Tailwind preflight, Bootstrap reboot, Material reset,
   shadcn globals, etc.) routinely strip button / input / select
   defaults — setting transparent backgrounds, zeroing padding/border,
   even applying all-unset. Page-specific rules like
   .app button (background: black; color: white) leak into our
   controls too because plain element selectors apply everywhere —
   including inside our panels.

   Counter-measure: reset every form element inside every Ghost Panel root
   to a known baseline (transparent background, no padding/margin/border,
   inherited typography). Our .dui-btn / .dui-number-input / etc. class
   rules then layer their intended styles on top. Specificity (0,1,1)
   beats any plain button host rule (0,0,1) and ties with
   .app-button host rules (0,1,1) — when tied, our injection order
   wins because styles get appended late at panel construction. */
.ghost-panel button:not([class*="dui-"]),
.ghost-panel input:not([class*="dui-"]),
.ghost-panel select:not([class*="dui-"]),
.ghost-panel textarea:not([class*="dui-"]),
.dui-context-toolbar button:not([class*="dui-"]),
.dui-context-toolbar input:not([class*="dui-"]),
.dui-context-toolbar select:not([class*="dui-"]),
.dui-camera-badge button:not([class*="dui-"]),
.dui-add-menu button:not([class*="dui-"]),
.dui-add-menu input:not([class*="dui-"]),
.dui-export-menu button:not([class*="dui-"]),
.dui-modal-host button:not([class*="dui-"]),
.dui-modal-host input:not([class*="dui-"]),
.dui-modal-host textarea:not([class*="dui-"]),
.dui-color-popover button:not([class*="dui-"]),
.dui-color-popover input:not([class*="dui-"]),
.dui-combo-popover button:not([class*="dui-"]),
.dui-combo-popover input:not([class*="dui-"]),
.dui-easing-popover button:not([class*="dui-"]),
.dui-bind-popup button:not([class*="dui-"]),
.dui-context-menu button:not([class*="dui-"]),
.dui-toolbar button:not([class*="dui-"]),
.dui-demo-switcher button:not([class*="dui-"]) {
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-family: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  text-transform: none;
  text-decoration: none;
  line-height: inherit;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  border-radius: 0;
  box-shadow: none;
  box-sizing: border-box;
}
.ghost-panel button:not([class*="dui-"]),
.dui-context-toolbar button:not([class*="dui-"]),
.dui-camera-badge button:not([class*="dui-"]),
.dui-add-menu button:not([class*="dui-"]),
.dui-export-menu button:not([class*="dui-"]),
.dui-modal-host button:not([class*="dui-"]),
.dui-color-popover button:not([class*="dui-"]),
.dui-combo-popover button:not([class*="dui-"]),
.dui-easing-popover button:not([class*="dui-"]),
.dui-bind-popup button:not([class*="dui-"]),
.dui-context-menu button:not([class*="dui-"]),
.dui-toolbar button:not([class*="dui-"]),
.dui-demo-switcher button:not([class*="dui-"]) {
  cursor: pointer;
}
/* Strip the spinner arrows on number inputs — they're visually noisy
   inside our compact rows and most hosts hide them anyway. */
.ghost-panel input[type='number']::-webkit-outer-spin-button,
.ghost-panel input[type='number']::-webkit-inner-spin-button,
.dui-context-toolbar input[type='number']::-webkit-outer-spin-button,
.dui-context-toolbar input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none; margin: 0;
}
.ghost-panel input[type='number'],
.dui-context-toolbar input[type='number'] {
  -moz-appearance: textfield;
}
/* Anchors and labels: never inherit host underlines / colors. */
.ghost-panel a,
.dui-add-menu a,
.dui-export-menu a,
.dui-modal-host a {
  color: inherit;
  text-decoration: none;
  background: transparent;
}
.ghost-panel label,
.dui-context-toolbar label,
.dui-add-menu label,
.dui-modal-host label {
  font: inherit;
  color: inherit;
  margin: 0;
  padding: 0;
}

@keyframes dui-panel-in {
  from { opacity: 0; transform: translateY(-6px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0)    scale(1);     }
}
/* Right-side panels slide in from the right edge */
.ghost-panel.dui-right.visible { animation-name: dui-panel-in-right; }
@keyframes dui-panel-in-right {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0);    }
}
.ghost-panel.dui-left.visible { animation-name: dui-panel-in-left; }
@keyframes dui-panel-in-left {
  from { opacity: 0; transform: translateX(-12px); }
  to   { opacity: 1; transform: translateX(0);     }
}

/* Scrollable body (header stays fixed when content overflows). The body's
   own max-height drives the panel collapse animation — when the panel has
   the dui-panel-collapsed class the body shrinks to 0 and fades out. */
.dui-panel-body {
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  border-bottom-left-radius: inherit;
  border-bottom-right-radius: inherit;
  max-height: 92vh;
  opacity: 1;
  transition:
    max-height 0.26s cubic-bezier(0.32, 0.72, 0, 1),
    opacity    0.18s ease;
}
.ghost-panel.dui-panel-collapsed .dui-panel-body {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
}
.dui-panel-body::-webkit-scrollbar { width: 6px; }
.dui-panel-body::-webkit-scrollbar-thumb {
  background: hsl(var(--muted)); border-radius: 3px;
}

/* ── Header ── */
.dui-header {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: hsl(var(--foreground));
  border-bottom: 1px solid hsl(var(--border));
  display: flex; justify-content: space-between; align-items: center;
  cursor: grab;
  flex-shrink: 0;
}
.dui-header:active { cursor: grabbing; }
/* Left-align the title. The health dot (if present) sits at the very left
   with its own 4px right-margin, so margin-right:auto parks the title
   directly beside it and pushes the action buttons to the far right. */
.dui-header-title {
  margin-right: auto;
}
.dui-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.dui-header-btn {
  background: transparent;
  color: hsl(var(--muted-foreground));
  border: none;
  width: 22px; height: 22px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; line-height: 1;
  font-family: inherit;
  transition: background 0.15s ease, color 0.15s ease;
  padding: 0;
}
.dui-header-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

/* ── Folder (shadcn Accordion-style) ── */
.dui-folder { border-bottom: 1px solid hsl(var(--border)); }
.dui-folder:last-child { border-bottom: none; }
.dui-folder-header {
  /* Tighter vertical padding (8px → was 10px) — a stack of collapsed
     folders is the dominant view when the user shrinks the panel, and
     two pixels per header adds up quickly. */
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: hsl(var(--foreground));
  cursor: pointer;
  display: flex; justify-content: space-between; align-items: center;
  transition: background 0.15s ease;
}
.dui-folder-header:hover { background: hsl(var(--muted) / 0.4); }
.dui-folder-header .dui-arrow {
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  transition: transform 0.2s ease;
  display: inline-block;
}
.dui-folder.dui-collapsed .dui-arrow { transform: rotate(-90deg); }

/* Folder collapse animation — uses max-height ceiling + opacity. The ceiling
   is set high enough to cover any folder body in this UI (1200px); the
   transition still feels snappy because the eased curve front-loads motion. */
.dui-folder-body {
  overflow: hidden;
  padding: 4px 16px 14px;
  max-height: 1200px;
  transition:
    max-height 0.24s cubic-bezier(0.32, 0.72, 0, 1),
    padding    0.24s cubic-bezier(0.32, 0.72, 0, 1),
    opacity    0.16s ease;
}
/* Higher-specificity collapsed override so the liquid-glass theme rule
   (.ghost-panel.dui-liquid-glass .dui-folder-body) doesn't win and
   leave behind a ~18px "ghost" body of residual padding. The chained
   .ghost-panel selector matches both the default and liquid-glass
   panels — collapsed always wins. */
.dui-folder.dui-collapsed .dui-folder-body,
.ghost-panel .dui-folder.dui-collapsed .dui-folder-body,
.ghost-panel.dui-liquid-glass .dui-folder.dui-collapsed .dui-folder-body {
  max-height: 0;
  padding-top: 0; padding-bottom: 0;
  opacity: 0;
}

/* Headerless folders (e.g. the Scene Outliner). The host panel already
   labels what's inside, so we hide our own bottom-border divider too —
   the section just blends into the panel. Body keeps its normal padding
   so list rows don't crowd the panel edges. */
.dui-folder.dui-folder-headerless { border-bottom: none; }
/* Dynamic folders (Material / Light / Properties / Camera Settings) added
   on real selection changes get a gentle slide-in. Folders that are part
   of the static panel layout are tagged dui-folder-permanent by the
   panel builder so they DO NOT animate on every paint. */
.dui-folder:not(.dui-folder-permanent) {
  animation: dui-folder-in 0.22s cubic-bezier(0.32, 0.72, 0.24, 1.05);
}
@keyframes dui-folder-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0);    }
}
/* Rows inside folders DO NOT auto-animate — that staggered entry was firing
   any time the contextual flow re-rendered, which felt jarring on hover
   and during gizmo drags. Add the class explicitly per-row when you want it. */
.dui-folder-row-animated {
  animation: dui-row-in 0.18s ease both;
}
@keyframes dui-row-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0);    }
}

/* ── Row ── */
.dui-row {
  display: flex; align-items: center; gap: 8px;
  margin: 8px 0;
}
.dui-row label {
  flex-shrink: 0; width: 72px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Custom color swatch + popover (replaces the OS-native input[type=color]
   so the look matches the rest of the tool). The swatch is a thin rounded
   bar; clicking it opens a dark translucent popover with SV square, hue
   strip, and hex input. */
.dui-color-row .dui-color-swatch {
  display: block;
  height: 22px;
  border-radius: 6px;
  border: 1px solid hsl(0 0% 100% / 0.12);
  cursor: pointer;
  transition: border-color 0.12s ease, transform 0.12s ease;
  box-shadow: 0 1px 2px hsl(0 0% 0% / 0.3);
  padding: 0;
}
.dui-color-row .dui-color-swatch:hover {
  border-color: hsl(0 0% 100% / 0.3);
  transform: scale(1.01);
}
.dui-color-row .dui-color-swatch:focus,
.dui-color-row .dui-color-swatch:focus-visible {
  outline: none;
  border-color: hsl(0 0% 100% / 0.4);
}

.dui-color-popover {
  position: fixed;
  z-index: 99997;
  width: 220px;
  padding: 10px;
  background: hsl(0 0% 8% / 0.94);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.14);
  border-radius: 10px;
  box-shadow:
    0 1px 0 hsl(0 0% 100% / 0.08) inset,
    0 18px 38px hsl(0 0% 0% / 0.55);
  color: hsl(0 0% 96%);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px) scale(0.98);
  transform-origin: top left;
  transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.32, 0.72, 0.24, 1.2);
}
.dui-color-popover.dui-color-popover-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}
/* Suppress every browser-default focus outline inside the popover —
   pointer-capture on the SV / hue strip can otherwise paint a red ring
   that conflicts with the picker's chrome. */
.dui-color-popover *,
.dui-color-popover *:focus,
.dui-color-popover *:focus-visible {
  outline: none !important;
  -webkit-tap-highlight-color: transparent;
}

/* SV (saturation/value) square — layered gradients on top of the
   hue-driven base color so saturation rises left→right, value rises
   bottom→top. The frame uses an inset box-shadow instead of a real
   border so the high-saturation gradient corners can't visually
   "bleed" onto the perimeter (which read as a red outline before). */
.dui-color-sv {
  position: relative;
  width: 100%; height: 140px;
  border-radius: 6px;
  overflow: hidden;
  cursor: crosshair;
  border: none;
  box-shadow:
    inset 0 0 0 1px hsl(0 0% 0% / 0.5),
    inset 0 0 0 2px hsl(0 0% 100% / 0.06);
  touch-action: none;
}
.dui-color-sv-saturation,
.dui-color-sv-value {
  position: absolute; inset: 0;
  pointer-events: none;
}
.dui-color-sv-saturation {
  background: linear-gradient(to right, #fff, transparent);
}
.dui-color-sv-value {
  background: linear-gradient(to top, #000, transparent);
}
.dui-color-sv-pointer {
  position: absolute;
  width: 12px; height: 12px;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 0 0 1px hsl(0 0% 0% / 0.5), 0 1px 3px hsl(0 0% 0% / 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* Hue strip — full rainbow gradient. Same dark inset frame as the SV
   square so the picker reads as a coordinated unit. */
.dui-color-hue {
  position: relative;
  width: 100%; height: 12px;
  margin-top: 10px;
  border-radius: 6px;
  cursor: ew-resize;
  background: linear-gradient(to right,
    #ff0000 0%, #ffff00 17%, #00ff00 33%,
    #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);
  border: none;
  box-shadow:
    inset 0 0 0 1px hsl(0 0% 0% / 0.5),
    inset 0 0 0 2px hsl(0 0% 100% / 0.06);
  touch-action: none;
}
.dui-color-hue-thumb {
  position: absolute;
  top: 50%;
  width: 10px; height: 14px;
  border-radius: 3px;
  border: 2px solid white;
  background: transparent;
  box-shadow: 0 0 0 1px hsl(0 0% 0% / 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.dui-color-hex-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  background: hsl(0 0% 100% / 0.06);
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 6px;
  padding: 4px 8px;
}
.dui-color-hex-prefix {
  font-family: var(--dui-font-mono);
  font-size: 11.5px;
  color: hsl(0 0% 100% / 0.4);
}
.dui-color-hex {
  flex: 1;
  background: transparent;
  border: none;
  color: hsl(0 0% 96%);
  font-family: var(--dui-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  outline: none;
  padding: 0;
}

/* dialkit-style slider — drag-anywhere horizontal track + inline LABEL
   on the left, inline value on the right. Both texts use mix-blend-mode:
   difference (see .dui-slider-label / .dui-slider-value rules) so they
   stay readable as the white fill bar slides under them — no contrast
   washout when the user drags past the value. The external row label is
   hidden (see .dui-slider-row > label below) so the slider chrome IS the
   row, saving the 72px label gutter the panel used to reserve. */
.ghost-panel.ghost-panel.ghost-panel .dui-slider-row {
  /* External label is no longer shown; let the slider span full row.
     Doubled .ghost-panel outscores the liquid-glass theme rule
     (.dui-liquid-glass .dui-row sets its own margin and gap that we
     would otherwise inherit). */
  gap: 0;
  margin: 4px 0;
}
.ghost-panel.ghost-panel.ghost-panel .dui-slider-row > label { display: none; }
.dui-slider-row .dui-slider {
  flex: 1;
  position: relative;
  height: 30px;
  border-radius: 6px;
  background: hsl(0 0% 100% / 0.05);
  border: 1px solid hsl(0 0% 100% / 0.06);
  cursor: ew-resize;
  user-select: none;
  outline: none;
  overflow: hidden;
  transition: background 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              border-color 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-slider:hover  { background: hsl(0 0% 100% / 0.08); }
.dui-slider:focus,
.dui-slider.dui-slider-active {
  background: hsl(0 0% 100% / 0.1);
  border-color: hsl(0 0% 100% / 0.18);
}
.dui-slider-fill {
  position: absolute;
  inset: 0;
  width: 0%;
  /* White at 15% — the requested resting color. Brightens slightly on
     hover/drag for affordance without ever competing with the panel chrome. */
  background: hsl(0 0% 100% / 0.15);
  pointer-events: none;
  /* Stacking order inside the slider chrome:
     0: fill (this rule)        — the moving bar
     1: ticks + indicator       — scale markers + current-value pip
     2: label + value (text)    — always on top
     This makes the fill SLIDE BEHIND the inline label and the value
     readout, never overlapping their pixels. Combined with the text's
     mix-blend-mode: difference, the result is a clean fill bar that
     glides under the text without obliterating it. */
  z-index: 0;
  transition: width 0.06s linear, background 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-slider:hover .dui-slider-fill            { background: hsl(0 0% 100% / 0.20); }
.dui-slider.dui-slider-active .dui-slider-fill { background: hsl(0 0% 100% / 0.25); }
.dui-slider.dui-slider-dragging .dui-slider-fill { transition: background 0.16s ease; }

/* Scale ticks — invisible at rest; fade in on hover/drag so the user gets
   the scale and current-value cue without visual noise the rest of the time. */
.dui-slider-ticks {
  position: absolute; inset: 0;
  pointer-events: none;
  opacity: 0;
  z-index: 1;            /* above the fill (z:0), below the text (z:2) */
  transition: opacity 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-slider:hover .dui-slider-ticks,
.dui-slider:focus .dui-slider-ticks,
.dui-slider.dui-slider-active .dui-slider-ticks {
  opacity: 1;
}
.dui-slider-tick {
  position: absolute;
  top: 50%;
  width: 1px; height: 8px;
  background: hsl(0 0% 100% / 0.35);
  transform: translate(-50%, -50%);
}

/* Current-value indicator — a slim white bar at the value position. Fades
   in with the ticks so the user sees "where am I on the scale". */
.dui-slider-indicator {
  position: absolute;
  top: 50%;
  left: 0%;
  width: 2px;
  height: 14px;
  background: hsl(0 0% 100%);
  border-radius: 1px;
  box-shadow: 0 0 4px hsl(0 0% 0% / 0.6);
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0;
  z-index: 1;            /* above the fill, below the text — text always wins */
  transition:
    left 0.06s linear,
    opacity 0.16s cubic-bezier(0.32, 0.72, 0, 1),
    height 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-slider:hover .dui-slider-indicator,
.dui-slider:focus .dui-slider-indicator,
.dui-slider.dui-slider-active .dui-slider-indicator {
  opacity: 1;
}
.dui-slider.dui-slider-active .dui-slider-indicator { height: 18px; }
.dui-slider.dui-slider-dragging .dui-slider-indicator { transition: opacity 0.16s ease, height 0.16s ease; }
/* When the indicator overlaps the value-text zone (right edge of the
   slider), drop to 50% opacity so the number stays readable. The
   value text is z-index: 2 with mix-blend-mode: difference, so it
   sits on top; the dim just removes visual competition. The dim
   selectors override the hover/focus/active 100% rules above. */
.dui-slider:hover .dui-slider-indicator.dui-slider-indicator-dim,
.dui-slider:focus .dui-slider-indicator.dui-slider-indicator-dim,
.dui-slider.dui-slider-active .dui-slider-indicator.dui-slider-indicator-dim {
  opacity: 0.5;
}
/* Inline label on the left of the slider — pure white at full opacity
   with a soft dark text-shadow halo so it stays legible no matter where
   the fill bar is. (Previously used mix-blend-mode: difference, which
   muddied the text whenever the fill slid under it. Text-shadow keeps
   the white crisp instead of dimming it.) Same treatment as the value
   readout below so both ends of the slider read consistently. */
.dui-slider-label {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-family: inherit;
  font-size: 11px;
  color: hsl(0 0% 100%);
  text-shadow:
    0 0 4px hsl(0 0% 0% / 0.7),
    0 1px 2px hsl(0 0% 0% / 0.55);
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  z-index: 2;
}
.dui-slider-value {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  /* IBM Plex Mono for numeric readouts — slight ghosty character that
     matches the panel name, tabular-nums so digits line up cleanly. */
  font-family: var(--dui-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  /* Pure white at full opacity, always — the value is the active read-
     out and must stay legible no matter where the fill bar is. The
     subtle dark text-shadow gives it a halo that survives the 15-25%
     white fill sliding under it, so the digits don't wash out the way
     mix-blend-mode: difference used to make them. */
  color: hsl(0 0% 100%);
  text-shadow:
    0 0 4px hsl(0 0% 0% / 0.7),
    0 1px 2px hsl(0 0% 0% / 0.55);
  font-weight: 500;
  pointer-events: auto;
  cursor: text;
  letter-spacing: 0;
  z-index: 2;
}
.dui-slider-editor {
  position: absolute;
  right: 6px; top: 50%;
  transform: translateY(-50%);
  width: 60px; height: 18px;
  background: hsl(0 0% 0% / 0.5);
  border: 1px solid hsl(0 0% 100% / 0.25);
  border-radius: 4px;
  color: hsl(0 0% 100%);
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  text-align: right;
  padding: 0 6px;
  outline: none;
}

/* Inline label chip — sits on the LEFT inside an input's chrome so the
   external row label can be hidden. Dim, small, never wraps. Pointer
   events are off so clicking the label falls through to the input the
   chip is annotating (focus the field, not the label). */
.dui-inline-label {
  color: hsl(0 0% 100% / 0.55);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 400;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  flex: none;
}

/* Number / text / select rows all hide the external label and pull the
   inline chip + control into a shared chrome. The chip is grouped with
   the control via flex so they form one rounded box.

   Selectors are doubled on .ghost-panel (i.e. .ghost-panel.ghost-panel)
   so they outscore liquid-glass theme rules like the one that targets
   .ghost-panel.dui-liquid-glass .dui-row input — without that bump
   the theme chrome leaks through and you get a double-bordered input. */
/* Single flat chrome for ALL non-slider inputs — same look as the
   slider track, so the panel reads as one consistent vocabulary
   rather than "rows + boxes-within-rows". Matches the slider's
   resting state: white at 5% over the panel, 6% border. The input
   itself is fully transparent, so the row IS the chrome. */
.ghost-panel.ghost-panel.ghost-panel .dui-number-row,
.ghost-panel.ghost-panel.ghost-panel .dui-text-row,
.ghost-panel.ghost-panel.ghost-panel .dui-select-row {
  display: flex;
  align-items: center;
  gap: 0;
  margin: 4px 0;
  background: hsl(0 0% 100% / 0.05);
  border: 1px solid hsl(0 0% 100% / 0.06);
  border-radius: 6px;
  padding: 0 10px;
  height: 30px;
  transition: background 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              border-color 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.ghost-panel.ghost-panel.ghost-panel .dui-number-row > label,
.ghost-panel.ghost-panel.ghost-panel .dui-text-row  > label,
.ghost-panel.ghost-panel.ghost-panel .dui-select-row > label { display: none; }
.ghost-panel.ghost-panel.ghost-panel .dui-number-row:hover,
.ghost-panel.ghost-panel.ghost-panel .dui-text-row:hover,
.ghost-panel.ghost-panel.ghost-panel .dui-select-row:hover {
  background: hsl(0 0% 100% / 0.08);
}
/* Edit state — when the user clicks the row (focuses the input), brighten
   the chrome subtly. This is the "edit" affordance the user asked for. */
.ghost-panel.ghost-panel.ghost-panel .dui-number-row:focus-within,
.ghost-panel.ghost-panel.ghost-panel .dui-text-row:focus-within,
.ghost-panel.ghost-panel.ghost-panel .dui-select-row:focus-within {
  background: hsl(0 0% 100% / 0.1);
  border-color: hsl(0 0% 100% / 0.18);
}

/* Inputs themselves lose their own chrome — the row provides it.
   The liquid-glass theme adds bg + border to inputs via a rule like
   .dui-liquid-glass .dui-row input[type=number], which beats the
   single-class transparent rule on specificity. We bump to triple
   .ghost-panel + !important so it wins everywhere. */
.ghost-panel.ghost-panel.ghost-panel .dui-number-row .dui-number-input,
.ghost-panel.ghost-panel.ghost-panel .dui-text-row    > input[type="text"],
.ghost-panel.ghost-panel.ghost-panel .dui-select-row  > select {
  flex: 1; min-width: 0;
  background: transparent !important;
  border: 0 !important;
  outline: none;
  box-shadow: none !important;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  padding: 0 0 0 8px;
  text-align: right;
  margin-left: auto;
  height: auto;
  width: auto;
}
.ghost-panel.ghost-panel.ghost-panel .dui-select-row > select {
  appearance: none; -webkit-appearance: none;
  cursor: pointer;
  padding-right: 14px;
}

/* Custom dropdown trigger (replaces native <select> chrome). Sits
   inside the select-row container as a fully transparent button —
   the row itself provides the rounded chrome. */
.dui-select-trigger {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 6px;
  flex: 1; min-width: 0;
  background: transparent;
  border: 0; outline: none;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-size: 12.5px;
  padding: 0 0 0 8px;
  height: 100%;
  cursor: pointer;
  text-align: right;
}
.dui-select-value {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dui-select-chevron {
  color: hsl(0 0% 100% / 0.55);
  flex: none;
  transition: transform 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-select-row.dui-select-open .dui-select-chevron { transform: rotate(180deg); }

/* Custom dropdown popover — extends the .dui-combo-popover chrome
   already shipped for the typography combos so dropdowns and combos
   feel like one family. Adds a check-mark column for the currently-
   selected option (hidden by default; only visible on .dui-active). */
.dui-select-popover { padding: 4px; }
.dui-select-option { padding-left: 8px; }
.dui-select-option .dui-select-check {
  color: hsl(0 0% 100% / 0);
  flex: none;
  transition: color 0.1s ease;
}
.dui-select-option.dui-active .dui-select-check {
  color: hsl(0 0% 100%);
}
.dui-select-option.dui-active {
  background: hsl(0 0% 100% / 0.08);
  color: hsl(0 0% 100%);
}
.ghost-panel.ghost-panel.ghost-panel .dui-text-row > input[type="text"] {
  text-align: left;
  padding-left: 8px;
}
/* Old per-input hover/focus rules are obsolete now that the ROW owns
   the chrome — those states are handled on .dui-number-row:hover and
   :focus-within above. Kept the spin-button reset as it still applies. */

/* ── Corner-radius widget (Figma-style) ──────────────────────────────
   A uniform field plus a 2x2 grid of per-corner fields, with a toggle
   on the right to switch between linked and independent editing. Each
   field is a flex row of "corner icon + numeric input" so the icon
   reads as a visual hint for which corner is being edited. */
.dui-cr-row {
  /* The widget breaks the standard row's single-line layout, so we
     stack it under the label and let it span the full content width. */
  flex-direction: column;
  align-items: stretch;
}
.dui-cr-row > label {
  margin-bottom: 6px;
  width: auto; flex: none;
}
.dui-cr {
  display: flex; flex-direction: column;
  gap: 6px;
}
.dui-cr-head {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: center;
}
.dui-cr-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.dui-cr-grid[hidden] { display: none; }
.dui-cr-field {
  display: flex; align-items: center; gap: 6px;
  padding: 0 8px;
  height: 28px;
  background: hsl(0 0% 100% / 0.05);
  border: 1px solid hsl(0 0% 100% / 0.06);
  border-radius: 6px;
  transition: background 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              border-color 0.16s cubic-bezier(0.32, 0.72, 0, 1);
  /* Equal-column grid: clamp min-width so cells split 50:50 regardless
     of content width. Same trick as .dui-paired-cell. */
  min-width: 0;
}
.dui-cr-field:hover { background: hsl(0 0% 100% / 0.08); }
.dui-cr-field:focus-within {
  background: hsl(0 0% 100% / 0.1);
  border-color: hsl(0 0% 100% / 0.18);
}
.ghost-panel.ghost-panel.ghost-panel .dui-cr-field input {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}
.dui-cr-icon {
  color: hsl(0 0% 100% / 0.55);
  display: inline-flex; align-items: center; justify-content: center;
  flex: none;
}
.dui-cr-input {
  flex: 1; min-width: 0;
  background: transparent;
  border: 0; outline: none;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  padding: 0;
}
.dui-cr-input::-webkit-outer-spin-button,
.dui-cr-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.dui-cr-toggle {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  color: hsl(0 0% 100% / 0.6);
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease, border-color 0.12s ease;
}
.dui-cr-toggle:hover {
  color: hsl(0 0% 100% / 0.9);
  background: hsl(var(--input) / 0.6);
}
.dui-cr-toggle.dui-active {
  color: hsl(var(--ring));
  border-color: hsl(var(--ring) / 0.55);
  background: hsl(var(--ring) / 0.12);
}
/* While unlinked, dim the uniform field — the per-corner inputs are
   the real source of truth in this mode. */
.dui-cr-unlinked .dui-cr-uniform { opacity: 0.55; }

/* ── Dimensions widget (W / H + aspect lock) ─────────────────────────
   Same shape as the corner-radius widget: a fields cluster on the left
   and a single toggle button on the right that gates whether changing
   one dimension scales the other. Reuses .dui-paired-cell from the
   typography section for the W / H boxes. */
.dui-dim-row { flex-direction: column; align-items: stretch; }
.dui-dim-row > label { margin-bottom: 6px; width: auto; flex: none; }
.dui-dim {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  align-items: stretch;
}
.dui-dim-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.dui-dim .dui-paired-icon {
  font-weight: 600;
  font-size: 11.5px;
  color: hsl(0 0% 100% / 0.55);
  letter-spacing: 0;
  width: 13px;
  text-align: center;
}
.dui-dim-lock {
  width: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  color: hsl(0 0% 100% / 0.6);
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease, border-color 0.12s ease;
}
.dui-dim-lock:hover {
  color: hsl(0 0% 100% / 0.9);
  background: hsl(var(--input) / 0.6);
}
.dui-dim-lock.dui-active {
  color: hsl(0 0% 100%);
  border-color: hsl(0 0% 100% / 0.22);
  background: hsl(0 0% 100% / 0.18);
}

/* ── Typography widget (Figma-style) ────────────────────────────────
   Paired-cell rows (two compact fields side-by-side) plus an alignment
   strip with horizontal-text and vertical-flex groups, and a leading
   icon convention for line-height / letter-spacing / size fields. */
.dui-row.dui-row-paired {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  align-items: center;
}
.dui-row.dui-row-paired.dui-row-pair-1 { grid-template-columns: 1fr; }
.dui-row.dui-row-paired.dui-row-pair-3 { grid-template-columns: repeat(3, 1fr); }
.dui-row.dui-row-paired.dui-row-pair-4 { grid-template-columns: repeat(4, 1fr); }
.dui-paired-cell {
  display: flex; align-items: center; gap: 6px;
  padding: 0 8px;
  height: 28px;
  /* Match the slider chrome — single flat container. The input child
     stays fully transparent (see triple-class rule below) so we never
     end up with "box within box". */
  background: hsl(0 0% 100% / 0.05);
  border: 1px solid hsl(0 0% 100% / 0.06);
  border-radius: 6px;
  transition: background 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              border-color 0.16s cubic-bezier(0.32, 0.72, 0, 1);
  /* Grid items default to min-width: auto, which means a cell with
     wider intrinsic content (e.g. a <select> with "Extra Light" as an
     option) will widen past its 1fr allocation. Clamping to 0 forces
     the grid to split the row evenly — 50:50 for two cells, 33% for
     three, etc. The flex children inside still get the leftover space. */
  min-width: 0;
}
.dui-paired-cell:hover { background: hsl(0 0% 100% / 0.08); }
.dui-paired-cell:focus-within {
  background: hsl(0 0% 100% / 0.1);
  border-color: hsl(0 0% 100% / 0.18);
}
/* Strip theme-injected chrome from inputs / selects inside paired
   cells (liquid-glass adds a bg + border that would re-introduce the
   container-within-container look). */
.ghost-panel.ghost-panel.ghost-panel .dui-paired-cell input,
.ghost-panel.ghost-panel.ghost-panel .dui-paired-cell select {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  padding: 0;
}
.dui-paired-cell input,
.dui-paired-cell select {
  flex: 1; min-width: 0;
  background: transparent;
  border: 0; outline: none;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  padding: 0;
}
/* When a paired cell uses an inline label chip (rather than a leading
   icon), right-align the numeric value the way Figma does so a column
   of paired rows reads as a clean number stack. */
.dui-paired-cell > .dui-inline-label + .dui-paired-input {
  text-align: right;
}
.dui-paired-cell select { appearance: none; -webkit-appearance: none; cursor: pointer; }
.dui-paired-cell input::-webkit-outer-spin-button,
.dui-paired-cell input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.dui-paired-icon {
  color: hsl(0 0% 100% / 0.55);
  display: inline-flex; align-items: center; justify-content: center;
  flex: none;
  font-size: 11px;
  width: 13px; height: 13px;
}
/* The Size cell shows a small "A" glyph as a leading icon (matches the
   Figma reference: a stylized character indicating "font size"). */
.dui-paired-size .dui-paired-icon {
  font-weight: 700;
  font-size: 12px;
  color: hsl(0 0% 100% / 0.65);
}

/* Numeric-field accessibility (see wireNumericFieldA11y in controls.js).
   .dui-field-msg is an SR-only live region: it carries the "reverted" /
   "clamped" announcement for assistive tech without occupying any visual
   space, so the dense panel layout is untouched. The visible cue for sighted
   users is a red ring driven purely by [aria-invalid="true"] — no layout
   shift, cleared the moment the user resumes typing. */
.dui-field-msg {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
/* Standalone inputs carry their own box, so ring them directly. */
.dui-number-input[aria-invalid="true"],
.dui-context-num[aria-invalid="true"] {
  box-shadow: 0 0 0 1.5px hsl(0 78% 62% / 0.9);
  border-radius: 4px;
}
/* Paired / dimension / corner fields are borderless children of a bordered
   cell — the theme strips their own box-shadow with !important (see
   .dui-paired-cell input above) — so flag the *cell* instead, giving a red
   ring that hugs the visible field box. :has() is well-supported in every
   browser the panel targets. */
.dui-paired-cell:has(input[aria-invalid="true"]),
.dui-cr-field:has(.dui-cr-input[aria-invalid="true"]) {
  box-shadow: 0 0 0 1.5px hsl(0 78% 62% / 0.9);
  border-radius: 6px;
}

/* Typeable-with-presets combo cell. Same chrome as a regular paired
   cell, plus a small chevron button on the right that opens a preset
   popover. The user can either type a custom value or pick a preset
   — matches Figma's hybrid number-with-dropdown editor. */
.dui-paired-combo { padding-right: 4px; }
.dui-paired-combo .dui-paired-input {
  flex: 1; min-width: 0;
  background: transparent;
  border: 0; outline: none;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  padding: 0;
  text-align: right;
}
.dui-paired-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 22px;
  background: transparent;
  border: 0; outline: none;
  border-radius: 4px;
  color: hsl(0 0% 100% / 0.55);
  cursor: pointer;
  flex: none;
  transition: color 0.12s ease, background 0.12s ease;
}
.dui-paired-chevron:hover { color: hsl(0 0% 100%); background: hsl(0 0% 100% / 0.06); }
.dui-paired-combo.dui-combo-open .dui-paired-chevron {
  color: hsl(0 0% 100%);
  background: hsl(0 0% 100% / 0.08);
}

/* Combo popover — preset list anchored under the cell. Same dark glass
   chrome as the easing popover so they feel like one family. */
.dui-combo-popover {
  position: fixed;
  z-index: 10001;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  background: hsl(0 0% 8% / 0.96);
  backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: 8px;
  box-shadow: 0 12px 32px hsl(0 0% 0% / 0.55);
  display: flex; flex-direction: column;
  gap: 2px;
}
.dui-combo-option {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: 0; outline: none;
  border-radius: 5px;
  color: hsl(0 0% 100% / 0.85);
  font: inherit;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease, color 0.1s ease;
}
.dui-combo-option:hover { background: hsl(0 0% 100% / 0.08); }
.dui-combo-option-sub {
  color: hsl(0 0% 100% / 0.45);
  font-size: 11px;
}

/* Multiline text row (used by the Text content field). The textarea
   adopts the same chrome as paired cells so the row reads as one
   unified surface, just taller. */
.dui-text-row-multiline .dui-textarea {
  width: 100%;
  min-height: 32px;
  resize: vertical;
  padding: 6px 8px;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.4;
  outline: none;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.dui-text-row-multiline .dui-textarea:focus {
  border-color: hsl(var(--ring) / 0.7);
  background: hsl(var(--input) / 0.95);
}

/* Alignment row — Figma-style 3+3 group with an italic chip on the
   right. Each group is a segmented control: rounded outer chrome,
   subtle dividers, active state filled with the same semi-transparent
   white the rest of the tool uses. */
.dui-typo-align .dui-typo-align-grid {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 6px;
  align-items: stretch;
}
.dui-typo-align-group {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  overflow: hidden;
}
.dui-typo-align-btn {
  background: transparent;
  border: 0; outline: none;
  height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  color: hsl(0 0% 100% / 0.6);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.dui-typo-align-btn:hover { background: hsl(0 0% 100% / 0.06); color: hsl(0 0% 100%); }
.dui-typo-align-btn.dui-active {
  background: hsl(0 0% 100% / 0.18);
  color: hsl(0 0% 100%);
}
.dui-typo-align-italic {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  color: hsl(0 0% 100% / 0.6);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.dui-typo-align-italic:hover { color: hsl(0 0% 100%); background: hsl(var(--input) / 0.6); }
.dui-typo-align-italic.dui-active {
  color: hsl(0 0% 100%);
  background: hsl(0 0% 100% / 0.18);
  border-color: hsl(0 0% 100% / 0.22);
}

/* ── Slider (shadcn-style: thin track + filled progress) ── */
.dui-row input[type="range"] {
  flex: 1; height: 18px; min-width: 0;
  background: transparent;
  cursor: pointer;
  appearance: none; -webkit-appearance: none;
  margin: 0;
}
.dui-row input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  background: hsl(var(--muted));
  border-radius: 9999px;
}
.dui-row input[type="range"]::-moz-range-track {
  height: 4px;
  background: hsl(var(--muted));
  border-radius: 9999px;
}
.dui-row input[type="range"]::-webkit-slider-thumb {
  appearance: none; -webkit-appearance: none;
  width: 14px; height: 14px;
  background: hsl(var(--background));
  border: 2px solid hsl(var(--primary));
  border-radius: 50%;
  margin-top: -5px;
  cursor: grab;
  transition: transform 0.1s ease;
}
.dui-row input[type="range"]::-moz-range-thumb {
  width: 14px; height: 14px;
  background: hsl(var(--background));
  border: 2px solid hsl(var(--primary));
  border-radius: 50%;
  cursor: grab;
}
.dui-row input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.1); }
.dui-row input[type="range"]:focus { outline: none; }
.dui-row input[type="range"]:focus::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.4);
}

/* ── Number input (shadcn Input style) ── */
.dui-row input[type="number"] {
  width: 60px; flex-shrink: 0;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--input));
  color: hsl(var(--foreground));
  padding: 4px 8px;
  border-radius: calc(var(--radius) - 2px);
  font-family: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dui-row input[type="number"]:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.2);
}

/* Hide spinner buttons */
.dui-row input[type="number"]::-webkit-inner-spin-button,
.dui-row input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none; margin: 0;
}
.dui-row input[type="number"] { -moz-appearance: textfield; }

/* ── Checkbox (shadcn-style: rounded square) ── */
.dui-row input[type="checkbox"] {
  width: 16px; height: 16px; flex-shrink: 0;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--input));
  border-radius: 3px;
  margin: 0;
  cursor: pointer;
  appearance: none; -webkit-appearance: none;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dui-row input[type="checkbox"]:hover { border-color: hsl(var(--ring)); }
.dui-row input[type="checkbox"]:checked {
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
}
.dui-row input[type="checkbox"]:checked::after {
  content: '';
  width: 5px; height: 9px;
  border: solid hsl(var(--primary-foreground));
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translateY(-1px);
}

/* ── Color picker ── */
.dui-row input[type="color"] {
  width: 38px; height: 26px; padding: 2px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 2px);
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.dui-row input[type="color"]:hover { border-color: hsl(var(--ring)); }

/* ── Text input & select ── */
.dui-row input[type="text"],
.dui-row select {
  flex: 1;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--input));
  color: hsl(var(--foreground));
  padding: 5px 8px;
  border-radius: calc(var(--radius) - 2px);
  font-family: inherit; font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dui-row input[type="text"]:focus,
.dui-row select:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.2);
}
.dui-row select option { background: hsl(var(--background)); color: hsl(var(--foreground)); }

/* ── Buttons (shadcn Button variants) ── */
.dui-btn {
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  border: 1px solid transparent;
  padding: 6px 12px;
  border-radius: calc(var(--radius) - 2px);
  font-family: inherit; font-size: 12px; font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}
.dui-btn:hover    { background: hsl(var(--secondary) / 0.8); }
.dui-btn:active   { background: hsl(var(--secondary) / 0.7); }
.dui-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.4);
}
.dui-btn.dui-active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.dui-btn.dui-active:hover { background: hsl(var(--primary) / 0.9); }
.dui-btn-row {
  display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0;
}

/* ── Animation trigger (hero row) ──
   Single named animation: label on the left, play icon on the right,
   thin progress bar across the bottom. Visually prominent so designers
   spot the "fire this animation" affordance amid sliders. */
.dui-trigger {
  position: relative;
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  padding: 9px 12px;
  margin: 6px 0;
  cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 500;
  text-align: left;
  overflow: hidden;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease;
}
.dui-trigger:hover {
  background: hsl(var(--secondary) / 0.8);
  border-color: hsl(var(--ring) / 0.4);
}
.dui-trigger:active { transform: translateY(0.5px); }
.dui-trigger-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  border-radius: 999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  flex-shrink: 0;
}
.dui-trigger-label { flex: 1; }
.dui-trigger-progress {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: 2px;
  background: transparent;
  pointer-events: none;
}
.dui-trigger-fill {
  display: block; height: 100%;
  width: 0%;
  background: hsl(var(--primary));
  opacity: 0;
}
.dui-trigger-playing .dui-trigger-fill { opacity: 0.9; }
.dui-trigger-playing .dui-trigger-icon {
  animation: dui-trigger-pulse 0.6s ease-in-out infinite alternate;
}
@keyframes dui-trigger-pulse {
  from { transform: scale(1);    box-shadow: 0 0 0 0   hsl(var(--ring) / 0.0); }
  to   { transform: scale(1.08); box-shadow: 0 0 0 4px hsl(var(--ring) / 0.25); }
}

/* ── Sequence (multi-step animation chain) ──
   Header + current step name + dot indicators + prev/replay/next.
   Slightly heavier visual weight than a trigger because there are
   more affordances to anchor. */
.dui-sequence {
  margin: 8px 0; padding: 10px 12px;
  background: hsl(var(--secondary) / 0.5);
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  display: flex; flex-direction: column; gap: 8px;
}
.dui-sequence-header {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px; font-weight: 500;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.dui-sequence-pos { font-variant-numeric: tabular-nums; }
.dui-sequence-step {
  font-size: 14px; font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.005em;
}
.dui-sequence-dots {
  display: flex; gap: 6px; align-items: center;
  padding: 2px 0;
}
.dui-seq-dot {
  width: 10px; height: 10px; border-radius: 999px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
}
.dui-seq-dot:hover { transform: scale(1.2); }
.dui-seq-dot-active {
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
}
.dui-sequence-controls {
  display: flex; gap: 6px;
}
.dui-seq-btn {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center;
  height: 30px;
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 4px);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dui-seq-btn:hover {
  background: hsl(var(--accent));
  border-color: hsl(var(--ring) / 0.4);
}
.dui-seq-btn:active { transform: translateY(0.5px); }
.dui-seq-btn.dui-seq-replay {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}
.dui-seq-btn.dui-seq-replay:hover { background: hsl(var(--primary) / 0.9); }
.dui-sequence-playing .dui-seq-replay {
  animation: dui-trigger-pulse 0.6s ease-in-out infinite alternate;
}

/* ── File upload ── */
.dui-file-label {
  display: inline-block;
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  padding: 6px 12px;
  border-radius: calc(var(--radius) - 2px);
  font-size: 12px; font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}
.dui-file-label:hover { background: hsl(var(--secondary) / 0.8); }
.dui-file-label input[type="file"] { display: none; }

/* ── Info text (muted) ── */
.dui-info {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  padding: 4px 0;
  line-height: 1.5;
}

/* ── List (shadcn-style list items) ── */
.dui-list {
  display: flex; flex-direction: column; gap: 4px;
  margin: 8px 0;
}
.dui-list-item {
  display: flex; justify-content: space-between; align-items: center;
  background: hsl(var(--muted) / 0.4);
  border: 1px solid transparent;
  border-radius: calc(var(--radius) - 2px);
  padding: 6px 10px;
  transition: background 0.15s ease;
}
.dui-list-item:hover { background: hsl(var(--muted) / 0.7); }
.dui-list-item {
  /* Subtle hover/select transitions only. We don't animate row-entry
     because the Outliner rebuilds the whole list on every selection
     change — that would re-fire the animation as flicker. */
  transition: background 0.12s ease, border-color 0.12s ease;
}
.dui-list-item.dui-selected {
  background: hsl(var(--accent));
  border-color: hsl(var(--ring) / 0.5);
}
/* Secondary multi-selection — softer than the primary so the user can
   still tell which row the mini transform toolbar is attached to. */
.dui-list-item.dui-co-selected {
  background: hsl(var(--accent) / 0.45);
  border-color: hsl(var(--ring) / 0.3);
}
.dui-list-item .dui-name {
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 500;
  flex: 1 1 0;            /* take remaining space between icon + actions */
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
/* Disclosure triangle for expandable group rows. Leaf rows get an
   invisible spacer of the same width so every icon stays column-aligned. */
.dui-list-item .dui-tree-caret {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; flex: none;
  margin-right: 2px;
  font-size: 9px; line-height: 1;
  color: hsl(var(--muted-foreground));
  cursor: pointer; user-select: none;
}
.dui-list-item .dui-tree-caret.dui-tree-spacer { cursor: default; }
.dui-list-item.dui-selected .dui-tree-caret { color: hsl(var(--foreground)); }
/* Leading type icon — emoji/glyph indicating mesh / light / camera / etc. */
.dui-list-item .dui-list-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  margin-right: 8px;
  flex: none;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  opacity: 0.85;
}
.dui-list-item.dui-selected .dui-list-icon { color: hsl(var(--foreground)); opacity: 1; }
/* Material folder — texture row. Custom DOM but every value is pulled from
   the same hsl(0 0% X / Y) token palette as the rest of the panel so it
   reads as a native section. Layout: thumb · filename · ×. Empty state
   collapses to a dashed placeholder. */
.dui-tex-row {
  display: flex; align-items: center; gap: 10px;
  margin: 8px 0;
}
.dui-tex-thumb {
  width: 36px; height: 36px;
  flex: none;
  border-radius: 6px;
  background: hsl(0 0% 100% / 0.04);
  image-rendering: pixelated;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px hsl(0 0% 0% / 0.5),
    inset 0 0 0 2px hsl(0 0% 100% / 0.06);
  transition: transform 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              box-shadow 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-tex-thumb:hover {
  transform: scale(1.04);
  box-shadow:
    inset 0 0 0 1px hsl(0 0% 0% / 0.5),
    inset 0 0 0 2px hsl(0 0% 100% / 0.2);
}
.dui-tex-name {
  flex: 1; min-width: 0;
  font-family: var(--dui-font-mono);
  font-size: 10.5px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dui-tex-clear {
  flex: none;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid hsl(var(--border));
  color: hsl(0 0% 100% / 0.6);
  border-radius: 5px;
  font-size: 14px; line-height: 1;
  cursor: pointer;
  transition: background 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              color 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              border-color 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-tex-clear:hover {
  background: hsl(0 60% 35% / 0.3);
  border-color: hsl(0 60% 50% / 0.5);
  color: hsl(0 80% 80%);
}
.dui-tex-empty {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px;
  background: hsl(0 0% 100% / 0.04);
  border: 1px dashed hsl(0 0% 100% / 0.18);
  border-radius: 6px;
  color: hsl(0 0% 100% / 0.6);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              border-color 0.16s cubic-bezier(0.32, 0.72, 0, 1),
              color 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-tex-empty:hover {
  background: hsl(0 0% 100% / 0.07);
  border-color: hsl(0 0% 100% / 0.3);
  color: hsl(0 0% 100%);
}
.dui-tex-empty-plus {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px;
  border-radius: 3px;
  background: hsl(0 0% 100% / 0.08);
  font-size: 12px;
  line-height: 1;
  margin-right: 2px;
}

/* Subsection heading inside a folder body (e.g. "UV" under Material). */
.dui-subhead {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: hsl(0 0% 100% / 0.45);
  margin: 14px 0 4px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid hsl(0 0% 100% / 0.06);
}

/* ── Canvas context menu (right-click) ────────────────────────────── */
.dui-context-menu {
  position: fixed;
  z-index: 99996;
  min-width: 200px;
  background: hsl(0 0% 6% / 0.92);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 10px;
  box-shadow: 0 1px 0 hsl(0 0% 100% / 0.08) inset, 0 18px 38px hsl(0 0% 0% / 0.5);
  padding: 4px;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  user-select: none;
  transform-origin: top left;
  animation: dui-cm-pop 0.16s cubic-bezier(0.32, 0.72, 0.24, 1.2);
}
@keyframes dui-cm-pop {
  from { opacity: 0; transform: scale(0.92) translateY(-4px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);    }
}
.dui-cm-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  background: transparent;
  border: none;
  color: hsl(0 0% 100% / 0.85);
  padding: 7px 10px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  font-family: inherit; font-size: inherit;
}
.dui-cm-item:hover:not(:disabled) {
  background: hsl(0 0% 100% / 0.08);
  color: white;
}
.dui-cm-item.dui-cm-disabled, .dui-cm-item:disabled {
  opacity: 0.4;
  cursor: default;
}
.dui-cm-item.dui-cm-danger { color: hsl(0 70% 65%); }
.dui-cm-item.dui-cm-danger:hover:not(:disabled) {
  background: hsl(0 60% 40% / 0.35);
  color: hsl(0 90% 90%);
}
.dui-cm-icon  { width: 14px; display: inline-flex; justify-content: center; opacity: 0.7; }
.dui-cm-label { flex: 1; }
.dui-cm-shortcut {
  font-family: var(--dui-font-mono);
  font-size: 10px;
  color: hsl(0 0% 100% / 0.4);
}
.dui-cm-sep {
  height: 1px;
  background: hsl(0 0% 100% / 0.08);
  margin: 4px 6px;
}

/* Learning folder — self-correction proposals */
.dui-learning-list { display: flex; flex-direction: column; gap: 8px; }
.dui-learning-empty {
  font-size: 11px; color: hsl(var(--muted-foreground));
  padding: 6px 0;
}
.dui-learning-row {
  background: hsl(var(--muted) / 0.4);
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 4px;
}
.dui-learning-summary { font-size: 12px; font-weight: 600; color: hsl(var(--foreground)); }
.dui-learning-reason  { font-size: 11px; color: hsl(var(--muted-foreground)); line-height: 1.4; }
.dui-learning-file    { font-family: var(--dui-font-mono); font-size: 10.5px; color: hsl(var(--ring)); }
.dui-learning-apply {
  align-self: flex-start;
  margin-top: 2px;
  background: hsl(150 70% 40%);
  color: hsl(0 0% 5%);
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
}
.dui-learning-apply:hover:not(:disabled) { background: hsl(150 70% 50%); }
.dui-learning-apply:disabled { opacity: 0.5; cursor: default; }
.dui-learning-apply.dui-learning-applied { background: hsl(200 70% 50%); color: white; }

.dui-list-item .dui-name.dui-name-editing {
  background: hsl(var(--input));
  border: 1px solid hsl(var(--ring) / 0.6);
  border-radius: 4px;
  padding: 1px 4px;
  outline: none;
  cursor: text;
}
.dui-list-item .dui-actions { display: flex; gap: 4px; }
.dui-list-item .dui-actions button {
  background: transparent;
  border: 1px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.dui-list-item .dui-actions button:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}
.dui-list-item .dui-actions button.dui-danger {
  background: hsl(var(--destructive));
  border-color: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
}
.dui-list-item .dui-actions button.dui-danger:hover {
  background: hsl(var(--destructive) / 0.9);
}
/* Outliner action buttons (eye / trash / focus) host SVG icons from
   icons.js whose default size is 16×16. Inside the small row buttons
   that's too big — clamp to 12×12 so they don't dominate the row. */
.dui-list-item .dui-actions button svg { width: 12px; height: 12px; display: block; }
.dui-list-item .dui-list-icon { display: inline-flex; align-items: center; }
.dui-list-item .dui-list-icon svg { width: 14px; height: 14px; display: block; }

/* Focus reticle button (cameras only) — sits just left of the eye icon.
   Active state uses the same semi-transparent white the mini toolbar's
   camera button uses, so "looking through this camera" reads consistently
   wherever the toggle surfaces. */
.dui-list-item .dui-actions button.dui-action-focus {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 6px;
  color: hsl(var(--muted-foreground));
}
.dui-list-item .dui-actions button.dui-action-focus:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--muted));
}
.dui-list-item .dui-actions button.dui-action-focus.dui-active {
  background: hsl(0 0% 100% / 0.18);
  border-color: hsl(0 0% 100% / 0.22);
  color: hsl(0 0% 100%);
}

/* ════════════════════════════════════════════════════════════════════════
   DialKit — physical-feeling controls (rotary dials, curve editor, timeline,
   stepper, XY pad). All themed via the standard CSS tokens so they auto-
   adopt Liquid Glass / shadcn / Blender styling.
   ════════════════════════════════════════════════════════════════════════ */

/* Layout: block-style row with label above instead of beside */
.dui-row.dui-row-block {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.dui-row.dui-row-block label {
  width: auto;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

/* ── DIAL ── */
.dui-dial-row { padding: 4px 0; }
.dui-dial-wrap {
  display: flex; align-items: center; gap: 12px;
}
.dui-dial-svg {
  cursor: ns-resize;
  user-select: none;
  flex-shrink: 0;
}
.dui-dial-svg.dui-dial-dragging { cursor: grabbing; }
.dui-dial-track-bg {
  stroke: hsl(var(--muted));
  stroke-width: 4;
  stroke-linecap: round;
  opacity: 0.6;
}
.dui-dial-track-fill {
  stroke: hsl(var(--primary));
  stroke-width: 4;
  stroke-linecap: round;
}
.dui-dial-knob {
  fill: hsl(var(--secondary));
  stroke: hsl(var(--border));
  stroke-width: 1;
}
.dui-dial-indicator {
  stroke: hsl(var(--primary));
  stroke-width: 2.5;
  stroke-linecap: round;
}
.dui-dial-value {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: hsl(var(--foreground));
  font-weight: 500;
}

/* ── CURVE EDITOR ── */
/* Curve editor — dialkit-aligned: equal-scale [-0.5,1.5] viewport with a
   faint quarter grid, dashed identity diagonal, and a single hero curve
   stroked white at 60% alpha (round caps/joins). Knobs are inert anchors
   visually, but pointer-grabbable for direct manipulation. */
.dui-curve-row { padding: 4px 0; }
.dui-curve {
  background: hsl(0 0% 100% / 0.03);
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 8px;
  display: block;
}
.dui-curve-grid line {
  stroke: hsl(0 0% 100% / 0.08);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.dui-curve-diag {
  stroke: hsl(0 0% 100% / 0.15);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}
.dui-curve-path {
  stroke: hsl(0 0% 100% / 0.6);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.dui-curve-handle-line {
  stroke: hsl(0 0% 100% / 0.18);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}
.dui-curve-cp {
  fill: hsl(0 0% 100%);
  stroke: hsl(0 0% 0% / 0.6);
  stroke-width: 1;
  cursor: grab;
  transition: r 0.12s ease, fill 0.12s ease;
  filter: drop-shadow(0 1px 2px hsl(0 0% 0% / 0.5));
}
.dui-curve-cp:hover { r: 5.5; fill: hsl(0 0% 100%); }
.dui-curve-cp-dragging { cursor: grabbing; fill: hsl(48 100% 70%); }

/* ── TIMELINE ── */
.dui-timeline-row { padding: 4px 0; }
.dui-timeline-inner {
  display: flex; align-items: center; gap: 8px;
}
.dui-timeline-play {
  flex-shrink: 0;
  width: 26px; height: 26px;
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: 50%;
  cursor: pointer;
  font-size: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0;
  transition: background 0.15s ease;
}
.dui-timeline-play:hover { background: hsl(var(--accent)); }
.dui-timeline-bar {
  flex: 1; height: 26px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: 4px;
  position: relative;
  cursor: pointer;
  overflow: hidden;
}
.dui-timeline-fill {
  position: absolute;
  top: 0; bottom: 0; left: 0;
  background: hsl(var(--primary) / 0.25);
  pointer-events: none;
}
.dui-timeline-keyframe {
  position: absolute;
  top: 4px; bottom: 4px;
  width: 2px;
  background: hsl(var(--muted-foreground));
  opacity: 0.7;
  border-radius: 1px;
  pointer-events: none;
  transform: translateX(-1px);
}
.dui-timeline-playhead {
  position: absolute;
  top: -2px; bottom: -2px;
  width: 2px;
  background: hsl(var(--primary));
  transform: translateX(-1px);
  pointer-events: none;
  box-shadow: 0 0 6px hsl(var(--primary) / 0.6);
}
.dui-timeline-time {
  flex-shrink: 0;
  width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

/* ── STEPPER ── */
.dui-stepper-row {}
.dui-stepper {
  display: inline-flex; align-items: center;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  overflow: hidden;
}
.dui-stepper-btn {
  width: 26px; height: 26px;
  background: transparent;
  color: hsl(var(--foreground));
  border: none;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.15s ease;
  font-family: inherit;
}
.dui-stepper-btn:hover { background: hsl(var(--accent)); }
.dui-stepper-value {
  min-width: 50px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--foreground));
  padding: 0 8px;
}

/* ── XY PAD ── */
.dui-xypad-row {}
.dui-xypad {
  background: hsl(var(--muted) / 0.4);
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  position: relative;
  cursor: crosshair;
  margin: 4px 0;
}
.dui-xypad-h, .dui-xypad-v {
  position: absolute;
  background: hsl(var(--border));
  pointer-events: none;
}
.dui-xypad-h { left: 0; right: 0; height: 1px; }
.dui-xypad-v { top: 0; bottom: 0; width: 1px; }
.dui-xypad-dot {
  position: absolute;
  width: 12px; height: 12px;
  background: hsl(var(--primary));
  border: 2px solid hsl(var(--background));
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  box-shadow: 0 0 8px hsl(var(--primary) / 0.6);
}

/* Liquid Glass intentionally does NOT override dialkit / curve /
   timeline / stepper / xypad styles. Liquid Glass is a panel-SURFACE
   treatment (frosted background, blur, bigger radius) — controls
   inside use the core design we shipped so the look stays consistent
   whether the host opts into the glass surface or not. */

/* ════════════════════════════════════════════════════════════════════════
   Animation graph editor (Blender-style F-Curve / Dope Sheet)
   ════════════════════════════════════════════════════════════════════════ */
.dui-graph-editor {
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  margin: 6px 0;
  overflow: hidden;
  font-size: 11px;
}

/* Header tabs */
.dui-graph-header {
  display: flex; align-items: center;
  background: hsl(var(--muted) / 0.4);
  border-bottom: 1px solid hsl(var(--border));
  padding: 4px;
  gap: 2px;
}
.dui-graph-tab {
  background: transparent;
  color: hsl(var(--muted-foreground));
  border: none;
  padding: 4px 10px;
  border-radius: calc(var(--radius) - 4px);
  font-family: inherit; font-size: 11px; font-weight: 500;
  cursor: pointer;
}
.dui-graph-tab:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
.dui-graph-tab.dui-active {
  background: hsl(var(--primary)); color: hsl(var(--primary-foreground));
}
.dui-graph-spacer { flex: 1; }
.dui-graph-mini-btn {
  background: transparent;
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border));
  padding: 3px 8px;
  border-radius: calc(var(--radius) - 4px);
  font-family: inherit; font-size: 10px;
  cursor: pointer;
  margin-left: 2px;
}
.dui-graph-mini-btn:hover { color: hsl(var(--foreground)); background: hsl(var(--muted)); }

/* Body — track list on left, canvas on right.
   Height is set inline by createGraphEditor so the graph area stays
   constant even when the easing scratchpad is shown below. */
.dui-graph-body {
  display: flex;
  min-height: 0;
}
.dui-graph-tracks {
  width: 140px;
  background: hsl(var(--muted) / 0.2);
  border-right: 1px solid hsl(var(--border));
  overflow-y: auto;
  padding: 4px 0;
  flex-shrink: 0;
}
.dui-graph-track {
  display: flex; align-items: center;
  gap: 4px;
  padding: 5px 8px;
  cursor: pointer;
  font-size: 11px;
  border-left: 2px solid transparent;
}
.dui-graph-track:hover { background: hsl(var(--muted) / 0.4); }
.dui-graph-track.dui-active {
  background: hsl(var(--accent));
  border-left-color: hsl(var(--primary));
}
.dui-graph-track-color {
  width: 8px; height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.dui-graph-track-vis {
  background: transparent; border: none;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  padding: 0;
  font-size: 11px;
  width: 16px;
}
.dui-graph-track-meta {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  line-height: 1.2;
}
.dui-graph-track-name {
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dui-graph-track-binding {
  font-size: 9px;
  color: hsl(var(--muted-foreground));
  font-family: var(--dui-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dui-graph-track-unbound { opacity: 0.4; font-style: italic; }

/* Canvas */
.dui-graph-canvas-wrap {
  flex: 1; min-width: 0;
  position: relative;
  background:
    linear-gradient(hsl(var(--background)) 0%, hsl(var(--muted) / 0.15) 100%);
  overflow: hidden;
}
.dui-graph-svg {
  display: block;
  width: 100%; height: 100%;
}
/* Graph editor f-curves — dialkit alignment: minimal grid (white alpha 0.08),
   dashed zero reference at alpha 0.15, hero curves stroked at 2px with round
   caps/joins. Per-track color overrides on the path stroke still apply. */
.dui-graph-grid line {
  stroke: hsl(0 0% 100% / 0.08);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.dui-graph-zero {
  stroke: hsl(0 0% 100% / 0.15);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}
.dui-graph-tick {
  fill: hsl(0 0% 100% / 0.4);
  font-size: 9px;
  font-family: var(--dui-font-mono);
  letter-spacing: 0.02em;
}
.dui-graph-curve {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.dui-graph-key {
  stroke: hsl(var(--background));
  stroke-width: 1.5;
  cursor: grab;
  transition: transform 0.1s ease;
}
.dui-graph-key:hover { stroke: hsl(var(--primary)); stroke-width: 2; }
.dui-graph-key.dui-active {
  stroke: hsl(var(--primary));
  stroke-width: 2.5;
}
.dui-graph-dope-line { stroke-width: 1; opacity: 0.4; }
.dui-graph-playhead {
  stroke: hsl(var(--primary));
  stroke-width: 1.5;
  pointer-events: none;
}
.dui-graph-playhead-label-bg {
  fill: hsl(var(--primary));
  pointer-events: none;
}
.dui-graph-playhead-label {
  fill: hsl(var(--primary-foreground));
  font-size: 10px;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

/* Footer transport */
.dui-graph-footer {
  display: flex; align-items: center;
  gap: 2px;
  padding: 6px 8px;
  background: hsl(var(--muted) / 0.4);
  border-top: 1px solid hsl(var(--border));
}
.dui-graph-transport {
  background: transparent;
  color: hsl(var(--muted-foreground));
  border: none;
  width: 26px; height: 22px;
  border-radius: calc(var(--radius) - 4px);
  cursor: pointer;
  font-size: 11px;
  display: inline-flex; align-items: center; justify-content: center;
}
.dui-graph-transport:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
.dui-graph-transport.dui-graph-play {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.dui-graph-frame-info {
  margin-left: auto;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

/* Prompt bar */
.dui-graph-prompt {
  display: flex; gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--background));
}
.dui-graph-prompt input {
  flex: 1;
  background: hsl(var(--muted) / 0.4);
  border: 1px solid hsl(var(--border));
  color: hsl(var(--foreground));
  padding: 6px 10px;
  border-radius: calc(var(--radius) - 4px);
  font-family: inherit; font-size: 12px;
  outline: none;
}
.dui-graph-prompt input::placeholder { color: hsl(var(--muted-foreground)); }
.dui-graph-prompt input:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.2);
}

/* No liquid-glass overrides for the graph editor — see the note in
   the dialkit section above. Liquid Glass is panel-surface only. */

/* ════════════════════════════════════════════════════════════════════════
   Toolbar — floating control bars anchored to viewport edges
   ════════════════════════════════════════════════════════════════════════ */
.dui-toolbar {
  --background: 240 6% 9%;
  --foreground: 0 0% 98%;
  --muted: 240 5% 15%;
  --border: 240 5% 18%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 6% 10%;
  --radius: 0.5rem;

  position: fixed;
  z-index: 9998;
  background: hsl(0 0% 8% / 0.85);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 12px;
  padding: 6px;
  box-shadow:
    0 1px 0 hsl(0 0% 100% / 0.1) inset,
    0 8px 24px hsl(0 0% 0% / 0.35);
  display: none;
  align-items: center;
  gap: 4px;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  color: hsl(0 0% 98%);
  user-select: none;
  pointer-events: auto;
}
.dui-toolbar.dui-visible { display: inline-flex; }

/* Horizontal anchors */
.dui-toolbar.dui-toolbar-top {
  top: 16px; left: 50%; transform: translateX(-50%);
}
.dui-toolbar.dui-toolbar-bottom {
  bottom: 16px; left: 50%; transform: translateX(-50%);
}

/* Vertical anchors */
.dui-toolbar.dui-toolbar-left {
  left: 16px; top: 50%; transform: translateY(-50%);
  flex-direction: column;
}
.dui-toolbar.dui-toolbar-right {
  right: 16px; top: 50%; transform: translateY(-50%);
  flex-direction: column;
}

/* Compact spacing */
.dui-toolbar-compact { gap: 2px; padding: 4px; }

/* Buttons */
.dui-toolbar-btn {
  background: transparent;
  color: hsl(0 0% 100% / 0.75);
  border: 1px solid transparent;
  padding: 6px 10px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
  min-height: 30px;
}
.dui-toolbar-btn:hover {
  background: hsl(0 0% 100% / 0.08);
  color: hsl(0 0% 100%);
}
.dui-toolbar-btn.dui-active {
  background: hsl(0 0% 100% / 0.18);
  color: hsl(0 0% 100%);
  border-color: hsl(0 0% 100% / 0.12);
}
.dui-toolbar-icon {
  display: inline-flex; align-items: center;
  width: 16px; height: 16px;
}
.dui-toolbar-icon svg { width: 14px; height: 14px; }
.dui-toolbar-label { font-size: 12px; }

/* Group: pills with tight borders */
.dui-toolbar-group {
  display: inline-flex;
  background: hsl(0 0% 100% / 0.04);
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 8px;
  padding: 2px;
}
.dui-toolbar-group .dui-toolbar-btn { padding: 4px 8px; min-height: 26px; }

/* Static text */
.dui-toolbar-text {
  padding: 0 8px;
  color: hsl(0 0% 100% / 0.7);
  font-variant-numeric: tabular-nums;
}

/* Divider */
.dui-toolbar-divider {
  width: 1px;
  height: 18px;
  background: hsl(0 0% 100% / 0.12);
  margin: 0 4px;
}
.dui-toolbar-left .dui-toolbar-divider,
.dui-toolbar-right .dui-toolbar-divider {
  width: 18px; height: 1px;
}

/* ── Export menu popover ── */
.dui-export-menu {
  position: fixed;
  z-index: 99999;
  background: hsl(0 0% 8% / 0.92);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 14px;
  padding: 8px;
  min-width: 320px;
  max-width: 400px;
  color: hsl(0 0% 98%);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 13px;
  box-shadow:
    0 1px 0 hsl(0 0% 100% / 0.1) inset,
    0 12px 40px hsl(0 0% 0% / 0.5);
  opacity: 0;
  transform: translateY(-6px);
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dui-export-menu.dui-visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.dui-export-menu-header { padding: 8px 10px 6px; }
.dui-export-menu-title {
  font-size: 14px; font-weight: 600;
  letter-spacing: -0.01em;
  color: hsl(0 0% 100%);
}
.dui-export-menu-sub {
  font-size: 11px;
  color: hsl(0 0% 100% / 0.5);
  margin-top: 2px;
}
.dui-export-menu-group {
  padding: 10px 10px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: hsl(0 0% 100% / 0.4);
}
.dui-export-menu-item {
  display: flex; align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  color: hsl(0 0% 98%);
  font-family: inherit;
  text-align: left;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.dui-export-menu-item:hover {
  background: hsl(0 0% 100% / 0.06);
  border-color: hsl(0 0% 100% / 0.1);
}
.dui-export-menu-item.dui-busy {
  opacity: 0.5; pointer-events: none;
}
.dui-export-menu-item-icon {
  flex-shrink: 0;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: hsl(0 0% 100% / 0.06);
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: 8px;
}
.dui-export-glyph {
  font-family: var(--dui-font-mono);
  font-size: 11px;
  font-weight: 600;
  color: hsl(0 0% 100% / 0.9);
}
.dui-export-menu-item-text { flex: 1; min-width: 0; }
.dui-export-menu-item-label {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.005em;
}
.dui-export-menu-item-desc {
  font-size: 11px;
  color: hsl(0 0% 100% / 0.55);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dui-export-menu-item-ext {
  font-size: 10px;
  font-family: var(--dui-font-mono);
  color: hsl(0 0% 100% / 0.4);
  background: hsl(0 0% 100% / 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}
.dui-export-menu-empty {
  padding: 16px;
  text-align: center;
  color: hsl(0 0% 100% / 0.5);
  font-size: 12px;
}

/* ── Add-object menu (Shift+A) ── */
/* Anchor the add menu by its TOP edge (centered horizontally) instead of
   centering vertically — that way, when the user types and the list grows
   or shrinks, the box extends/contracts in +Y only. The top stays pinned
   so the search field, which is where the cursor lives, never moves. */
.dui-add-menu {
  position: fixed;
  top: 22vh;
  left: 50%;
  transform: translate(-50%, -8px) scale(0.96);
  z-index: 99999;
  width: 380px;
  max-height: min(56vh, 500px);
  display: flex;
  flex-direction: column;
  background: hsl(0 0% 8% / 0.92);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.14);
  border-radius: 14px;
  box-shadow:
    0 1px 0 hsl(0 0% 100% / 0.1) inset,
    0 16px 48px hsl(0 0% 0% / 0.5);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: hsl(0 0% 98%);
  opacity: 0;
  pointer-events: none;
  /* Same buttery easing as the rest of the tool. max-height transitions so
     the menu smoothly grows / shrinks as the user filters down items. */
  transition:
    opacity    0.18s ease,
    transform  0.22s cubic-bezier(0.32, 0.72, 0.24, 1.2),
    max-height 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-add-menu.dui-visible {
  opacity: 1; pointer-events: auto;
  transform: translate(-50%, 0) scale(1);
}

.dui-add-menu-header {
  padding: 10px;
  border-bottom: 1px solid hsl(0 0% 100% / 0.08);
}
.dui-add-menu-search {
  width: 100%;
  background: hsl(0 0% 100% / 0.06);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 8px;
  padding: 8px 12px;
  color: hsl(0 0% 100%);
  font: 13px ui-sans-serif, system-ui;
  outline: none;
}
.dui-add-menu-search:focus {
  border-color: hsl(0 0% 100% / 0.3);
  box-shadow: 0 0 0 3px hsl(0 0% 100% / 0.08);
}
.dui-add-menu-search::placeholder { color: hsl(0 0% 100% / 0.4); }

.dui-add-menu-list {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 6px;
}
.dui-add-menu-group {
  padding: 8px 10px 4px;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase;
  color: hsl(0 0% 100% / 0.4);
}
/* Empty state — appears when no factories match the active workflow
   or the current search query. Keeps the menu legible instead of
   showing a blank rectangle below the search field. */
.dui-add-menu-empty {
  padding: 24px 16px;
  text-align: center;
}
.dui-add-menu-empty-title {
  font-size: 12.5px;
  font-weight: 500;
  color: hsl(0 0% 100% / 0.85);
  margin-bottom: 6px;
}
.dui-add-menu-empty-hint {
  font-size: 11.5px;
  color: hsl(0 0% 100% / 0.5);
  line-height: 1.5;
}
.dui-add-menu-empty-hint code {
  font-family: var(--dui-font-mono);
  background: hsl(0 0% 100% / 0.06);
  border-radius: 3px;
  padding: 1px 4px;
  color: hsl(0 0% 100% / 0.75);
}
.dui-add-menu-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: hsl(0 0% 98%);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  transition: background 0.1s ease;
}
.dui-add-menu-item.dui-active { background: hsl(0 0% 100% / 0.1); }
.dui-add-menu-item:hover { background: hsl(0 0% 100% / 0.08); }
.dui-add-menu-icon {
  flex-shrink: 0;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: hsl(0 0% 100% / 0.06);
  border-radius: 5px;
  font-size: 13px;
}
.dui-add-menu-label { flex: 1; font-weight: 500; }
.dui-add-menu-tag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: hsl(0 0% 100% / 0.5);
  background: hsl(0 0% 100% / 0.08);
  padding: 1px 6px;
  border-radius: 4px;
}

.dui-add-menu-footer {
  display: flex; gap: 14px;
  padding: 8px 12px;
  border-top: 1px solid hsl(0 0% 100% / 0.08);
  font-size: 10px;
  color: hsl(0 0% 100% / 0.4);
}
.dui-add-menu-footer kbd {
  background: hsl(0 0% 100% / 0.08);
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: 3px;
  padding: 0 4px;
  font-family: var(--dui-font-mono);
  font-size: 9px;
  margin-right: 3px;
}

/* ── Modal-transform hint (G/R/S + X/Y/Z status indicator) ── */
.dui-modal-hint {
  position: fixed;
  top: 16px; left: 50%; transform: translateX(-50%);
  z-index: 99999;
  display: none;
  align-items: center;
  gap: 8px;
  background: hsl(0 0% 0% / 0.85);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  color: hsl(0 0% 98%);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding: 8px 14px;
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 999px;
  box-shadow: 0 1px 0 hsl(0 0% 100% / 0.1) inset, 0 8px 24px hsl(0 0% 0% / 0.4);
  pointer-events: none;
  user-select: none;
}
.dui-modal-mode { font-weight: 600; letter-spacing: -0.01em; }
.dui-modal-sep  { opacity: 0.3; }
.dui-modal-axis {
  font-family: var(--dui-font-mono);
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 999px;
  background: hsl(0 0% 100% / 0.08);
}
.dui-modal-axis-free { color: hsl(0 0% 60%); }
.dui-modal-tip { color: hsl(0 0% 60%); font-weight: 400; }

/* ── Keyframe diamond (Blender-style "insert key" affordance) ──────────
   The icon is appended INSIDE the control's chrome — for number/text/
   select/color rows the row itself is the chrome (handled by the
   default flex layout below). For slider rows the chrome is the inner
   .dui-slider element, so we position the diamond absolutely at the
   right edge of that chrome and shift the value readout left to make
   room. Consistent placement across all control types: diamond always
   at the right edge INSIDE the visible control box. */
.dui-keyframe-icon {
  background: transparent;
  border: none;
  padding: 0 4px;
  margin-left: 4px;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  color: hsl(0 0% 100% / 0.25);
  transition: color 0.12s ease, transform 0.08s ease;
  vertical-align: middle;
  flex: none;
}
.dui-keyframe-icon:hover { color: hsl(0 0% 100% / 0.6); transform: scale(1.15); }
.dui-keyframe-icon.dui-keyframe-has-track { color: hsl(0 0% 100% / 0.85); }
.dui-keyframe-icon.dui-keyframe-has-key   { color: hsl(48 100% 60%); }
.dui-keyframe-icon svg { display: block; }

/* Slider-row variant: diamond lives INSIDE the .dui-slider chrome,
   pinned to the right edge with the value tucked just to its left. */
.dui-slider > .dui-keyframe-icon {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 0;
  z-index: 3;
}
.dui-slider > .dui-keyframe-icon:hover {
  transform: translateY(-50%) scale(1.15);
}
/* Push the value left to make room for the diamond when one is present.
   The :has() selector keeps this purely conditional — sliders without a
   keyframe diamond keep their original right: 10px value position. */
.dui-slider:has(> .dui-keyframe-icon) > .dui-slider-value {
  right: 28px;
}
.dui-slider:has(> .dui-keyframe-icon) > .dui-slider-editor {
  right: 24px;
}

/* ── Styled modal dialogs (confirm / alert / prompt) ──────────────────
   Replaces the browser's native confirm()/alert()/prompt() with cards
   that match the rest of the tool — dark glass, rounded corners, the
   same button styling as folder actions, soft fade-in. Backdrop traps
   clicks so the user can't accidentally interact with the canvas while
   a destructive prompt is open. */
.dui-modal-host { /* per-modal backdrops mount into this host */ }
.dui-modal-backdrop {
  position: fixed; inset: 0;
  z-index: 100000;
  background: hsl(0 0% 0% / 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  transition: opacity 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-modal-backdrop.dui-modal-visible { opacity: 1; }
.dui-modal {
  min-width: 320px; max-width: 440px;
  background: hsl(0 0% 8% / 0.95);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 12px;
  box-shadow: 0 24px 64px hsl(0 0% 0% / 0.55);
  color: hsl(0 0% 96%);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  display: flex; flex-direction: column;
  transform: translateY(8px) scale(0.98);
  transition: transform 0.18s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-modal-backdrop.dui-modal-visible .dui-modal { transform: translateY(0) scale(1); }
.dui-modal-title {
  padding: 16px 20px 4px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: hsl(0 0% 100% / 0.95);
}
.dui-modal-body {
  padding: 8px 20px 12px;
  display: flex; align-items: flex-start; gap: 10px;
}
.dui-modal-message {
  flex: 1;
  font-size: 12.5px;
  line-height: 1.5;
  color: hsl(0 0% 100% / 0.78);
  display: flex; align-items: flex-start; gap: 8px;
}
.dui-modal-icon {
  display: inline-flex; flex: none;
  color: hsl(0 0% 100% / 0.7);
}
.dui-modal-icon svg { width: 16px; height: 16px; display: block; }
.dui-modal-input {
  width: 100%;
  background: hsl(0 0% 100% / 0.05);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: inherit; font-size: 12.5px;
  color: hsl(0 0% 96%);
  outline: none;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.dui-modal-input:focus {
  border-color: hsl(0 0% 100% / 0.28);
  background: hsl(0 0% 100% / 0.08);
}
.dui-modal-footer {
  display: flex; justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
}
.dui-modal-actions {
  display: contents;
}
.dui-modal-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 7px 14px;
  background: hsl(0 0% 100% / 0.06);
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: 6px;
  color: hsl(0 0% 100% / 0.85);
  font: inherit; font-size: 12.5px; font-weight: 500;
  cursor: pointer;
  outline: none;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.dui-modal-btn:hover {
  background: hsl(0 0% 100% / 0.1);
  color: hsl(0 0% 100%);
}
.dui-modal-btn:focus-visible {
  border-color: hsl(0 0% 100% / 0.3);
  box-shadow: 0 0 0 2px hsl(0 0% 100% / 0.08);
}
.dui-modal-btn-primary {
  background: hsl(0 0% 100% / 0.18);
  color: hsl(0 0% 100%);
  border-color: hsl(0 0% 100% / 0.22);
}
.dui-modal-btn-primary:hover {
  background: hsl(0 0% 100% / 0.25);
}
.dui-modal-btn-danger {
  background: hsl(0 70% 50% / 0.18);
  border-color: hsl(0 70% 60% / 0.35);
  color: hsl(0 80% 80%);
}
.dui-modal-btn-danger:hover {
  background: hsl(0 70% 50% / 0.3);
  color: hsl(0 80% 90%);
}

/* ── Toast — bottom-centered "dynamic island" pill for transient feedback ── */
.dui-toast-host {
  position: fixed;
  left: 50%; bottom: 28px;
  transform: translateX(-50%);
  z-index: 99999;
  pointer-events: none;
}
.dui-toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: hsl(0 0% 0% / 0.85);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  color: hsl(0 0% 98%);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding: 10px 18px;
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 999px;
  box-shadow: 0 1px 0 hsl(0 0% 100% / 0.1) inset, 0 8px 28px hsl(0 0% 0% / 0.45);
  opacity: 0;
  transform: translateY(8px) scale(0.96);
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.32, 0.72, 0.24, 1.2);
  white-space: nowrap;
  user-select: none;
}
.dui-toast.dui-toast-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.dui-toast-icon { font-size: 14px; line-height: 1; }
.dui-toast-text { letter-spacing: -0.01em; }

/* ── Contextual mode toolbar (appears on selection, pinned to Inspector left edge) ── */
.dui-context-toolbar {
  position: fixed;
  z-index: 9998;
  background: hsl(0 0% 8% / 0.85);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 12px;
  padding: 4px;
  display: none;
  /* Force the panel's body sans on every descendant. The toolbar
     mounts at document.body level, so without an explicit font-family
     here, host pages that default to a serif font (or override the
     browser default) leak their fonts into the axis inputs. The
     panel's primary CSS sets this on .ghost-panel — we mirror it
     for the toolbar since it's a sibling element. */
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
               'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  /* HORIZONTAL layout — chevron on the left, rows to its right. Collapse
     animates max-width on the rows wrapper so the toolbar appears to slide
     back into the Inspector panel; only the chevron stays exposed. */
  flex-direction: row;
  align-items: stretch;
  gap: 4px;
  box-shadow:
    0 1px 0 hsl(0 0% 100% / 0.1) inset,
    0 8px 24px hsl(0 0% 0% / 0.35);
  opacity: 0;
  transform: translateX(8px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}
/* Collapse handle — narrow vertical bar on the LEFT edge of the toolbar.
   Stays visible when collapsed so the user always has an affordance to
   pop the toolbar back out. */
.dui-context-collapse {
  flex: none;
  display: flex; align-items: center; justify-content: center;
  width: 16px; min-height: 36px;
  background: transparent;
  border: none;
  color: hsl(0 0% 100% / 0.45);
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.dui-context-collapse:hover {
  color: hsl(0 0% 100% / 0.9);
  background: hsl(0 0% 100% / 0.06);
}
.dui-context-collapse svg { display: block; transition: transform 0.22s cubic-bezier(0.4,0,0.2,1); }
/* Collapsed: chevron flips to point LEFT (◀) — "click to expand outward". */
.dui-context-toolbar-collapsed .dui-context-collapse svg { transform: rotate(180deg); }

.dui-context-toolbar-rows {
  display: flex; flex-direction: column; gap: 2px;
  max-width: 240px;
  max-height: 480px;
  opacity: 1;
  overflow: hidden;
  transition:
    max-width  0.28s cubic-bezier(0.32, 0.72, 0, 1),
    max-height 0.28s cubic-bezier(0.32, 0.72, 0, 1),
    opacity    0.18s ease;
}
/* Collapsed: shrink BOTH dimensions so the chevron (which has its own
   min-height) becomes the only thing that defines the toolbar's size.
   End result is a compact square pill instead of a tall vertical strip. */
.dui-context-toolbar-collapsed .dui-context-toolbar-rows {
  max-width: 0;
  max-height: 0;
  opacity: 0;
}
/* Compact, near-square handle when the toolbar is collapsed — height
   matches width so the whole thing reads as a single round-square chip. */
.dui-context-toolbar-collapsed .dui-context-collapse {
  min-height: 24px;
  height: 24px;
  width: 24px;
}

/* When anchored as a child of the Inspector panel, position relative to the
   panel's outer-left corner so the toolbar drags / resizes with it. */
.dui-context-toolbar.dui-context-toolbar-anchored {
  position: absolute;
  top: 8px;
  right: 100%;
  left: auto;
  margin-right: 8px;
  z-index: 1;  /* relative to the panel; panel itself owns the global stacking */
}
.dui-context-toolbar.dui-visible {
  display: flex;
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
.dui-context-btn {
  background: transparent;
  color: hsl(0 0% 100% / 0.7);
  border: none;
  width: 32px; height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.12s ease, color 0.12s ease;
  font-family: inherit;
  padding: 0;
}
.dui-context-btn:hover {
  background: hsl(0 0% 100% / 0.08);
  color: hsl(0 0% 100%);
}
.dui-context-btn.dui-active {
  background: hsl(0 0% 100% / 0.18);
  color: hsl(0 0% 100%);
}
/* Camera button "live view" state — a subtle semi-transparent white
   fill is enough to communicate active mode. The old red + pulsing dot
   read like a "recording" indicator, which is the wrong mental model.
   The Camera badge at the top of the viewport still signals the active
   POV; the button just mirrors that as a quiet active state. */
.dui-context-camera.dui-active {
  background: hsl(0 0% 100% / 0.18);
  color: hsl(0 0% 100%);
  box-shadow: none;
  position: relative;
}
/* Alignment row (2D/web): Figma-style 6-button grid — horizontal trio +
   vertical trio. Sits inside the mini toolbar chrome below the Scale row. */
.dui-context-row-align {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
  padding: 2px;
  border-top: 1px solid hsl(0 0% 100% / 0.06);
  margin-top: 2px;
}
.dui-context-row-align .dui-context-align {
  width: 100%;
  height: 26px;
  border-radius: 5px;
}
.dui-context-row-align .dui-context-align.dui-context-align-pulse {
  background: hsl(210 90% 55% / 0.25);
  color: hsl(210 90% 80%);
}

/* Material-debug row: 4 compact icon toggles. Sits inside the same toolbar
   chrome as Move/Rotate/Scale so it doesn't feel like a separate widget. */
.dui-context-row-debug {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-top: 1px solid hsl(0 0% 100% / 0.06);
  margin-top: 2px;
}
.dui-context-row-debug .dui-context-debug {
  flex: 1;
  width: auto;
  height: 24px;
  border-radius: 5px;
}
.dui-context-row-debug .dui-context-debug:disabled {
  opacity: 0.35;
  cursor: default;
}
.dui-context-row-debug .dui-context-debug.dui-active {
  background: hsl(48 100% 55% / 0.22);
  color: hsl(48 100% 80%);
  box-shadow: inset 0 0 0 1px hsl(48 100% 55% / 0.35);
}

/* Recording-dot pseudo-element retired — see .dui-context-camera.dui-active
   above. Kept the selector out so any cached snapshots don't render a
   stale red dot. */
@keyframes dui-camera-pulse {
  0%,100% { opacity: 1; }
  50%     { opacity: 0.3; }
}

/* "Looking through camera X" floating badge over the viewport.
   Appears top-center whenever ui._activeCamera is set, so the user
   always knows what they're seeing through. */
.dui-camera-badge {
  position: fixed;
  top: 16px; left: 50%; transform: translateX(-50%);
  z-index: 9997;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 12px;
  background: hsl(0 0% 0% / 0.78);
  backdrop-filter: blur(18px) saturate(180%);
  /* Neutral white-on-glass — the old red read like a record button.
     Active state is communicated by the badge appearing at all, not by
     a "recording" color. */
  border: 1px solid hsl(0 0% 100% / 0.18);
  border-radius: 999px;
  color: white;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.01em;
  box-shadow: 0 8px 24px hsl(0 0% 0% / 0.4);
  user-select: none;
}
.dui-camera-badge-dot {
  /* Small camera glyph (SVG mask) replaces the old pulsing red dot. Keeps
     the visual rhythm of the badge (icon + label + close) without the
     "recording" connotation. */
  width: 12px; height: 12px;
  background: hsl(0 0% 100% / 0.9);
  /* Phosphor "Camera" glyph (regular weight, filled body + lens cutout)
     used as an alpha mask so the dot tints to the badge's white text
     color. Kept inline as a data URI because CSS masks can't reference
     remote SVGs without CORS headaches. */
  mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="black" d="M208,56H180.3L168,33.5A16,16,0,0,0,153.7,24H102.3A16,16,0,0,0,88,33.5L75.7,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56ZM128,176a44,44,0,1,1,44-44A44,44,0,0,1,128,176Z"/></svg>') center / contain no-repeat;
  -webkit-mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="black" d="M208,56H180.3L168,33.5A16,16,0,0,0,153.7,24H102.3A16,16,0,0,0,88,33.5L75.7,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56ZM128,176a44,44,0,1,1,44-44A44,44,0,0,1,128,176Z"/></svg>') center / contain no-repeat;
}
.dui-camera-badge-exit {
  background: transparent;
  border: none;
  color: hsl(0 0% 100% / 0.6);
  font-size: 16px; line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.dui-camera-badge-exit:hover {
  background: hsl(0 0% 100% / 0.08);
  color: white;
}

/* Composition-guides toggle on the camera badge. Lives between the
   label and the exit X, mimics their visual treatment, and gets the
   white-tint active state we use elsewhere when looking through a
   camera so the on/off state is obvious at a glance. */
.dui-camera-badge-grid {
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: none;
  color: hsl(0 0% 100% / 0.6);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.12s ease, color 0.12s ease;
}
.dui-camera-badge-grid svg { display: block; }
.dui-camera-badge-grid:hover {
  background: hsl(0 0% 100% / 0.08);
  color: white;
}
.dui-camera-badge-grid.dui-active {
  background: hsl(0 0% 100% / 0.18);
  color: white;
}

/* Composition grid overlay — fullscreen, non-interactive, drawn on
   top of the viewport while looking through a camera. The SVG uses
   preserveAspectRatio none so the grid stretches edge-to-edge in
   whatever aspect the canvas happens to be. Thin lines at 33%/66%
   give a rule-of-thirds composition, plus a small center crosshair. */
.dui-camera-grid {
  position: fixed; inset: 0;
  z-index: 9996;
  pointer-events: none;
}
.dui-camera-grid svg {
  width: 100%; height: 100%; display: block;
}
.dui-camera-grid svg line {
  stroke: hsl(0 0% 100% / 0.35);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  /* Subtle dark stroke underneath so the lines stay visible against
     bright backgrounds — paired with the white-35% stroke above this
     reads on any scene without competing with content. */
  paint-order: stroke fill;
}

/* ── Mini transform row: icon + X/Y/Z numeric inputs ── */
.dui-context-row {
  display: flex; align-items: center; gap: 2px;
  padding-right: 4px;
}
.dui-context-row .dui-context-btn {
  width: 26px; height: 26px;
  border-radius: 6px;
}
.dui-context-num {
  width: 48px;
  height: 22px;
  padding: 0 4px;
  /* Body sans (with tabular numerals for stable digit alignment) —
     consistent with every other numeric input across the tool. The
     old monospace stack read as too utilitarian next to the panel's
     other rows. */
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
  font-weight: 500;
  background: hsl(0 0% 100% / 0.05);
  color: hsl(0 0% 100% / 0.92);
  border: 1px solid hsl(0 0% 100% / 0.06);
  border-radius: 4px;
  outline: none;
  text-align: center;
  cursor: ew-resize;
  -webkit-appearance: none;
  appearance: none;
  -moz-appearance: textfield;
  box-sizing: border-box;
}
.dui-context-num::-webkit-outer-spin-button,
.dui-context-num::-webkit-inner-spin-button {
  -webkit-appearance: none; margin: 0;
}
.dui-context-num:hover  { background: hsl(0 0% 100% / 0.08); }
.dui-context-num:focus  {
  background: hsl(0 0% 100% / 0.1);
  border-color: hsl(0 0% 100% / 0.25);
  cursor: text;
}
.dui-context-num.dui-context-num-drag {
  background: hsl(210 90% 55% / 0.18);
  border-color: hsl(210 90% 65% / 0.4);
}
/* Empty placeholder cells in 2D rows (e.g. the third slot of the Move
   row, since 2D has no Z). Take up the layout space silently so the row
   matches the 3D layout's three-column grid, but show no chrome. */
.dui-context-num.dui-context-num-placeholder {
  background: transparent;
  border: none;
  box-shadow: none;
  pointer-events: none;
  visibility: hidden;
}

/* Axis labels inline with each numeric cell (Blender colors: X=red, Y=green,
   Z=blue). The tag sits inside the input's wrapper, before the value. */
.dui-axis-cell {
  display: inline-flex; align-items: center; gap: 0;
  position: relative;
  background: hsl(0 0% 100% / 0.05);
  border: 1px solid hsl(0 0% 100% / 0.06);
  border-radius: 4px;
  overflow: hidden;
}
.dui-axis-cell:hover  { background: hsl(0 0% 100% / 0.08); }
.dui-axis-cell:focus-within {
  background: hsl(0 0% 100% / 0.1);
  border-color: hsl(0 0% 100% / 0.25);
}
.dui-axis-tag {
  font-family: var(--dui-font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0 4px;
  height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  background: hsl(0 0% 100% / 0.06);
  color: hsl(0 0% 100% / 0.85);
  user-select: none;
}
.dui-axis-x   { color: hsl(0   85% 70%); }
.dui-axis-y   { color: hsl(120 60% 65%); }
.dui-axis-z   { color: hsl(210 90% 70%); }
.dui-axis-rot { color: hsl(280 70% 75%); }
/* When the axis cell wraps an input, strip the input's own border/background
   so the cell + tag read as a single chip. */
.dui-axis-cell .dui-context-num {
  background: transparent;
  border: none;
  border-radius: 0;
  width: 44px;
}
.dui-axis-cell .dui-context-num:hover,
.dui-axis-cell .dui-context-num:focus { background: transparent; border: none; }

/* ── Tooltip (long-hover) ── */
.dui-tooltip {
  position: fixed;
  z-index: 99999;
  pointer-events: none;
  background: hsl(0 0% 6% / 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  color: hsl(0 0% 98%);
  border: 1px solid hsl(0 0% 100% / 0.12);
  border-radius: 8px;
  padding: 6px 10px;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  line-height: 1.3;
  max-width: 260px;
  box-shadow:
    0 1px 0 hsl(0 0% 100% / 0.1) inset,
    0 4px 16px hsl(0 0% 0% / 0.4);
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dui-tooltip.dui-tooltip-visible {
  opacity: 1;
  transform: translateY(0);
}

/* ── Resize handle ── */
.dui-resizer {
  position: absolute;
  top: 0; bottom: 0;
  width: 6px;
  cursor: ew-resize;
  background: transparent;
  transition: background 0.15s ease;
  z-index: 1;
}
.dui-resizer-left  { left: -3px; }
.dui-resizer-right { right: -3px; }
.dui-resizer:hover { background: hsl(var(--primary) / 0.3); }
.dui-resizer:active { background: hsl(var(--primary) / 0.5); }

/* Make the panel itself relative so the resizer's absolute pos anchors correctly */
.ghost-panel { position: fixed; }


/* ════════════════════════════════════════════════════════════════════════
   Blender-style 3D controls — auto-applied to panels with .dui-blender3d.
   The scene/object panel automatically gets this class. Mimics Blender's
   compact UI: tighter rows, pixel-rectangular buttons, blue selection,
   inline value display on sliders.
   ════════════════════════════════════════════════════════════════════════ */
.ghost-panel.dui-blender3d {
  /* Blender's signature dark theme colors */
  --background:             0 0% 12%;       /* #1f1f1f base */
  --foreground:             0 0% 87%;       /* #dddddd text */
  --card:                   0 0% 15%;       /* #262626 panel */
  --card-foreground:        0 0% 87%;
  --muted:                  0 0% 22%;       /* #383838 sunken */
  --muted-foreground:       0 0% 60%;       /* #999999 labels */
  --border:                 0 0% 8%;        /* #141414 sharp edges */
  --input:                  0 0% 28%;       /* #474747 input bg */
  --primary:                210 60% 56%;    /* #5680c2 Blender blue (selection) */
  --primary-foreground:     0 0% 100%;
  --secondary:              0 0% 30%;       /* #4d4d4d button bg */
  --secondary-foreground:   0 0% 90%;
  --accent:                 210 60% 56%;
  --accent-foreground:      0 0% 100%;
  --destructive:            7 88% 53%;      /* #ec6817 Blender orange-ish */
  --ring:                   210 60% 56%;
  --radius:                 2px;            /* Pixel-rectangular */

  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 11px;
  letter-spacing: 0;
}

/* Header — Blender's flat, compact title bar */
.ghost-panel.dui-blender3d .dui-header {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  background: hsl(var(--muted));
  border-bottom: 1px solid hsl(var(--border));
}
.ghost-panel.dui-blender3d .dui-header-btn {
  width: 18px; height: 18px;
  font-size: 12px;
  border-radius: 2px;
}

/* Folders — tight, no decoration */
.ghost-panel.dui-blender3d .dui-folder-header {
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--background));
  border-top: 1px solid hsl(var(--border));
}
.ghost-panel.dui-blender3d .dui-folder-header:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}
.ghost-panel.dui-blender3d .dui-folder-body { padding: 4px 8px 8px; }

/* Rows — compact spacing */
.ghost-panel.dui-blender3d .dui-row {
  margin: 2px 0;
  gap: 4px;
}
.ghost-panel.dui-blender3d .dui-row label {
  font-size: 10px;
  width: 60px;
  color: hsl(var(--foreground));
  font-weight: 400;
}

/* Sliders — Blender style: rectangular bar with filled value indicator */
.ghost-panel.dui-blender3d .dui-row input[type="range"] {
  height: 18px;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 2px;
  -webkit-appearance: none; appearance: none;
}
.ghost-panel.dui-blender3d .dui-row input[type="range"]::-webkit-slider-runnable-track {
  height: 16px;
  background: transparent;
  border-radius: 0;
}
.ghost-panel.dui-blender3d .dui-row input[type="range"]::-moz-range-track {
  height: 16px;
  background: transparent;
}
.ghost-panel.dui-blender3d .dui-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 3px; height: 18px;
  background: hsl(var(--primary));
  border: none; border-radius: 1px;
  margin-top: -1px;
  cursor: ew-resize;
  box-shadow: none;
}
.ghost-panel.dui-blender3d .dui-row input[type="range"]::-moz-range-thumb {
  width: 3px; height: 18px;
  background: hsl(var(--primary));
  border: none; border-radius: 1px;
  cursor: ew-resize;
}
.ghost-panel.dui-blender3d .dui-row input[type="range"]:hover {
  background: hsl(var(--input) / 1.2);
  border-color: hsl(var(--primary));
}

/* Number inputs — flat, embedded look */
.ghost-panel.dui-blender3d .dui-row input[type="number"] {
  width: 50px; height: 18px;
  padding: 0 4px;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 2px;
  font-size: 10px;
  text-align: right;
}
.ghost-panel.dui-blender3d .dui-row input[type="number"]:hover {
  border-color: hsl(var(--primary));
}
.ghost-panel.dui-blender3d .dui-row input[type="number"]:focus {
  border-color: hsl(var(--primary));
  background: hsl(var(--background));
  box-shadow: none;
}

/* Checkboxes — small, square, Blender-style filled */
.ghost-panel.dui-blender3d .dui-row input[type="checkbox"] {
  width: 14px; height: 14px;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 2px;
}
.ghost-panel.dui-blender3d .dui-row input[type="checkbox"]:checked {
  background: hsl(var(--primary));
  border-color: hsl(var(--border));
}
.ghost-panel.dui-blender3d .dui-row input[type="checkbox"]:checked::after {
  width: 3px; height: 7px;
  border-color: hsl(var(--primary-foreground));
  border-width: 0 2px 2px 0;
}

/* Buttons — pixel-rectangular, flat */
.ghost-panel.dui-blender3d .dui-btn {
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  border: 1px solid hsl(var(--border));
  padding: 3px 10px;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 400;
  height: 22px;
  min-height: 22px;
}
.ghost-panel.dui-blender3d .dui-btn:hover {
  background: hsl(var(--secondary) / 1.15);
  border-color: hsl(var(--primary));
}
.ghost-panel.dui-blender3d .dui-btn:active,
.ghost-panel.dui-blender3d .dui-btn.dui-active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--border));
}
.ghost-panel.dui-blender3d .dui-btn-row {
  gap: 1px;          /* Tight, Blender-style button group */
  margin: 4px 0;
}
.ghost-panel.dui-blender3d .dui-btn-row .dui-btn {
  border-radius: 0;
}
.ghost-panel.dui-blender3d .dui-btn-row .dui-btn:first-child {
  border-radius: 2px 0 0 2px;
}
.ghost-panel.dui-blender3d .dui-btn-row .dui-btn:last-child {
  border-radius: 0 2px 2px 0;
}

/* Color picker — rectangular, no rounded edges */
.ghost-panel.dui-blender3d .dui-row input[type="color"] {
  width: 30px; height: 18px;
  border-radius: 2px;
  border: 1px solid hsl(var(--border));
}

/* Select dropdowns — match input style */
.ghost-panel.dui-blender3d .dui-row select {
  height: 18px;
  padding: 0 4px;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 2px;
  font-size: 10px;
}

/* Scene-tree style list (Blender's Outliner) */
.ghost-panel.dui-blender3d .dui-list {
  gap: 0;
  margin: 4px 0;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 2px;
  padding: 2px;
}
.ghost-panel.dui-blender3d .dui-list-item {
  background: transparent;
  border: none;
  border-radius: 1px;
  padding: 2px 6px;
  margin: 0;
}
.ghost-panel.dui-blender3d .dui-list-item:hover {
  background: hsl(var(--muted));
}
.ghost-panel.dui-blender3d .dui-list-item.dui-selected {
  background: hsl(var(--primary));
  border: none;
}
.ghost-panel.dui-blender3d .dui-list-item.dui-selected .dui-name {
  color: hsl(var(--primary-foreground));
}
.ghost-panel.dui-blender3d .dui-list-item .dui-name {
  font-size: 11px;
  font-weight: 400;
}
.ghost-panel.dui-blender3d .dui-list-item .dui-actions button {
  padding: 0 6px;
  height: 16px;
  font-size: 9px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
}
.ghost-panel.dui-blender3d .dui-list-item:hover .dui-actions button {
  border-color: hsl(var(--border));
  background: hsl(var(--secondary));
}

/* ════════════════════════════════════════════════════════════════════════
   Blender "number field" — the iconic combined widget. A single bar with
   label on the left, value on the right, a filled progress bar behind it,
   and hover arrows. Drag horizontally to scrub, click to type.
   ════════════════════════════════════════════════════════════════════════ */
.dui-bfield {
  --dui-bfield-fill: 0%;
  position: relative;
  display: flex; align-items: center;
  height: 20px;
  padding: 0 14px;
  margin: 1px 0;
  background: hsl(0 0% 25%);
  border: 1px solid hsl(0 0% 8%);
  border-radius: 3px;
  cursor: ew-resize;
  user-select: none;
  font-size: 11px;
  color: hsl(0 0% 90%);
  overflow: hidden;
}
/* Fill bar via gradient — JS sets --dui-bfield-fill to "63%" etc. */
.dui-bfield::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to right,
    hsl(210 60% 56%) var(--dui-bfield-fill),
    transparent var(--dui-bfield-fill));
  pointer-events: none;
  border-radius: 2px;
}
.dui-bfield:hover {
  border-color: hsl(210 60% 56%);
  background: hsl(0 0% 30%);
}
.dui-bfield.dui-bfield-dragging { cursor: grabbing; }

.dui-bfield-label,
.dui-bfield-value {
  position: relative; /* sit above ::before fill */
  z-index: 1;
  white-space: nowrap;
}
.dui-bfield-label {
  color: hsl(0 0% 100%);
  font-weight: 400;
  flex-shrink: 0;
  margin-right: auto;
  padding-right: 8px;
  text-shadow: 0 0 2px rgba(0,0,0,0.5);
}
.dui-bfield-value {
  color: hsl(0 0% 100%);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  text-shadow: 0 0 2px rgba(0,0,0,0.5);
}

/* Hover arrows for click-to-step */
.dui-bfield-arrow {
  position: absolute;
  top: 0; bottom: 0;
  width: 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 8px;
  color: hsl(0 0% 100%);
  opacity: 0;
  transition: opacity 0.1s ease;
  cursor: pointer;
  z-index: 2;
}
.dui-bfield-arrow-l { left: 0; }
.dui-bfield-arrow-r { right: 0; }
.dui-bfield:hover .dui-bfield-arrow { opacity: 0.7; }
.dui-bfield-arrow:hover { opacity: 1; background: hsl(0 0% 0% / 0.2); }

/* Text-edit mode (click without drag) */
.dui-bfield-edit {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  border: none;
  background: hsl(0 0% 25%);
  color: hsl(0 0% 100%);
  font-family: inherit;
  font-size: 11px;
  text-align: center;
  padding: 0;
  outline: 2px solid hsl(210 60% 56%);
  z-index: 3;
}

/* Vec3 group — stacked fields with section label above */
.dui-bvec3 { margin: 4px 0; }
.dui-bvec3-label {
  font-size: 10px;
  color: hsl(0 0% 65%);
  margin-bottom: 2px;
  padding-left: 2px;
}

/* ════════════════════════════════════════════════════════════════════════
   Liquid Glass — Apple's iOS 26 design language. Apply via .dui-liquid-glass.
   Frosted backdrop, specular edge highlights, translucent pill controls,
   adaptive tinting. Inspired by github.com/DnV1eX/LiquidGlassKit (Swift).
   ════════════════════════════════════════════════════════════════════════ */
.ghost-panel.dui-liquid-glass {
  /* Translucent surfaces — backdrop blur does the heavy lifting */
  --background:             0 0% 100% / 0.04;
  --foreground:             0 0% 100%;
  --card:                   0 0% 100% / 0.06;
  --card-foreground:        0 0% 100%;
  --muted:                  0 0% 100% / 0.08;
  --muted-foreground:       0 0% 100% / 0.6;
  --border:                 0 0% 100% / 0.12;
  --input:                  0 0% 100% / 0.08;
  --primary:                0 0% 100%;
  --primary-foreground:     0 0% 0% / 0.9;
  --secondary:              0 0% 100% / 0.12;
  --secondary-foreground:   0 0% 100%;
  --accent:                 0 0% 100% / 0.18;
  --accent-foreground:      0 0% 100%;
  --ring:                   0 0% 100% / 0.6;
  --radius:                 1rem;

  background: hsl(0 0% 8% / 0.55);
  border: 1px solid hsl(0 0% 100% / 0.15);
  border-radius: 20px;
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow:
    0 1px 0 0 hsl(0 0% 100% / 0.12) inset,        /* top inner highlight (specular) */
    0 -1px 0 0 hsl(0 0% 0% / 0.3)  inset,         /* bottom inner shadow (depth) */
    0 20px 50px -10px hsl(0 0% 0% / 0.5),         /* soft drop shadow */
    0 0 0 1px hsl(0 0% 100% / 0.04) inset;        /* edge refraction */
  position: fixed;
  overflow: hidden;
}

/* Light-mode liquid glass — the panel surface adapts to bright
   backgrounds. Only color tokens + the surface itself are touched —
   no individual control overrides (those would re-deviate from the
   shipped design). */
.ghost-panel.dui-liquid-glass.dui-liquid-light {
  --foreground:             0 0% 0% / 0.85;
  --card-foreground:        0 0% 0% / 0.85;
  --muted-foreground:       0 0% 0% / 0.55;
  --border:                 0 0% 0% / 0.1;
  --primary:                0 0% 0% / 0.85;
  --primary-foreground:     0 0% 100%;
  --secondary:              0 0% 0% / 0.06;
  --secondary-foreground:   0 0% 0% / 0.85;
  background: hsl(0 0% 100% / 0.55);
  border-color: hsl(0 0% 100% / 0.6);
  box-shadow:
    0 1px 0 0 hsl(0 0% 100% / 0.7) inset,
    0 -1px 0 0 hsl(0 0% 0% / 0.05) inset,
    0 20px 50px -10px hsl(0 0% 0% / 0.15);
}

/* ── No more liquid-glass control overrides past this point ──
   Header, folder, row, slider, input, button, list-item, bfield —
   they all use the core control design. The user's "design we built
   together" wins. Liquid Glass is intentionally just a panel-surface
   treatment now (frosted background + blur + bigger radius). */

/* ── Graph editor bind popup (canvas-anchored, Add-menu style) ───── */
.dui-bind-popup {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) scale(0.98);
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: 70vh;
  background: hsl(0 0% 8% / 0.92);
  color: hsl(0 0% 98%);
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 12px;
  box-shadow: 0 24px 60px hsl(0 0% 0% / 0.5);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  z-index: 100000;
  font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  display: none;
  flex-direction: column;
  opacity: 0;
  transition: opacity 120ms ease, transform 120ms ease;
}
.dui-bind-popup.dui-visible {
  display: flex;
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.dui-bind-popup-header {
  padding: 10px 12px 8px;
  display: flex; align-items: center; gap: 10px;
  border-bottom: 1px solid hsl(0 0% 100% / 0.06);
}
.dui-bind-popup-title {
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: hsl(0 0% 100% / 0.55);
  flex-shrink: 0;
}
.dui-bind-popup-object {
  flex: 1;
  padding: 4px 8px;
  font: inherit; font-size: 12px;
  background: hsl(0 0% 100% / 0.06);
  color: inherit;
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 6px;
  outline: none;
  cursor: pointer;
}
.dui-bind-popup-object:focus { border-color: hsl(0 0% 100% / 0.3); }
.dui-bind-popup-search-wrap { padding: 8px 10px 0; }
.dui-bind-popup-search {
  width: 100%;
  padding: 7px 10px;
  font: inherit; font-size: 12px;
  background: hsl(0 0% 100% / 0.06);
  color: inherit;
  border: 1px solid hsl(0 0% 100% / 0.08);
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
}
.dui-bind-popup-search:focus { border-color: hsl(0 0% 100% / 0.3); }
.dui-bind-popup-search::placeholder { color: hsl(0 0% 100% / 0.35); }
.dui-bind-popup-list {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 6px;
}
.dui-bind-popup-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: hsl(0 0% 100% / 0.85);
  gap: 12px;
}
.dui-bind-popup-item.dui-active  { background: hsl(0 0% 100% / 0.1); }
.dui-bind-popup-item:hover       { background: hsl(0 0% 100% / 0.08); }
.dui-bind-popup-item.dui-disabled {
  opacity: 0.4; cursor: not-allowed;
}
.dui-bind-popup-path {
  font-family: var(--dui-font-mono);
  font-size: 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dui-bind-popup-value {
  font-family: var(--dui-font-mono);
  font-size: 11px;
  color: hsl(0 0% 100% / 0.45);
  flex-shrink: 0;
}
.dui-bind-popup-footer {
  display: flex; gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid hsl(0 0% 100% / 0.06);
  font-size: 10px;
  color: hsl(0 0% 100% / 0.4);
}
.dui-bind-popup-footer kbd {
  font: inherit;
  background: hsl(0 0% 100% / 0.08);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--dui-font-mono);
}

/* ── F-curve tangent handles ──────────────────────────────────────── */
.dui-graph-tangent-line {
  stroke: hsl(0 0% 100% / 0.4);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  pointer-events: none;
}
.dui-graph-tangent-handle {
  stroke: hsl(0 0% 100% / 0.9);
  stroke-width: 1.5;
  cursor: grab;
}
.dui-graph-tangent-handle:active { cursor: grabbing; }

/* ── Easing scratchpad (shown when a key is selected) ─────────────── */
.dui-graph-scratchpad {
  border-top: 1px solid hsl(0 0% 100% / 0.06);
  padding: 8px 10px 10px;
}
.dui-graph-scratchpad-header {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 8px;
}
.dui-graph-scratchpad-title {
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: hsl(0 0% 100% / 0.55);
}
.dui-graph-scratchpad-info {
  font-family: var(--dui-font-mono);
  font-size: 10px;
  color: hsl(0 0% 100% / 0.45);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dui-graph-scratchpad-body {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 12px;
  align-items: stretch;
}
.dui-graph-scratchpad-curve {
  width: 100px; height: 100px;
  background: hsl(0 0% 100% / 0.03);
  border: 1px solid hsl(0 0% 100% / 0.06);
  border-radius: 6px;
}
.dui-graph-scratchpad-diag {
  stroke: hsl(0 0% 100% / 0.08);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}
.dui-graph-scratchpad-line {
  fill: none;
  stroke: hsl(210 90% 65%);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.dui-graph-scratchpad-tan {
  stroke: hsl(0 0% 100% / 0.35);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}
.dui-graph-scratchpad-cp {
  fill: hsl(210 90% 65%);
  stroke: white;
  stroke-width: 1.2;
  cursor: grab;
}
/* ── Easing preset dropdown ──────────────────────────────────────────
   Trigger button shows the currently-applied preset's curve + label.
   The full preset list is hidden inside a popover that opens on click,
   so the scratchpad stays compact (the old inline grid had ~17 buttons
   crowding the panel). */
.dui-easing-picker {
  position: relative;
  width: 100%;
}
.dui-easing-trigger {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.dui-easing-trigger:hover { background: hsl(var(--input) / 0.85); }
.dui-easing-picker.dui-open .dui-easing-trigger,
.dui-easing-trigger:focus-visible {
  border-color: hsl(var(--ring) / 0.6);
  outline: none;
}
.dui-easing-trigger-preview {
  width: 18px; height: 18px;
  color: hsl(0 0% 100% / 0.75);
  flex: none;
}
.dui-easing-trigger-label {
  flex: 1; text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dui-easing-trigger-chevron {
  width: 12px; height: 12px;
  color: hsl(0 0% 100% / 0.55);
  flex: none;
  transition: transform 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.dui-easing-picker.dui-open .dui-easing-trigger-chevron { transform: rotate(180deg); }

.dui-easing-popover {
  position: fixed;
  z-index: 10001;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  background: hsl(0 0% 8% / 0.96);
  backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid hsl(0 0% 100% / 0.1);
  border-radius: 8px;
  box-shadow: 0 12px 32px hsl(0 0% 0% / 0.55);
  display: flex; flex-direction: column;
  gap: 2px;
}
.dui-easing-option {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: 0; outline: none;
  border-radius: 5px;
  color: hsl(0 0% 100% / 0.85);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease, color 0.1s ease;
}
.dui-easing-option:hover { background: hsl(0 0% 100% / 0.08); }
.dui-easing-option.dui-active {
  background: hsl(var(--ring) / 0.16);
  color: hsl(0 0% 100%);
}
.dui-easing-option-preview {
  width: 16px; height: 16px;
  color: hsl(0 0% 100% / 0.7);
  flex: none;
}
.dui-easing-option.dui-active .dui-easing-option-preview {
  color: hsl(var(--ring));
}
.dui-easing-option-label { flex: 1; }

/* ── Diagnostic health badge ─────────────────────────────────────────────── */
.dui-health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--diag-color, #6b7280);
  border: none;
  padding: 0;
  cursor: pointer;
  flex: none;
  align-self: center;
  margin-right: 4px;
  transition: background 300ms ease, transform 150ms ease;
  position: relative;
}
.dui-health-dot:hover { transform: scale(1.4); }
.dui-health-dot--pulse {
  animation: dui-diag-pulse 2s ease-in-out infinite;
}
@keyframes dui-diag-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--diag-color, #facc15); }
  50%       { box-shadow: 0 0 0 4px transparent; }
}

/* ── Diagnostic overlay ──────────────────────────────────────────────────── */
.dui-diag-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
               'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
}
.dui-diag-panel {
  background: #111113;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  width: min(520px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 24px 64px rgba(0,0,0,0.7);
  display: flex;
  flex-direction: column;
}
.dui-diag-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  gap: 8px;
}
.dui-diag-status {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dui-diag-status--healthy { color: #4ade80; }
.dui-diag-status--warning { color: #facc15; }
.dui-diag-status--error   { color: #f87171; }
.dui-diag-status--info    { color: #60a5fa; }
.dui-diag-status--checking{ color: #6b7280; }
.dui-diag-close {
  background: none;
  border: none;
  color: rgba(255,255,255,0.4);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
  transition: color 120ms;
}
.dui-diag-close:hover { color: #fff; }
.dui-diag-meta {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-wrap: wrap;
}
.dui-diag-meta strong { color: rgba(255,255,255,0.7); }
.dui-diag-issues { padding: 10px 16px; display: flex; flex-direction: column; gap: 10px; }
.dui-diag-section-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.3);
  padding: 6px 16px 0;
}
.dui-diag-issue {
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dui-diag-error   { background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248,113,113,0.25); }
.dui-diag-warning { background: rgba(250, 204,  21, 0.08); border: 1px solid rgba(250,204,21,0.2); }
.dui-diag-info    { background: rgba( 96, 165, 250, 0.08); border: 1px solid rgba(96,165,250,0.2); }
.dui-diag-resolved{ background: rgba( 74, 222, 128, 0.07); border: 1px solid rgba(74,222,128,0.18); }
/* Advisory host-page sweep: dimmer than a real info issue so it reads as a
   freebie ("here's something to look at") rather than an integration problem. */
.dui-diag-advisory{ background: rgba(148, 163, 184, 0.06); border: 1px dashed rgba(148,163,184,0.28); }
.dui-diag-issue-title  { font-weight: 600; color: rgba(255,255,255,0.88); font-size: 13px; }
.dui-diag-issue-detail { color: rgba(255,255,255,0.5); font-size: 12px; line-height: 1.5; }
.dui-diag-code {
  background: rgba(0,0,0,0.4);
  border-radius: 5px;
  padding: 8px 10px;
  font-size: 11.5px;
  color: #93c5fd;
  white-space: pre;
  overflow-x: auto;
  margin-top: 2px;
  line-height: 1.55;
  font-family: var(--dui-font-mono);
}
.dui-diag-all-good {
  color: #4ade80;
  text-align: center;
  padding: 16px 0;
  font-size: 13px;
}
.dui-diag-btn {
  margin-top: 6px;
  align-self: flex-start;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px;
  color: rgba(255,255,255,0.75);
  font-family: var(--dui-font-mono);
  font-size: 11.5px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}
.dui-diag-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
.dui-diag-btn--secondary {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.45);
  margin-top: 0;
}
.dui-diag-btn--secondary:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); }
.dui-diag-footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px 14px;
  border-top: 1px solid rgba(255,255,255,0.07);
  flex-wrap: wrap;
}

/* ── Augment — natural language panel builder ─────────────────────────────── */

/* Trigger button (? icon) in the header */
.dui-augment-trigger {
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.12);
  background: transparent;
  color: rgba(255,255,255,0.45);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
  flex: none;
}
.dui-augment-trigger:hover {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.85);
  border-color: rgba(255,255,255,0.25);
}
.dui-augment-trigger--active {
  background: rgba(139,92,246,0.2);
  color: #a78bfa;
  border-color: rgba(139,92,246,0.4);
}

/* Sliding prompt bar that appears below the header */
.dui-augment-bar {
  overflow: hidden;
  max-height: 0;
  transition: max-height 250ms cubic-bezier(0.4,0,0.2,1),
              opacity 200ms ease,
              padding 200ms ease;
  opacity: 0;
  padding: 0 10px;
  border-bottom: 1px solid transparent;
  background: rgba(0,0,0,0.25);
}
.dui-augment-bar--open {
  max-height: 120px;
  opacity: 1;
  padding: 10px;
  border-bottom-color: rgba(255,255,255,0.07);
}

/* Text input */
.dui-augment-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 7px;
  padding: 7px 10px;
  color: rgba(255,255,255,0.9);
  font-size: 12px;
  font-family: var(--dui-font-mono);
  outline: none;
  transition: border-color 150ms ease, background 150ms ease;
  margin-bottom: 8px;
}
.dui-augment-input::placeholder { color: rgba(255,255,255,0.28); }
.dui-augment-input:focus {
  border-color: rgba(139,92,246,0.5);
  background: rgba(139,92,246,0.06);
}

/* Suggestion chips row */
.dui-augment-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-bottom: 2px;
}
.dui-augment-chip {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  white-space: nowrap;
  user-select: none;
}
.dui-augment-chip:hover {
  background: rgba(139,92,246,0.15);
  color: #c4b5fd;
  border-color: rgba(139,92,246,0.35);
}
/* Answer chips for a clarifying question — accented so they read as the
   actionable options of a prompt rather than passive suggestions. */
.dui-augment-chip--option {
  background: rgba(139,92,246,0.16);
  color: #d6caff;
  border-color: rgba(139,92,246,0.4);
  font-weight: 500;
}
.dui-augment-chip--option:hover {
  background: rgba(139,92,246,0.3);
  color: #fff;
  border-color: rgba(139,92,246,0.6);
}

/* Toast notification */
.dui-augment-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(12px);
  background: #18181b;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: rgba(255,255,255,0.85);
  font-family: var(--dui-font-mono);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 99998;
  opacity: 0;
  transition: opacity 200ms ease, transform 200ms ease;
  pointer-events: none;
  white-space: nowrap;
}
.dui-augment-toast--visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: auto;
}
.dui-augment-toast-btn {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.6);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
  font-family: var(--dui-font-mono);
}
.dui-augment-toast-btn:hover {
  background: rgba(255,255,255,0.12);
  color: #fff;
}

/* ── Prompt analytics rows (inside diagnostic overlay) ─────────────────────── */

.dui-diag-prompts { padding: 2px 16px 10px; }

.dui-diag-prompt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.dui-diag-prompt-row:last-of-type { border-bottom: none; }

.dui-diag-prompt-text {
  flex: 1;
  font-size: 12px;
  color: rgba(255,255,255,0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dui-diag-prompt-count {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  flex: none;
}
.dui-diag-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  flex: none;
}
.dui-diag-pill--hit  { background: rgba(74,222,128,0.12);  color: #4ade80; }
.dui-diag-pill--miss { background: rgba(250,204,21,0.12);  color: #facc15; }

.dui-diag-prompt-hint {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  margin: 8px 0 0;
  line-height: 1.5;
  font-style: normal;
}
.dui-diag-prompt-hint em { color: #facc15; font-style: normal; }

.dui-diag-meta-inline {
  font-weight: 400;
  color: rgba(255,255,255,0.3);
  font-size: 10px;
  margin-left: 6px;
}

/* Accessibility: respect the user's reduced-motion preference for Ghost
   Panel's own chrome (entrance/transition/loop animations). Scoped to our
   own [class*="dui-"] elements so we never override the host app's motion —
   honoring the preference for our UI without touching theirs. Near-zero
   durations (rather than none) keep state changes instant but jump-free. */
@media (prefers-reduced-motion: reduce) {
  [class*="dui-"],
  [class*="dui-"] * {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
  }
}

/* ── Unified light mode for body-appended surfaces ──────────────────────────
   The panels themselves flip via inline theme vars on their .ghost-panel root.
   But toasts, the contextual toolbar, the camera badge, modals and the
   diagnostics overlay mount to <body>, OUTSIDE any .ghost-panel, so they can't
   inherit those vars and their backgrounds are hard-coded dark. The unified
   theme toggle adds .dui-theme-light to <html> AND mirrors the active theme's
   vars onto :root — so descendant text that already reads hsl(var(--…)) flips
   automatically, and these rules flip the hard-coded backgrounds/edges to a
   matching light glass. Purely additive: dark mode (no class) is untouched. */
:root.dui-theme-light .dui-toast {
  background: hsl(0 0% 100% / 0.9);
  color: hsl(240 10% 8%);
  border-color: hsl(240 6% 10% / 0.1);
  box-shadow: 0 1px 0 hsl(0 0% 100% / 0.6) inset, 0 8px 28px hsl(240 10% 10% / 0.18);
}
:root.dui-theme-light .dui-context-toolbar {
  background: hsl(0 0% 100% / 0.85);
  border-color: hsl(240 6% 10% / 0.1);
  box-shadow: 0 8px 28px hsl(240 10% 10% / 0.16);
}
:root.dui-theme-light .dui-camera-badge {
  background: hsl(0 0% 100% / 0.82);
  color: hsl(240 10% 8%);
  border-color: hsl(240 6% 10% / 0.12);
  box-shadow: 0 8px 24px hsl(240 10% 10% / 0.18);
}
/* The camera grid lines read white-on-dark by default; in light mode darken
   the primary stroke so they stay visible over a bright viewport. */
:root.dui-theme-light .dui-camera-grid svg line {
  stroke: hsl(240 10% 10% / 0.35);
}
:root.dui-theme-light .dui-modal-backdrop {
  background: hsl(240 10% 20% / 0.3);
}
:root.dui-theme-light .dui-modal {
  background: hsl(0 0% 100% / 0.97);
  color: hsl(240 10% 8%);
  border-color: hsl(240 6% 10% / 0.1);
  box-shadow: 0 24px 64px hsl(240 10% 10% / 0.25);
}
:root.dui-theme-light .dui-modal-axis-free,
:root.dui-theme-light .dui-modal-tip { color: hsl(240 4% 40%); }
/* Diagnostics overlay — dev surface, but "all UI" means it flips too. */
:root.dui-theme-light .dui-diag-overlay { background: hsl(240 10% 20% / 0.35); }
:root.dui-theme-light .dui-diag-panel {
  background: hsl(0 0% 100%);
  border-color: hsl(240 6% 10% / 0.1);
  color: hsl(240 10% 8%);
  box-shadow: 0 24px 64px hsl(240 10% 10% / 0.28);
}
:root.dui-theme-light .dui-diag-header { border-bottom-color: hsl(240 6% 10% / 0.08); }
:root.dui-theme-light .dui-diag-close { color: hsl(240 5% 45%); }
:root.dui-theme-light .dui-diag-close:hover { color: hsl(240 10% 8%); }
:root.dui-theme-light .dui-diag-meta strong { color: hsl(240 8% 30%); }
:root.dui-theme-light .dui-diag-issue-title  { color: hsl(240 10% 12%); }
:root.dui-theme-light .dui-diag-issue-detail { color: hsl(240 5% 38%); }
:root.dui-theme-light .dui-diag-btn { background: hsl(240 6% 10% / 0.06); }
:root.dui-theme-light .dui-diag-btn:hover { background: hsl(240 6% 10% / 0.12); color: hsl(240 10% 8%); }
:root.dui-theme-light .dui-diag-btn--secondary:hover { background: hsl(240 6% 10% / 0.06); color: hsl(240 8% 25%); }
/* Smart-add fallback toast (shown after adding a custom control) + its
   "Copy code" action button. Body-mounted and hard-coded dark, so flip them
   to match the light glass like every other surface above. */
:root.dui-theme-light .dui-augment-toast {
  background: hsl(0 0% 100% / 0.95);
  color: hsl(240 10% 8%);
  border-color: hsl(240 6% 10% / 0.12);
  box-shadow: 0 8px 32px hsl(240 10% 10% / 0.18);
}
:root.dui-theme-light .dui-augment-toast-btn {
  border-color: hsl(240 6% 10% / 0.15);
  background: hsl(240 6% 10% / 0.05);
  color: hsl(240 8% 30%);
}
:root.dui-theme-light .dui-augment-toast-btn:hover {
  background: hsl(240 6% 10% / 0.1);
  color: hsl(240 10% 8%);
}
/* Prompt-analytics rows inside the diagnostics overlay. The panel flips to a
   white background above, but these rows hard-code white-on-translucent text
   (rgba(255,255,255,…)) which vanishes on the light panel. Flip them to the
   same dark-on-light scale as the rest of the overlay, and darken the hit/miss
   pill text + hint accent so they keep contrast over white glass. */
:root.dui-theme-light .dui-diag-prompt-row { border-bottom-color: hsl(240 6% 10% / 0.08); }
:root.dui-theme-light .dui-diag-prompt-text { color: hsl(240 8% 25%); }
:root.dui-theme-light .dui-diag-prompt-count { color: hsl(240 5% 55%); }
:root.dui-theme-light .dui-diag-prompt-hint { color: hsl(240 5% 42%); }
:root.dui-theme-light .dui-diag-prompt-hint em { color: hsl(38 92% 38%); }
:root.dui-theme-light .dui-diag-meta-inline { color: hsl(240 5% 55%); }
:root.dui-theme-light .dui-diag-pill--hit  { background: hsl(142 70% 32% / 0.14); color: hsl(142 70% 28%); }
:root.dui-theme-light .dui-diag-pill--miss { background: hsl(38 92% 40% / 0.16);  color: hsl(38 92% 32%); }
`;

let injected = false;
export function injectStyles() {
  if (injected) return;
  const style = document.createElement('style');
  // Dedicated marker — NOT the bare `data-ghost-panel` opt-in attribute, which
  // the project scanner uses to discover user-tagged DOM elements. Tagging our
  // own injected <style> with `[data-ghost-panel]` made every project (3D, 2D,
  // anything) match the 'web' signature and tried to auto-register the style
  // tag as a web element. Use a suffixed attribute (cf. data-ghost-panel-adapter)
  // so the public selector never sees our internal stylesheet.
  style.setAttribute('data-ghost-panel-styles', '');
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}

/**
 * Built-in themes — two options:
 *
 *   'zinc'  (default) — shadcn dark mode (neutral zinc palette)
 *   'light'           — shadcn light mode
 *
 * Apply with panel.setTheme('light') or via the createGhostPanel({ theme }) option.
 *
 * All values are space-separated HSL components (no commas, no percent signs)
 * so you can use `hsl(var(--token) / 0.5)` for opacity adjustments.
 */
export const THEMES = {
  // Dark mode — shadcn zinc palette (default, set by base CSS)
  zinc: {},

  // Light mode — shadcn light theme
  light: {
    '--background':             '0 0% 100%',
    '--foreground':             '240 10% 4%',
    '--card':                   '0 0% 100%',
    '--card-foreground':        '240 10% 4%',
    '--muted':                  '240 5% 96%',
    '--muted-foreground':       '240 4% 46%',
    '--border':                 '240 6% 90%',
    '--input':                  '240 6% 90%',
    '--primary':                '240 6% 10%',
    '--primary-foreground':     '0 0% 98%',
    '--secondary':              '240 5% 96%',
    '--secondary-foreground':   '240 6% 10%',
    '--accent':                 '240 5% 96%',
    '--accent-foreground':      '240 6% 10%',
    '--ring':                   '240 5% 65%',
  },
};
