/**
 * Blender-style keyframe icon — a tiny diamond appended next to any property
 * control. Clicking it inserts a keyframe for that property at the current
 * playhead time; clicking again on a time that already has a key removes it.
 * Creates a bound track on first use if one doesn't exist yet.
 *
 * Diamond color state, mirroring Blender:
 *   • Hollow grey  → no track for this property
 *   • Solid white  → track exists but no key at current time
 *   • Solid yellow → key exists at current time
 *
 * Sample usage from a workflow / inspector:
 *   attachKeyframeIcon(rowElement, { ui, object, path, label, trackColor });
 */

const NS = 'http://www.w3.org/2000/svg';
const TICKERS = new Set();
let _rafId = null;

function ensureTickLoop() {
  if (_rafId) return;
  const tick = () => {
    TICKERS.forEach(fn => { try { fn(); } catch {} });
    _rafId = requestAnimationFrame(tick);
  };
  _rafId = requestAnimationFrame(tick);
}

/**
 * Append a keyframe diamond to `rowEl`. Returns a dispose function.
 *
 *   opts.ui          the createGhostPanel handle (uses ui._graphEditor + ui._undo)
 *   opts.object      the bound object (e.g. a circle, web adapter)
 *   opts.path        dot-path string to the numeric property (e.g. 'opacity')
 *   opts.label       display name for the auto-created track (default: path)
 *   opts.trackColor  hex color for the auto-created track (default: '#cccccc')
 *   opts.epsilon     time tolerance for "key at this time" detection (sec)
 */
export function attachKeyframeIcon(rowEl, opts) {
  if (!rowEl || !opts?.ui || !opts.object || !opts.path) return () => {};
  const { ui, object, path } = opts;
  const label = opts.label || path;
  const trackColor = opts.trackColor || '#cccccc';
  const epsilon = opts.epsilon ?? 0.01;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dui-keyframe-icon';
  btn.dataset.tooltip = `Insert keyframe for ${label}`;
  btn.innerHTML = `
    <svg viewBox="0 0 12 12" width="11" height="11" xmlns="${NS}">
      <polygon points="6,1 11,6 6,11 1,6"
               fill="currentColor" stroke="currentColor" stroke-width="1"
               stroke-linejoin="miter" />
    </svg>
  `;
  // Place the diamond INSIDE the control's chrome so its position is
  // consistent across all control types. Some rows ARE their own chrome
  // (`.dui-number-row`, `.dui-text-row`, `.dui-select-row` — bg + border
  // on the row itself); for those, appending to the row puts the icon
  // inside the chrome. Other rows (`.dui-slider-row`) are bare and the
  // chrome lives on an inner `.dui-slider` element; for those, we have
  // to dive one level deeper so the icon doesn't dangle beside the
  // chrome. Color rows (`.dui-color-row`) put the icon next to the
  // swatch — visually beside but tucked snug, mirroring the slider
  // layout. The chrome-aware target produces uniform placement: the
  // diamond always sits at the right edge of the visible control box.
  const slider = rowEl.classList?.contains('dui-slider-row')
    ? rowEl.querySelector(':scope > .dui-slider')
    : null;
  const host = slider || rowEl;
  host.appendChild(btn);

  // ── Track lookup / create-on-demand ────────────────────────────────
  const findTrack = () => {
    const editor = ui?._graphEditor;
    if (!editor?.getTracksFull) return null;
    return editor.getTracksFull().find(t =>
      t.binding?.object === object && t.binding?.path === path);
  };
  const ensureTrack = () => {
    const editor = ui._graphEditor;
    if (!editor) return null;
    let t = findTrack();
    if (t) return t;
    // Read the current value via getByPath-equivalent (single-segment for
    // now — keyframe rows are flat properties on the adapter).
    const v = readPath(object, path);
    const initial = typeof v === 'number' ? v : 0;
    editor.addTrackBound?.({
      name: `${object.name || 'object'} → ${label}`,
      color: trackColor,
      binding: { object, path },
      keys: [{ time: editor.getTime?.() ?? 0, value: initial }],
    });
    return findTrack();
  };

  // ── State sync (every frame) ───────────────────────────────────────
  const ticker = () => {
    const editor = ui?._graphEditor;
    if (!editor) return;
    const t = findTrack();
    const time = editor.getTime?.() ?? 0;
    const keyHere = t?.keys?.some(k => Math.abs(k.time - time) <= epsilon);
    btn.classList.toggle('dui-keyframe-has-track',  !!t && !keyHere);
    btn.classList.toggle('dui-keyframe-has-key',    !!keyHere);
  };
  TICKERS.add(ticker);
  ensureTickLoop();
  ticker();

  // ── Click → insert or remove ───────────────────────────────────────
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const editor = ui._graphEditor;
    if (!editor) return;
    const time = editor.getTime?.() ?? 0;
    const preExisting = findTrack();
    const before = preExisting?.keys?.map(k => ({ ...k })) || null;
    const track = ensureTrack();
    if (!track) return;
    // First click on a virgin property: ensureTrack() already seeded a key
    // at the current time, so the click is "done". Subsequent clicks on a
    // track that already exists toggle the key at this time.
    if (preExisting) {
      const existingIdx = track.keys.findIndex(k => Math.abs(k.time - time) <= epsilon);
      if (existingIdx >= 0) {
        track.keys.splice(existingIdx, 1);
      } else {
        const value = readPath(object, path);
        if (typeof value === 'number') track.addKey({ time, value });
      }
    }
    // Refresh the editor's render at the current time.
    editor.setTime?.(time);
    if (ui._undo) {
      const after = track.keys.map(k => ({ ...k }));
      const restore = (snap) => {
        if (!snap) {
          // No track existed before — undo by removing the track entirely.
          editor.removeTrack?.(track.name);
          return;
        }
        track.keys.length = 0;
        snap.forEach(k => track.keys.push({ ...k }));
        editor.setTime?.(editor.getTime?.() ?? 0);
      };
      ui._undo.push({
        label: `keyframe ${label}`,
        undo: () => restore(before),
        redo: () => {
          if (before === null) {
            // Re-create the track via the same path the click took.
            const v = readPath(object, path);
            editor.addTrackBound?.({
              name: `${object.name || 'object'} → ${label}`,
              color: trackColor,
              binding: { object, path },
              keys: [{ time, value: typeof v === 'number' ? v : 0 }],
            });
          } else {
            restore(after);
          }
        },
      });
    }
    ticker();
  });

  return () => { TICKERS.delete(ticker); btn.remove(); };
}

function readPath(obj, path) {
  if (!obj || !path) return undefined;
  const segments = path.split('.');
  let cur = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}
