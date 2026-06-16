/**
 * Ghost Panel · Token Tracker
 *
 * Quantifies the payoff of the visual-edit → JSON-export workflow.
 *
 * The pitch: instead of *describing* scene / project changes in prose to an
 * AI coding assistant (Claude Code · Cursor · Codex) — which burns prompt
 * tokens, pricier output tokens, and usually several rounds to land exact
 * numbers — you make the edits visually here and export a compact JSON diff
 * the assistant applies in one shot.
 *
 * The tracker watches edits (via the undo stack), diffs live `toJSON()`
 * state against the baseline captured at mount, and shows a running estimate
 * of the tokens — and dollars — that workflow saves. The export button emits
 * a *changes-only* diff in `toJSON()` shape, so it's both minimal AND
 * replayable through `ui.fromJSON()`.
 *
 * EVERYTHING HERE IS AN ESTIMATE. There's no tokenizer shipped, so token
 * counts use a character/lexical heuristic; the "describe it instead" figure
 * uses the tunable model in ASSUMPTIONS; prices are representative public
 * list rates ($/Mtok) and are overridable via opts.pricing. The goal is an
 * honest order-of-magnitude, not billing-grade precision.
 */

// ── Tunables ────────────────────────────────────────────────────────────────

// Representative public list prices, US$ per million tokens (input / output).
// Output tokens are several times pricier than input — which is exactly why
// "paste a diff" (mostly input) beats "have the model write the edit"
// (lots of output). Override per-host via opts.pricing.
export const DEFAULT_PRICING = {
  'Claude Opus':   { in: 15,  out: 75 },
  'Claude Sonnet': { in: 3,   out: 15 },
  'GPT-4o':        { in: 2.5, out: 10 },
};

// Model of the conversational ("just describe it to the assistant") path that
// the visual workflow replaces. All per-change figures are per changed scalar
// (one number / color / flag), since that's what the diff counts.
const ASSUMPTIONS = {
  proseInPerChange:  12,  // input tokens to describe one precise value in prose
  proseInBase:       50,  // request framing + "which file / object" context
  proseOutPerChange: 20,  // tokens the assistant writes to author that one edit
  proseOutBase:      70,  // explanation / preamble it wraps around the edit
  iterations:        1.5, // rounds to land exact numbers by description alone
  // The Ghost Panel path: paste the diff, assistant applies it.
  jsonInBase:        15,  // "apply this:" instruction wrapping the pasted JSON
  jsonOutPerChange:  6,   // assistant confirming each applied field
  jsonOutBase:       30,
};

// ── Token estimation ────────────────────────────────────────────────────────

/**
 * Estimate the BPE token count of a string (or any JSON-able value).
 * Brackets the real count with two cheap heuristics and averages them:
 *   • chars / 4      — the classic rule of thumb for English prose
 *   • lexical pieces — words, number-runs and individual punctuation, which
 *                      tracks JSON / code better (where '{', ':', ',' and
 *                      numbers each tend to be their own token)
 */
export function estimateTokens(input) {
  if (input == null) return 0;
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  if (!s) return 0;
  const byChars = s.length / 4;
  const pieces  = (s.match(/[A-Za-z_]+|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) || []).length;
  return Math.max(1, Math.round((byChars + pieces) / 2));
}

// ── Diffing ─────────────────────────────────────────────────────────────────

function clone(v) {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

/** Count primitive leaves in a value (an added/removed subtree's "size"). */
function countLeaves(v) {
  if (v == null || typeof v !== 'object') return 1;
  let n = 0;
  for (const k in v) n += countLeaves(v[k]);
  return n || 1;
}

/** Count leaf values that differ between two snapshots (added/removed/changed). */
export function countChangedLeaves(a, b) {
  if (a === b) return 0;
  const aO = a && typeof a === 'object';
  const bO = b && typeof b === 'object';
  if (!aO || !bO) return a === b ? 0 : Math.max(countLeaves(a), countLeaves(b));
  let n = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a) || !(k in b)) { n += countLeaves(k in a ? a[k] : b[k]); continue; }
    n += countChangedLeaves(a[k], b[k]);
  }
  return n;
}

/**
 * Build the subtree of `cur` that differs from `base`. Same shape as the
 * inputs, containing only changed/added paths (removed keys → null), so the
 * result round-trips through `ui.fromJSON()`. Arrays (e.g. a vec3 position)
 * are emitted whole when any element changes — you want the full vector.
 * Returns `undefined` when nothing changed at this node.
 */
