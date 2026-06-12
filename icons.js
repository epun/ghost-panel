/**
 * Phosphor-style icon set — a single source of truth for every glyph
 * the UI renders inline. All icons follow the Phosphor Icons regular
 * weight conventions so they read as one consistent family:
 *
 *   • viewBox `0 0 256 256` — Phosphor's native canvas
 *   • stroke-width `16` (~6.25% of canvas) with rounded line caps + joins
 *   • `fill: none` for outline strokes; `currentColor` so CSS theming works
 *
 * Each icon is exported two ways:
 *
 *   icons.cube                       → svg markup string (default size)
 *   icons.svg('cube', { size: 18 })  → markup with explicit size override
 *
 * The string form is friendly to template-literal HTML; callers can drop
 * it straight into `el.innerHTML = `<button>${icons.move}<button>`.
 * Built-in sizing defaults to 16px so icons don't dwarf the inputs that
 * host them.
 *
 * Reference: https://phosphoricons.com  (regular weight)
 */

// Body wrapper applied to every icon. Sets currentColor + rounded caps,
// so each individual path string only needs to declare its geometry.
function wrap(paths, opts = {}) {
  const size = opts.size ?? 16;
  const sw   = opts.strokeWidth ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}"
    fill="none" stroke="currentColor" stroke-width="${sw}"
    stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

// Some icons need filled regions (e.g. checkmark indicators inside dots).
// `wrapMixed` lets a single path declare its own fill via attributes.
function wrapMixed(inner, opts = {}) {
  const size = opts.size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}"
    stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// ── Geometry primitives ─────────────────────────────────────────────
