/**
 * Ghost Panel · Prompt Analytics
 *
 * Tracks what users ask the augment bar for so that frequently-requested
 * things can be prioritised and built into the core tool.
 *
 * Storage:
 *   localStorage['ghost-panel:prompt-analytics']  — persists across sessions
 *
 * Dev-server telemetry (Vite plugin only):
 *   POST /__ghost-panel/analytics  — appended to .ghost-panel-analytics.ndjson
 *
 * Public API (via ui._augment.analytics):
 *   analytics.getTop(n)          → n most-requested prompts
 *   analytics.getUnhandled(n)    → n prompts Ghost Panel couldn't answer well
 *   analytics.getSummary()       → { total, unique, top, unhandled }
 *   analytics.clear()            → wipe local store
 */

const STORAGE_KEY = 'ghost-panel:prompt-analytics';
const MAX_ENTRIES = 1000;   // cap localStorage footprint
const DEV_ENDPOINT = '/__ghost-panel/analytics';

export class PromptAnalytics {
  /**
   * @param {object} opts
   * @param {boolean} [opts.telemetry=true]  Send events to the Vite dev server
   * @param {string}  [opts.endpoint]        Override the telemetry endpoint URL
   */
  constructor(opts = {}) {
    this._telemetry = opts.telemetry !== false;
    this._endpoint  = opts.endpoint ?? DEV_ENDPOINT;
    this._data      = this._load();
    this._devMode   = this._detectDev();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Record a single augment prompt.
   * @param {string} prompt    Raw user input
   * @param {object} intent    Parsed intent from parseIntent()
   * @param {boolean} success  Whether any controls were actually added
   */
  record(prompt, intent, success) {
    const key   = this._normalize(prompt);
    const now   = new Date().toISOString();
    const entry = this._data[key] ?? {
      prompt:    key,
      intents:   (intent?.intents ?? []).map(i => i.id),
      count:     0,
      successes: 0,
      failures:  0,
      firstSeen: now,
      lastSeen:  null,
    };

    entry.count++;
    if (success) entry.successes++;
    else          entry.failures++;
    entry.lastSeen = now;

    this._data[key] = entry;
    this._save();

    // Fire-and-forget to dev server — never blocks, never throws to caller
    if (this._telemetry && this._devMode) {
      this._send(entry).catch(() => {});
    }
  }

  /**
   * Returns the n most-requested prompts (by raw count), highest first.
   * @param {number} [n=10]
   */
  getTop(n = 10) {
    return Object.values(this._data)
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /**
   * Returns prompts that Ghost Panel couldn't handle well — success rate < 50%
   * and asked at least `minCount` times. These are the best candidates to
   * build into the core tool.
   * @param {number} [n=10]
   * @param {number} [minCount=2]
   */
  getUnhandled(n = 10, minCount = 2) {
    return Object.values(this._data)
      .filter(e => e.count >= minCount && (e.successes / e.count) < 0.5)
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  }

  /**
   * Returns a compact summary for display in the diagnostic overlay.
   */
  getSummary() {
    const all = Object.values(this._data);
    const total = all.reduce((s, e) => s + e.count, 0);
    return {
      total,
      unique:     all.length,
      top:        this.getTop(5),
      unhandled:  this.getUnhandled(5),
    };
  }

  /** Wipe all stored analytics. */
  clear() {
    this._data = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _normalize(text) {
    return text.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  _save() {
    // Keep only the MAX_ENTRIES most-used entries so localStorage stays lean
    const trimmed = Object.entries(this._data)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, MAX_ENTRIES);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
    } catch {}
  }

  _detectDev() {
    // Assume dev if the Vite HMR websocket is present, or if the URL is localhost/127/0.0.0.0
    if (typeof window === 'undefined') return false;
    if (window.__vite_hmr_client || document.querySelector('script[type="module"][src*="/@vite/client"]')) return true;
    const { hostname } = location;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  }

  async _send(entry) {
    await fetch(this._endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...entry, _source: 'ghost-panel-augment' }),
    });
  }
}