export function diffSnapshots(base, cur) {
  if (base === cur) return undefined;
  const aO = base && typeof base === 'object' && !Array.isArray(base);
  const bO = cur  && typeof cur  === 'object' && !Array.isArray(cur);
  if (!aO || !bO) {
    // primitive or array → emit the whole new value (or detect array equality)
    if (Array.isArray(base) && Array.isArray(cur) &&
        base.length === cur.length && base.every((v, i) => v === cur[i])) {
      return undefined;
    }
    return base === cur ? undefined : clone(cur);
  }
  const out = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(cur)]);
  for (const k of keys) {
    if (!(k in cur))  { out[k] = null; continue; }          // removed
    if (!(k in base)) { out[k] = clone(cur[k]); continue; } // added
    const d = diffSnapshots(base[k], cur[k]);
    if (d !== undefined) out[k] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── Savings model ───────────────────────────────────────────────────────────

/**
 * Compute the token / cost savings of pasting a diff vs describing the same
 * changes in prose.
 * @param {string} diffJSON     minified JSON the user would paste
 * @param {number} changeCount  number of changed scalar values
 * @param {object} pricing      { model: { in, out } } in $/Mtok
 */
export function computeSavings(diffJSON, changeCount, pricing = DEFAULT_PRICING) {
  const n = Math.max(0, changeCount | 0);
  const A = ASSUMPTIONS;
  const exportTokens = n === 0 ? 0 : estimateTokens(diffJSON);

  // Conversational ("describe it to the assistant") path.
  const proseIn  = (A.proseInBase  + A.proseInPerChange  * n) * A.iterations;
  const proseOut = (A.proseOutBase + A.proseOutPerChange * n) * A.iterations;

  // Ghost Panel ("paste the diff") path.
  const gpIn  = A.jsonInBase + exportTokens;
  const gpOut = A.jsonOutBase + A.jsonOutPerChange * n;

  const inSaved  = n === 0 ? 0 : Math.max(0, proseIn  - gpIn);
  const outSaved = n === 0 ? 0 : Math.max(0, proseOut - gpOut);
  const tokensSaved = Math.round(inSaved + outSaved);
  const promptTokens = Math.round(proseIn + proseOut);
  const pct = promptTokens ? Math.round((tokensSaved / promptTokens) * 100) : 0;

  const costSaved = {};
  for (const [model, p] of Object.entries(pricing)) {
    costSaved[model] = (inSaved * p.in + outSaved * p.out) / 1e6;
  }

  return {
    changeCount: n,
    exportTokens,
    promptTokens,
    tokensSaved,
    pct,
    inSaved: Math.round(inSaved),
    outSaved: Math.round(outSaved),
    costSaved,           // { model: dollars }
  };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
function fmtMoney(d) {
  if (d <= 0) return '$0';
  if (d < 0.01)  return '$' + d.toFixed(4);
  if (d < 1)     return '$' + d.toFixed(3);
  return '$' + d.toFixed(2);
}

// ── Tracker + widget ────────────────────────────────────────────────────────

export class TokenTracker {
  /**
   * @param {object}  ui              the Ghost Panel instance
   * @param {object}  [opts]
   * @param {object}  [opts.pricing]  override the $/Mtok pricing table
   */
  constructor(ui, opts = {}) {
    this.ui = ui;
    this.pricing = opts.pricing || DEFAULT_PRICING;
    this._baseline = null;
    this._report = null;
    this._timer = 0;
    this._disposed = false;

    // Baseline is captured on the next frame so host code that registers
    // objects / folders synchronously right after createGhostPanel() is
    // included in the "starting state" rather than counted as edits.
    this._armBaseline();

    // Every committed edit (slider, transform, augment, delete, …) pushes to
    // the undo stack — use it as the live "something changed" signal.
    this._offUndo = ui._undo?.on(() => this.scheduleRefresh()) || null;
  }

  /** ui.toJSON() guarded — a misbehaving custom host serializer must never
   *  break the tracker (or, worse, the page). Returns null on failure. */
  _snapshot() {
    try { return this.ui.toJSON(); } catch { return null; }
  }

  _armBaseline() {
    // Capture AFTER the host's synchronous setup (object registration, folder
    // adds) so the starting scene IS the baseline rather than counted as edits.
    // setTimeout(0) fires reliably once the current task drains; rAF is a
    // second trigger for good measure. Whichever lands first wins (guarded).
    const cap = () => {
      if (this._disposed || this._baseline) return;
      const snap = this._snapshot();
      if (!snap) return;
      this._baseline = snap;
      this.refresh();
    };
    setTimeout(cap, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cap);
  }

  /** Re-snapshot the baseline as "now" (zeroes out the savings). */
  resetBaseline() {
    this._baseline = this.ui.toJSON();
    this.refresh();
  }

  /** The changes-only diff (toJSON shape) of the current state vs baseline. */
  getDiff() {
    const cur = this._snapshot();
    if (!this._baseline || !cur) return {};
    return diffSnapshots(this._baseline, cur) || {};
  }

  /** Latest savings report (recomputed on demand). */
  getReport() {
    const cur = this._snapshot();
    const ready = !!(this._baseline && cur);
    const diff = ready ? (diffSnapshots(this._baseline, cur) || {}) : {};
    const changeCount = ready ? countChangedLeaves(this._baseline, cur) : 0;
    const diffJSON = JSON.stringify(diff);   // minified — the token-optimal paste
    this._report = computeSavings(diffJSON, changeCount, this.pricing);
    this._report.diff = diff;
    this._report.diffJSON = diffJSON;
    return this._report;
  }

  /** Coalesce bursts of edits into one refresh. Uses setTimeout (not rAF) so
   *  refreshes still land when the tab isn't actively painting. */
  scheduleRefresh() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = 0; this.refresh(); }, 50);
  }

  /** Download the changes-only diff as JSON. */
  exportDiff() {
    const diff = this.getDiff();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([JSON.stringify(diff, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ghost-panel-changes-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── DOM ────────────────────────────────────────────────────────────────

  /** Build the widget into a container element. */
  mount(container) {
    const el = document.createElement('div');
    el.className = 'dui-token-tracker';
    el.innerHTML = `
      <div class="dui-token-hero">
        <div class="dui-token-hero-num">$0</div>
        <div class="dui-token-hero-sub">saved vs prompting the change</div>
      </div>
      <div class="dui-token-rows">
        <div class="dui-token-row"><span>Fields changed</span><b data-k="changes">0</b></div>
        <div class="dui-token-row"><span>Export diff</span><b data-k="export">0 tok</b></div>
        <div class="dui-token-row"><span>Describe instead</span><b data-k="prompt">0 tok</b></div>
        <div class="dui-token-row dui-token-row--accent"><span>Tokens saved</span><b data-k="saved">0</b></div>
      </div>
      <div class="dui-token-costs" data-k="costs"></div>
      <button class="dui-token-export" type="button">Export changes JSON →</button>
      <div class="dui-token-foot">Paste into Claude&nbsp;Code · Cursor · Codex instead of describing the change</div>
    `;
    el.querySelector('.dui-token-export').addEventListener('click', () => this.exportDiff());
    container.appendChild(el);
    this.element = el;
    this.refresh();
    return el;
  }

  refresh() {
    if (this._disposed || !this.element) return;
    const r = this.getReport();
    const el = this.element;
    const empty = r.changeCount === 0;
    el.classList.toggle('dui-token-empty', empty);

    const set = (k, v) => { const n = el.querySelector(`[data-k="${k}"]`); if (n) n.textContent = v; };
    set('changes', fmtInt(r.changeCount));
    set('export',  empty ? '—' : `~${fmtInt(r.exportTokens)} tok`);
    set('prompt',  empty ? '—' : `~${fmtInt(r.promptTokens)} tok`);
    set('saved',   empty ? '—' : `~${fmtInt(r.tokensSaved)}${r.pct ? `  (${r.pct}%)` : ''}`);

    // Hero: the biggest line item is dollars on the priciest model.
    const models = Object.keys(this.pricing);
    const heroModel = models[0];
    const heroNum = el.querySelector('.dui-token-hero-num');
    const heroSub = el.querySelector('.dui-token-hero-sub');
    if (empty) {
      heroNum.textContent = '$0';
      heroSub.textContent = 'edit the scene to see savings';
    } else {
      heroNum.textContent = fmtMoney(r.costSaved[heroModel] || 0);
      heroSub.textContent = `saved on ${heroModel} · this export`;
    }

    // Per-model cost breakdown.
    const costs = el.querySelector('[data-k="costs"]');
    if (empty) {
      costs.innerHTML = '';
    } else {
      costs.innerHTML = models.map(m =>
        `<div class="dui-token-cost"><span>${m}</span><b>${fmtMoney(r.costSaved[m] || 0)}</b></div>`
      ).join('');
    }
  }

  dispose() {
    this._disposed = true;
    if (this._timer) clearTimeout(this._timer);
    this._offUndo?.();
    this.element?.remove();
  }
}

/**
 * Attach the token tracker to a Ghost Panel instance: adds a "Token savings"
 * folder to the inspector, wires live updates, and exposes `ui.tokenTracker`.
 * Opt out with `tokenTracker: false`.
 */
export function attachTokenTracker(ui, opts = {}) {
  const folder = ui.addFolder('Token savings', { collapsed: false });
  const tracker = new TokenTracker(ui, opts);
  tracker.mount(folder.body);
  ui.tokenTracker = tracker;

  // Fold cleanup into the panel's dispose.
  const origDispose = ui.dispose;
  ui.dispose = () => { try { tracker.dispose(); } finally { origDispose?.(); } };

  return tracker;
}
