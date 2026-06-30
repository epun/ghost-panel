const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LEVEL_NAMES = Object.fromEntries(Object.entries(LEVELS).map(([name, value]) => [value, name]));
const DEFAULT_LEVEL = 'info';

function escapeScope(scope) {
  return String(scope).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class GhostPanelLogger {
  constructor(state = sharedState, scopes = []) {
    this._state = state;
    this._scopes = scopes;
  }

  setLevel(name) {
    const next = typeof name === 'number'
      ? (LEVEL_NAMES[name] ? name : LEVELS[DEFAULT_LEVEL])
      : (LEVELS[String(name).toLowerCase()] ?? LEVELS[DEFAULT_LEVEL]);
    this._state.level = next;
  }

  getLevel() {
    return LEVEL_NAMES[this._state.level] ?? DEFAULT_LEVEL;
  }

  setOnError(fn) {
    this._state.onError = typeof fn === 'function' ? fn : null;
  }

  scope(tag) {
    const scope = String(tag ?? '').trim();
    return scope ? new GhostPanelLogger(this._state, [...this._scopes, scope]) : this;
  }

  error(...args) { this._emit('error', args); }
  warn(...args) { this._emit('warn', args); }
  info(...args) { this._emit('info', args); }
  debug(...args) { this._emit('debug', args); }

  _emit(level, args) {
    // The onError hook is a programmatic telemetry channel, intentionally
    // decoupled from console verbosity: it fires for every error-level log
    // even when the level is 'silent' (so hosts can collect errors quietly).
    if (level === 'error') {
      const hook = this._state.onError;
      if (hook) {
        try {
          hook(...args);
        } catch (e) { void e; }
      }
    }

    if (!this._shouldLog(level)) return;

    const consoleLike = typeof console !== 'undefined' ? console : null;
    if (!consoleLike) return;
    const method = consoleLike[level] || consoleLike.log;
    if (typeof method !== 'function') return;
    const { scopes, values } = this._resolveArgs(args);
    const output = [this._prefix(scopes), ...values];
    try {
      method.apply(consoleLike, output);
    } catch (e) { void e; }
  }

  _shouldLog(level) {
    return this._state.level >= LEVELS[level];
  }

  _prefix(scopes = this._scopes) {
    return ['[Ghost Panel]', ...scopes.map(scope => `[${scope}]`)].join('');
  }

  _resolveArgs(args) {
    const values = [...args];
    const scopes = [...this._scopes];
    if (!scopes.length && values.length > 1 && typeof values[0] === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(values[0])) {
      scopes.push(values.shift());
    }
    if (values.length && typeof values[0] === 'string') {
      let first = values[0].replace(/^\[Ghost Panel\]\s*/, '');
      for (const scope of scopes) {
        first = first.replace(new RegExp(`^\\[${escapeScope(scope)}\\]\\s*`), '');
      }
      values[0] = first;
    }
    return { scopes, values };
  }
}

const sharedState = {
  level: LEVELS[DEFAULT_LEVEL],
  onError: null,
};

export const log = new GhostPanelLogger();
export default log;