const PATHS = {
  // Cursor / transform
  arrowsOut:        `<path d="M192,40h24V64M64,40H40V64M192,216h24V192M64,216H40V192"/><path d="M128,40v176M40,128h176"/>`,
  arrowClockwise:   `<path d="M176,128a48,48,0,1,1-48-48"/><polyline points="184 64 184 112 232 112" transform="rotate(45 184 88)"/>`,
  // Phosphor-style undo / redo curls. Same arc — different terminal
  // arrowhead direction. Used by the toast that confirms a Cmd+Z /
  // Cmd+Shift+Z so the action is legible in a peripheral glance.
  undo:             `<polyline points="80 136 32 88 80 40"/><path d="M32,88H160a64,64,0,0,1,64,64v0a64,64,0,0,1-64,64H88"/>`,
  redo:             `<polyline points="176 136 224 88 176 40"/><path d="M224,88H96a64,64,0,0,0-64,64v0a64,64,0,0,0,64,64h72"/>`,
  resize:           `<path d="M48,208,208,48M152,48h56v56M104,208H48V152"/>`,
  camera:           `<path d="M208,208H48a16,16,0,0,1-16-16V80A16,16,0,0,1,48,64H80L96,40h64l16,24h32a16,16,0,0,1,16,16V192A16,16,0,0,1,208,208Z"/><circle cx="128" cy="132" r="36"/>`,
  // Visibility
  eye:              `<path d="M128,56C48,56,16,128,16,128s32,72,112,72,112-72,112-72S208,56,128,56Z"/><circle cx="128" cy="128" r="40"/>`,
  eyeSlash:         `<path d="M48,40,208,216"/><path d="M154.9,157.6a40,40,0,0,1-53.7-54.7"/><path d="M73.6,80.7C39,99.5,16,128,16,128s32,72,112,72a126.5,126.5,0,0,0,46.1-8.6"/><path d="M208.6,170A132.3,132.3,0,0,0,240,128s-32-72-112-72a118,118,0,0,0-23.4,2.3"/><path d="M134.1,98.4a40,40,0,0,1,33.5,34.4"/>`,
  // Actions
  trash:            `<line x1="216" y1="56" x2="40" y2="56"/><line x1="104" y1="104" x2="104" y2="168"/><line x1="152" y1="104" x2="152" y2="168"/><path d="M200,56V208a8,8,0,0,1-8,8H64a8,8,0,0,1-8-8V56"/><path d="M168,56V40a16,16,0,0,0-16-16H104A16,16,0,0,0,88,40V56"/>`,
  x:                `<line x1="200" y1="56" x2="56" y2="200"/><line x1="200" y1="200" x2="56" y2="56"/>`,
  check:            `<polyline points="216 72 104 184 48 128"/>`,
  // Carets / chevrons
  caretDown:        `<polyline points="208 96 128 176 48 96"/>`,
  caretUp:          `<polyline points="208 160 128 80 48 160"/>`,
  caretLeft:        `<polyline points="160 208 80 128 160 48"/>`,
  caretRight:       `<polyline points="96 48 176 128 96 208"/>`,
  // Link / unlink (aspect-lock toggles)
  link:             `<path d="M122.1,93.9a40,40,0,0,1,56.6,0l16.9,16.9a40,40,0,0,1,0,56.6L168.7,194.4a40,40,0,0,1-56.6,0"/><path d="M133.9,162.1a40,40,0,0,1-56.6,0L60.4,145.2a40,40,0,0,1,0-56.6L87.3,61.6a40,40,0,0,1,56.6,0"/>`,
  linkBreak:        `<path d="M155.7,114.3l44-44a8,8,0,0,1,11.4,0l30.6,30.6a8,8,0,0,1,0,11.4l-44,44M100.3,141.7l-44,44a8,8,0,0,1-11.4,0L14.3,155.1a8,8,0,0,1,0-11.4l44-44"/><line x1="184" y1="40" x2="200" y2="24"/><line x1="216" y1="72" x2="232" y2="56"/><line x1="40" y1="184" x2="56" y2="200"/><line x1="72" y1="216" x2="56" y2="200"/>`,
  // Focus reticle (camera "look through")
  focusReticle:     `<path d="M48,64V48H64M192,48h16V64M48,192v16H64M192,208h16V192"/><circle cx="128" cy="128" r="12"/>`,
  // Text alignment
  textAlignLeft:    `<line x1="40" y1="64" x2="216" y2="64"/><line x1="40" y1="104" x2="160" y2="104"/><line x1="40" y1="144" x2="216" y2="144"/><line x1="40" y1="184" x2="160" y2="184"/>`,
  textAlignCenter:  `<line x1="40" y1="64" x2="216" y2="64"/><line x1="64" y1="104" x2="192" y2="104"/><line x1="40" y1="144" x2="216" y2="144"/><line x1="64" y1="184" x2="192" y2="184"/>`,
  textAlignRight:   `<line x1="40" y1="64" x2="216" y2="64"/><line x1="96" y1="104" x2="216" y2="104"/><line x1="40" y1="144" x2="216" y2="144"/><line x1="96" y1="184" x2="216" y2="184"/>`,
  // Vertical alignment (used as bottom/middle/top for flex children)
  alignTop:         `<line x1="40" y1="40" x2="216" y2="40"/><rect x="80" y="72" width="32" height="120"/><rect x="144" y="72" width="32" height="88"/>`,
  alignMiddle:      `<line x1="40" y1="128" x2="216" y2="128"/><rect x="80" y="56" width="32" height="64"/><rect x="80" y="136" width="32" height="64"/><rect x="144" y="80" width="32" height="48"/><rect x="144" y="136" width="32" height="40"/>`,
  alignBottom:      `<line x1="40" y1="216" x2="216" y2="216"/><rect x="80" y="64" width="32" height="120"/><rect x="144" y="96" width="32" height="88"/>`,
  // Figma-style canvas alignment (object positions within a frame)
  alignFrameLeft:   `<line x1="40" y1="40" x2="40" y2="216"/><rect x="56" y="64" width="80" height="40"/><rect x="56" y="136" width="120" height="40"/>`,
  alignFrameCenterH:`<line x1="128" y1="40" x2="128" y2="216"/><rect x="80" y="64" width="96" height="40"/><rect x="64" y="136" width="128" height="40"/>`,
  alignFrameRight:  `<line x1="216" y1="40" x2="216" y2="216"/><rect x="120" y="64" width="80" height="40"/><rect x="80" y="136" width="120" height="40"/>`,
  alignFrameTop:    `<line x1="40" y1="40" x2="216" y2="40"/><rect x="64" y="56" width="40" height="80"/><rect x="136" y="56" width="40" height="120"/>`,
  alignFrameCenterV:`<line x1="40" y1="128" x2="216" y2="128"/><rect x="64" y="80" width="40" height="96"/><rect x="136" y="64" width="40" height="128"/>`,
  alignFrameBottom: `<line x1="40" y1="216" x2="216" y2="216"/><rect x="64" y="80" width="40" height="120"/><rect x="136" y="40" width="40" height="160"/>`,
  // Typography
  textAa:           `<polyline points="32 200 80 64 128 200"/><line x1="48" y1="152" x2="112" y2="152"/><circle cx="180" cy="160" r="28"/><line x1="208" y1="200" x2="208" y2="160"/>`,
  textT:            `<line x1="56" y1="56" x2="200" y2="56"/><line x1="128" y1="56" x2="128" y2="200"/>`,
  italic:           `<line x1="152" y1="56" x2="104" y2="200"/><line x1="64" y1="200" x2="120" y2="200"/><line x1="136" y1="56" x2="192" y2="56"/>`,
  // Line height / letter spacing semantic icons
  lineHeight:       `<line x1="40" y1="40" x2="216" y2="40"/><line x1="40" y1="216" x2="216" y2="216"/><line x1="128" y1="72" x2="128" y2="184"/><polyline points="96 96 128 64 160 96"/><polyline points="96 160 128 192 160 160"/>`,
  letterSpacing:    `<line x1="40" y1="40" x2="40" y2="216"/><line x1="216" y1="40" x2="216" y2="216"/><polyline points="72 96 40 128 72 160"/><polyline points="184 96 216 128 184 160"/>`,
  // Geometric primitives (outliner type glyphs)
  cube:             `<polygon points="32 80 128 32 224 80 224 176 128 224 32 176 32 80"/><polyline points="32 80 128 128 224 80"/><line x1="128" y1="128" x2="128" y2="224"/>`,
  sphere:           `<circle cx="128" cy="128" r="96"/><ellipse cx="128" cy="128" rx="96" ry="36"/>`,
  cylinder:         `<ellipse cx="128" cy="56" rx="80" ry="24"/><path d="M48,56V200a80,24,0,0,0,160,0V56"/>`,
  cone:             `<path d="M128,32 L208,200 L48,200 Z"/><ellipse cx="128" cy="200" rx="80" ry="20"/>`,
  plane:            `<rect x="32" y="80" width="192" height="96"/><line x1="32" y1="128" x2="224" y2="128"/>`,
  torus:            `<ellipse cx="128" cy="128" rx="96" ry="56"/><ellipse cx="128" cy="128" rx="48" ry="20"/>`,
  rectangle:        `<rect x="48" y="64" width="160" height="128"/>`,
  circle:           `<circle cx="128" cy="128" r="88"/>`,
  // Lights
  sun:              `<circle cx="128" cy="128" r="56"/><line x1="128" y1="40" x2="128" y2="32"/><line x1="64" y1="64" x2="58" y2="58"/><line x1="40" y1="128" x2="32" y2="128"/><line x1="64" y1="192" x2="58" y2="198"/><line x1="128" y1="216" x2="128" y2="224"/><line x1="192" y1="192" x2="198" y2="198"/><line x1="216" y1="128" x2="224" y2="128"/><line x1="192" y1="64" x2="198" y2="58"/>`,
  spotlight:        `<path d="M128,40 L80,200 L176,200 Z"/><ellipse cx="128" cy="200" rx="48" ry="14"/>`,
  pointLight:       `<circle cx="128" cy="128" r="32" fill="currentColor"/><line x1="128" y1="64" x2="128" y2="40"/><line x1="128" y1="216" x2="128" y2="192"/><line x1="64" y1="128" x2="40" y2="128"/><line x1="216" y1="128" x2="192" y2="128"/><line x1="80" y1="80" x2="64" y2="64"/><line x1="192" y1="176" x2="176" y2="160"/><line x1="80" y1="176" x2="64" y2="192"/><line x1="192" y1="80" x2="176" y2="96"/>`,
  ambient:          `<circle cx="128" cy="128" r="48"/>`,
  // Image / picture (rect frame with horizon + sun)
  image:            `<rect x="32" y="48" width="192" height="160" rx="8"/><circle cx="96" cy="108" r="16"/><polyline points="32 180 96 116 160 180"/><polyline points="124 148 168 104 224 160"/>`,
  // UI primitives for web components
  buttonPill:       `<rect x="32" y="80" width="192" height="96" rx="48"/>`,
  heading:          `<polyline points="48 200 48 56 96 56"/><line x1="72" y1="128" x2="48" y2="128"/><polyline points="160 200 160 56 208 56"/><line x1="184" y1="128" x2="160" y2="128"/><line x1="96" y1="128" x2="160" y2="128"/>`,
  divider:          `<line x1="32" y1="128" x2="224" y2="128"/><line x1="32" y1="64" x2="224" y2="64" opacity="0.4"/><line x1="32" y1="192" x2="224" y2="192" opacity="0.4"/>`,
  cursorClick:      `<polygon points="104 40 104 184 152 144 192 184 216 160 176 120 224 104 104 40"/>`,
  pencil:           `<path d="M96,216H40V160L168,32l56,56Z"/><line x1="136" y1="64" x2="192" y2="120"/>`,
  warning:          `<path d="M236,200,144,40a16,16,0,0,0-32,0L20,200a16,16,0,0,0,14,24H222A16,16,0,0,0,236,200Z"/><line x1="128" y1="104" x2="128" y2="144"/><circle cx="128" cy="176" r="8" fill="currentColor"/>`,
  paintBrush:       `<path d="M120,196l24-24a48,48,0,0,0-32-80L88,116l-12,12a32,32,0,1,1-12,60c0-24,28-32,28-32l28,28-28,28C76,224,72,160,72,160"/>`,
  pause:            `<rect x="80" y="56" width="32" height="144" rx="4"/><rect x="144" y="56" width="32" height="144" rx="4"/>`,
  // Transport — play, skip back, skip forward
  play:             `<polygon points="72 40 72 216 216 128 72 40" fill="currentColor"/>`,
  skipBack:         `<polygon points="208 40 208 216 96 128 208 40" fill="currentColor"/><line x1="48" y1="40" x2="48" y2="216" stroke-width="20"/>`,
  skipForward:      `<polygon points="48 40 48 216 160 128 48 40" fill="currentColor"/><line x1="208" y1="40" x2="208" y2="216" stroke-width="20"/>`,
  caretLeft2:       `<polyline points="160 208 80 128 160 48" stroke-width="20"/>`,
  caretRight2:      `<polyline points="96 48 176 128 96 208" stroke-width="20"/>`,
  sparkle:          `<path d="M168,40l8,32,32,8-32,8-8,32-8-32-32-8,32-8Z"/><path d="M64,128l4,16,16,4-16,4-4,16-4-16-16-4,16-4Z"/><path d="M152,168l4,16,16,4-16,4-4,16-4-16-16-4,16-4Z"/>`,
  clipboard:        `<rect x="48" y="56" width="160" height="160" rx="8"/><line x1="88" y1="32" x2="168" y2="32"/><rect x="88" y="24" width="80" height="48" rx="8"/>`,
  // Material debug
  gridFour:         `<rect x="32" y="32" width="80" height="80"/><rect x="144" y="32" width="80" height="80"/><rect x="32" y="144" width="80" height="80"/><rect x="144" y="144" width="80" height="80"/>`,
  normalsArrow:     `<line x1="128" y1="200" x2="128" y2="56"/><polyline points="80 104 128 56 176 104"/>`,
  cubeTransparent:  `<polygon points="32 80 128 32 224 80 224 176 128 224 32 176 32 80" stroke-dasharray="8 8"/><polyline points="32 80 128 128 224 80"/><line x1="128" y1="128" x2="128" y2="224"/>`,
  wireframe:        `<polygon points="32 80 128 32 224 80 224 176 128 224 32 176 32 80"/><polyline points="32 80 128 128 224 80"/><line x1="128" y1="128" x2="128" y2="224"/><line x1="32" y1="80" x2="128" y2="224"/><line x1="224" y1="80" x2="128" y2="224"/>`,
  // Corner radius (rounded corner glyphs — one quadrant of a frame)
  cornerTL:         `<path d="M216,40H88a48,48,0,0,0-48,48V216"/>`,
  cornerTR:         `<path d="M40,40H168a48,48,0,0,1,48,48V216"/>`,
  cornerBL:         `<path d="M216,216H88a48,48,0,0,1-48-48V40"/>`,
  cornerBR:         `<path d="M40,216H168a48,48,0,0,0,48-48V40"/>`,
  cornerLinked:     `<path d="M40,72V56A16,16,0,0,1,56,40H72M184,40h16a16,16,0,0,1,16,16V72M40,184v16a16,16,0,0,0,16,16H72M184,216h16a16,16,0,0,0,16-16V184"/>`,
  cornerUnlinked:   `<path d="M40,72V56A16,16,0,0,1,56,40H72M184,40h16a16,16,0,0,1,16,16V72M40,184v16a16,16,0,0,0,16,16H72M184,216h16a16,16,0,0,0,16-16V184" stroke-dasharray="12 12"/>`,
};

// Build a string-keyed icon map. The string form is what callers
// embed in their innerHTML templates.
const ICONS = {};
for (const [name, paths] of Object.entries(PATHS)) {
  ICONS[name] = wrap(paths);
}

/**
 * Look up an icon by name with optional sizing.
 *
 *   icons.svg('camera', { size: 18 })  // 18×18
 *
 * Unknown names return an empty string so callers can fall back without
 * crashing the panel.
 */
function svg(name, opts = {}) {
  const paths = PATHS[name];
  if (!paths) return '';
  return wrap(paths, opts);
}

// Camera icon as a URL-encoded SVG, ready for use as a CSS mask
// (the camera badge in styles.js uses this pattern). Kept separate
// from the generic wrap() since masks need a black-filled path.
const CAMERA_MASK = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="black" d="M208,56H180.3L168,33.5A16,16,0,0,0,153.7,24H102.3A16,16,0,0,0,88,33.5L75.7,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56ZM128,176a44,44,0,1,1,44-44A44,44,0,0,1,128,176Z"/></svg>`;

export { ICONS as icons, svg, CAMERA_MASK };
export default ICONS;
