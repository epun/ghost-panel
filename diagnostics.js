/**
 * Ghost Panel · Diagnostic Engine
 *
 * Runs health checks after createGhostPanel() to detect integration problems,
 * attempt automatic corrections, surface actionable feedback inside the panel,
 * and generate pre-filled GitHub issue reports for anything it can't fix.
 *
 * Usage (automatic — called by createGhostPanel when opts.diagnostics !== false):
 *   const diag = attachDiagnostics(ui, { repo: 'https://github.com/you/repo' });
 *
 * Manual API:
 *   diag.run()                  // re-run all checks now
 *   diag.getReport()            // structured JSON diagnostic bundle
 *   diag.openIssueURL()         // opens pre-filled GitHub issue in new tab
 *   diag.show()                 // open the diagnostic overlay
 *   diag.hide()                 // close it
 *
 * Checks run at t=0, t=2s, t=6s to catch async-loaded scenes.  After that
 * the engine is quiet unless an issue is detected or the host calls run()
 * manually.
 */
import { log } from './log.js';

// ── Probe window.* for common scene / camera / renderer names ──────────────
const SCENE_KEYS    = ['scene', 'threeScene', 'stage', 'world', 'three'];
const CAMERA_KEYS   = ['camera', 'cam', 'threeCamera', 'mainCamera', 'perspCamera'];
const RENDERER_KEYS = ['renderer', 'gl', 'webgl', 'threeRenderer', 'render'];
const APP_PATHS     = ['app', 'game', 'engine', 'context', 'three', 'sketch'];

function probe(keys) {
  if (typeof window === 'undefined') return null;
  for (const k of keys) {
    if (window[k] && typeof window[k] === 'object') return window[k];
    for (const ns of APP_PATHS) {
      const obj = window[ns];
      if (obj && obj[k] && typeof obj[k] === 'object') return obj[k];
    }
  }
  return null;
}

function isThreeScene(obj) {
  return obj && (obj.isScene || obj.type === 'Scene' || typeof obj.traverse === 'function');
}
function isThreeCamera(obj) {
  return obj && (obj.isCamera || obj.isObject3D);
}
function isThreeRenderer(obj) {
  return obj && typeof obj.render === 'function' && obj.domElement;
}

// ── Issue severity ─────────────────────────────────────────────────────────
const SEV = { error: 0, warning: 1, info: 2 };

export class DiagnosticEngine {
  constructor(ui, opts = {}) {
    this.ui      = ui;
    this.opts    = opts;
    this.repo    = opts.repo || 'https://github.com/epun/ghost-panel';
    this.issues  = [];
    this.status  = 'checking'; // 'healthy' | 'warning' | 'error' | 'checking'
    this._updateFired = false;
    this._overlay = null;
    this._badge   = null;

    // Instrument update() once so we can detect if the host never calls it.
    this._instrumentUpdate();

    // Schedule three check passes: immediate, 2 s, 6 s.
    // The later passes catch async GLTF loads and deferred scene setup.
    this._run(0);
    this._t1 = setTimeout(() => this._run(1), 2000);
    this._t2 = setTimeout(() => this._run(2), 6000);
  }

  // ── Main check runner ────────────────────────────────────────────────────

  async _run(pass) {
    const issues = [];

    this._checkWorkflow(issues);
    this._checkSceneObjects(issues, pass);
    this._checkUpdateLoop(issues, pass);
    this._checkPanelEmpty(issues, pass);
    this._checkErrors(issues);
    this._checkAccessibility(issues, pass);
    this._checkMotion(issues, pass);

    // Sort: errors first, then warnings, then info.
    issues.sort((a, b) => SEV[a.level] - SEV[b.level]);
    this.issues = issues;

    // Auto-fix anything we can handle silently.
    const fixed = await this._autoFix(issues);

    // Re-compute status after fixes. Advisory issues (host-app a11y/motion
    // sweeps) are excluded from the status math: they're informational only and
    // must never flip the health badge or trigger a console report. Only
    // "blocking" issues — real integration problems with Ghost Panel itself —
    // drive status.
    const remaining = issues.filter(i => !i.resolved);
    const blocking  = remaining.filter(i => !i.advisory);
    this.status = blocking.some(i => i.level === 'error')   ? 'error'
                : blocking.some(i => i.level === 'warning') ? 'warning'
                : blocking.length === 0                      ? 'healthy'
                : 'info';

    this._syncBadge();

    // First pass (t=0): only surface HARD errors immediately. Transient /
    // auto-fixable issues — most commonly `no-workflow` when the host registers
    // objects right after createGhostPanel() (the documented common pattern) —
    // wait until the t=2s pass to resolve before we say anything, so a
    // correctly-integrated app doesn't get a scary console warning that
    // silently fixes itself a moment later.
    if (pass === 0) {
      const hard = blocking.filter(i => i.level === 'error' && !i.autoFixable);
      if (hard.length > 0) this._consoleReport(hard);
    }
    // Later passes: only if things got worse or a new issue appeared.
    if (pass > 0 && fixed.length > 0) {
      log.info('diagnostics', 'Auto-corrected:', fixed.map(f => f.id).join(', '));
    }
    if (pass > 0 && blocking.length > 0 && this.status !== 'healthy') {
      this._consoleReport(blocking, pass);
    }

    // If overlay is open, refresh it.
    if (this._overlay?.isConnected) this._renderOverlay();
  }

  /** Public: run checks manually */
  run() { return this._run(99); }

  // ── Individual checks ────────────────────────────────────────────────────

  _checkWorkflow(issues) {
    const active = this.ui.activeWorkflows ?? [];
    if (active.length === 0) {
      // Try to detect what the host is running.
      const probedScene  = probe(SCENE_KEYS);
      const hasThreeScene = isThreeScene(probedScene);

      if (hasThreeScene) {
        issues.push({
          id: 'threejs-not-connected',
          level: 'error',
          title: 'Three.js scene found but not connected',
          detail: `Found what looks like a Three.js scene on window.${
            SCENE_KEYS.find(k => window[k] && isThreeScene(window[k])) || 'scene'
          }. Pass it to createGhostPanel({ scene, camera, renderer }).`,
          fix: 'connect-scene',
          autoFixable: false,
          codeHint: `const ui = createGhostPanel({ scene, camera, renderer });`,
        });
      } else {
        issues.push({
          id: 'no-workflow',
          level: 'warning',
          title: 'No workflow detected',
          detail: `Ghost Panel couldn't identify your project type. Pass workflow: "3d", "2d", or "web" to createGhostPanel(), or ensure your scene/camera/renderer are passed in.`,
          fix: 'detect-workflow',
          autoFixable: true,
        });
      }
    }

    // Scene connected but camera missing?
    const wfs = this.ui.activeWorkflows ?? [];
    if (wfs.includes('3d') && !this.ui._camera) {
      const probedCamera = probe(CAMERA_KEYS);
      issues.push({
        id: 'camera-missing',
        level: 'warning',
        title: 'Camera not connected',
        detail: 'Gizmos and focus-on-object won\'t work without a camera reference.' +
          (probedCamera ? ` Found a camera on window.${CAMERA_KEYS.find(k => window[k] === probedCamera)}.` : ''),
        fix: 'connect-camera',
        autoFixable: false,
        codeHint: `const ui = createGhostPanel({ scene, camera, renderer });`,
      });
    }
  }

  _checkSceneObjects(issues, pass) {
    const om = this.ui.objectManager;
    if (!om) return;
    const wfs = this.ui.activeWorkflows ?? [];
    if (!wfs.includes('3d')) return;

    // Only flag after the second pass — the scene may still be loading.
    if (pass < 1) return;

    // objectManager stores entries in .objects (plain dict), not getAll().
    const count = om.objects ? Object.keys(om.objects).length : -1;
    if (count === 0) {
      issues.push({
        id: 'no-scene-objects',
        level: 'warning',
        title: 'Scene panel is empty',
        detail: 'No objects were registered. If objects load asynchronously (GLTF, fetch, etc.) call ui.refreshSceneObjects() or ui.rescan() after they\'re ready.',
        fix: 'refresh-scan',
        autoFixable: true,
      });
    }
  }

  _instrumentUpdate() {
    const orig = this.ui.update.bind(this.ui);
    this.ui.update = (...args) => {
      this._updateFired = true;
      this.ui.update = orig; // unwrap after first call — zero overhead after that
      return orig(...args);
    };
  }

  _checkUpdateLoop(issues, pass) {
    // Only check on the 2 s and 6 s passes.
    if (pass < 1) return;
    const wfs = this.ui.activeWorkflows ?? [];
    // ONLY the 3D workflow truly needs ui.update() in the host's rAF loop —
    // that's where Three.js TransformControls and camera helpers sync. 2D
    // hosts paint their own per-frame draw loop and the 2D gizmo self-tracks
    // via its own rAF tick (see gizmo-2d.js _tick); folder visibility syncs off
    // objectManager 'change' events (see index.js). So a 2D host that never
    // calls ui.update() is correctly integrated — flagging it is a false alarm.
    if (!wfs.includes('3d')) return;

    if (!this._updateFired) {
      issues.push({
        id: 'no-update-loop',
        level: 'error',
        title: 'ui.update() not called in render loop',
        detail: 'Gizmos, camera helpers, and live previews need ui.update() inside your requestAnimationFrame callback.',
        fix: 'add-update-call',
        autoFixable: false,
        codeHint: `function animate() {\n  requestAnimationFrame(animate);\n  renderer.render(scene, camera);\n  ui.update(); // ← add this\n}\nanimate();`,
      });
    }
  }

  _checkPanelEmpty(issues, pass) {
    if (pass < 2) return; // wait until 6 s before declaring the panel empty
    const wfs = this.ui.activeWorkflows ?? [];
    if (wfs.length === 0) return; // already caught by no-workflow check

    // Check DOM for actual folder elements — workflows add folders directly
    // to the panel element without going through panel._folders, so we look
    // at the rendered DOM rather than the internal folder registry.
    const panelEl = this.ui.panel?.element;
    const domFolderCount = panelEl?.querySelectorAll('.dui-folder').length ?? 0;
    const registryCount = this.ui.panel?._folders?.length ?? 0;

    if (domFolderCount === 0 && registryCount === 0) {
      issues.push({
        id: 'panel-empty',
        level: 'info',
        title: 'No custom controls added',
        detail: 'Ghost Panel is running but no folders or controls have been added to the panel. Use ui.addFolder() or call ui.scanAndApply() to populate it.',
        fix: null,
        autoFixable: false,
        codeHint: `const f = ui.addFolder('My Controls');\nf.addSlider(myObj, 'speed', { min: 0, max: 10 });`,
      });
    }
  }

  _checkErrors(issues) {
    // Pick up any errors Ghost Panel itself may have emitted to a hidden log.
    const log = this.ui._errorLog;
    if (!log?.length) return;
    for (const entry of log) {
      issues.push({
        id: `runtime-error-${entry.ts}`,
        level: 'error',
        title: 'Runtime error',
        detail: entry.message,
        fix: null,
        autoFixable: false,
      });
    }
  }

  // ── Host-app advisories (a11y + motion) ──────────────────────────────────
  //
  // These audit the HOST application's own DOM for the same accessibility and
  // motion pitfalls Ghost Panel fixes in its own UI. They are deliberately
  // ADVISORY: tagged `advisory: true`, info-level, and never console-logged or
  // allowed to flip the health badge (see the `blocking` filter in _run). They
  // surface only inside the diagnostic overlay, under their own heading — so a
  // correctly-integrated app never gets a scary warning, but a developer who
  // opens diagnostics gets a free a11y/motion sweep of their page. We always
  // skip Ghost Panel's own chrome so we only ever report on the host's markup.

  /** True for elements that belong to Ghost Panel itself (never audit ours). */
  _isOurs(el) {
    if (!el || el.nodeType !== 1) return true;
    return !!(
      el.closest?.('[class*="dui-"]') ||
      el.hasAttribute?.('data-ghost-panel-styles') ||
      el.dataset?.ghostPanelAdapter != null
    );
  }

  /** Short, human-readable descriptor for an element, e.g. `<button.icon#close>`. */
  _tag(el) {
    const name = el.tagName.toLowerCase();
    const id  = el.id ? `#${el.id}` : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return `<${name}${id}${cls}>`;
  }

  /** Resolve an element's accessible name the way assistive tech roughly would. */
  _accessibleName(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const named = labelledby.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim() || '')
        .join(' ').trim();
      if (named) return named;
    }
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const text = (el.textContent || '').trim();
    if (text) return text;
    if ('value' in el && /^(submit|button|reset)$/i.test(el.type || '')) {
      const v = (el.value || '').trim();
      if (v) return v;
    }
    const imgAlt = [...(el.querySelectorAll?.('img[alt]') || [])]
      .map(i => (i.getAttribute('alt') || '').trim()).filter(Boolean).join(' ');
    return imgAlt || '';
  }

  /** True if a form field has a programmatic label (not just a placeholder). */
  _hasFieldLabel(el) {
    if (this._accessibleName(el)) return true;
    if (el.closest('label')) return true;
    const id = el.id;
    if (id) {
      try {
        if (document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
      } catch { /* CSS.escape unavailable / odd id — fall through */ }
    }
    return false;
  }

  _checkAccessibility(issues, pass) {
    if (typeof document === 'undefined') return;
    if (pass < 1) return; // let the host's DOM settle before auditing

    // 1 ── images missing alt text
    const imgs = [...document.querySelectorAll('img:not([alt])')]
      .filter(el => !this._isOurs(el));
    if (imgs.length) {
      issues.push({
        id: 'host-img-no-alt',
        level: 'info',
        advisory: true,
        title: `${imgs.length} image${imgs.length > 1 ? 's' : ''} missing alt text`,
        detail: `Screen readers announce images by their alt text. Use alt="" for purely decorative images, or a short description for meaningful ones. First: ${this._tag(imgs[0])}.`,
        codeHint: `<img src="…" alt="Short, meaningful description" />`,
        fix: null,
        autoFixable: false,
      });
    }

    // 2 ── icon-only controls with no accessible name
    const controls = [...document.querySelectorAll('button, a[href], [role="button"]')]
      .filter(el => !this._isOurs(el))
      .filter(el => el.offsetParent !== null); // skip hidden controls
    const unnamed = controls.filter(el => !this._accessibleName(el));
    if (unnamed.length) {
      issues.push({
        id: 'host-control-no-name',
        level: 'info',
        advisory: true,
        title: `${unnamed.length} control${unnamed.length > 1 ? 's' : ''} with no accessible name`,
        detail: `Icon-only buttons and links need an accessible name, or assistive tech announces them as just "button". Add visible text or an aria-label. First: ${this._tag(unnamed[0])}.`,
        codeHint: `<button aria-label="Close">✕</button>`,
        fix: null,
        autoFixable: false,
      });
    }

    // 3 ── form fields with no associated label
    const fields = [...document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=checkbox]):not([type=radio]), select, textarea'
    )].filter(el => !this._isOurs(el))
      .filter(el => el.offsetParent !== null);
    const unlabeled = fields.filter(el => !this._hasFieldLabel(el));
    if (unlabeled.length) {
      issues.push({
        id: 'host-field-no-label',
        level: 'info',
        advisory: true,
        title: `${unlabeled.length} form field${unlabeled.length > 1 ? 's' : ''} without a label`,
        detail: `Inputs need a programmatic label — a <label for>, a wrapping <label>, or aria-label. A placeholder doesn't count. First: ${this._tag(unlabeled[0])}.`,
        codeHint: `<label for="email">Email</label>\n<input id="email" type="email" />`,
        fix: null,
        autoFixable: false,
      });
    }
  }

  _checkMotion(issues, pass) {
    if (typeof document === 'undefined') return;
    if (pass < 1) return;

    // Persistent inline will-change forces standing compositor layers, which
    // costs memory and can actually slow rendering. It should be set just
    // before an animation and cleared right after — not left on permanently.
    const stuck = [...document.querySelectorAll('[style*="will-change"]')]
      .filter(el => !this._isOurs(el));
    if (stuck.length > 12) {
      issues.push({
        id: 'host-willchange-persistent',
        level: 'info',
        advisory: true,
        title: `${stuck.length} elements with a persistent will-change`,
        detail: `will-change is meant to be temporary. Leaving it on many elements keeps standing GPU layers around and can hurt performance more than it helps. Set it on interaction start and clear it on end. First: ${this._tag(stuck[0])}.`,
        codeHint: `el.style.willChange = 'transform';  // interaction start\n// …animate…\nel.style.willChange = '';           // interaction end`,
        fix: null,
        autoFixable: false,
      });
    }
  }

  // ── Auto-fix ─────────────────────────────────────────────────────────────

  async _autoFix(issues) {
    const fixed = [];
    for (const issue of issues) {
      if (!issue.autoFixable || issue.resolved) continue;

      if (issue.id === 'no-workflow') {
        // Re-run workflow detection — might work now that DOM/scene settled.
        const detected = this.ui.detectWorkflows?.() ?? [];
        if (detected.length > 0) {
          issue.resolved = true;
          issue.resolution = `Auto-detected workflow(s): ${detected.join(', ')}`;
          fixed.push(issue);
        }
      }

      if (issue.id === 'no-scene-objects') {
        this.ui.refreshSceneObjects?.();
        // Give the scan a tick to complete, then check again.
        await new Promise(r => setTimeout(r, 300));
        const om = this.ui.objectManager;
        const count = om?.objects ? Object.keys(om.objects).length : 0;
        if (count > 0) {
          issue.resolved = true;
          issue.resolution = `Re-scanned and found ${count} object(s).`;
          fixed.push(issue);
        }
      }
    }
    return fixed;
  }

  // ── Console output ───────────────────────────────────────────────────────

  _consoleReport(issues, pass) {
    const errors   = issues.filter(i => i.level === 'error');
    const warnings = issues.filter(i => i.level === 'warning');

    const header = `%c Ghost Panel ${pass > 0 ? '(re-check)' : ''} `;
    const headerStyle = 'background:#111;color:#fff;padding:2px 6px;border-radius:3px;font-weight:600';

    if (errors.length > 0) {
      log.info('diagnostics', header + `${errors.length} error(s) detected — click to expand`);
    } else if (warnings.length > 0) {
      log.info('diagnostics', header + `${warnings.length} warning(s) — click to expand`);
    }

    for (const issue of issues) {
      const icon = issue.level === 'error' ? '🔴' : issue.level === 'warning' ? '🟡' : 'ℹ️';
      log.warn('diagnostics', `${icon} [${issue.id}] ${issue.title}\n   ${issue.detail}`);
      if (issue.codeHint) {
        log.info('diagnostics', 'Fix suggestion:\n' + issue.codeHint);
      }
    }

    log.info('diagnostics', 'Open the diagnostic panel → click the dot in the Ghost Panel header, or call ui._diagnostics.show()');
    log.info('diagnostics', 'Auto-generate a GitHub issue → ui._diagnostics.openIssueURL()');
  }

  // ── Badge (colored dot in the panel header) ───────────────────────────────

  attachBadge(headerEl) {
    const dot = document.createElement('button');
    dot.className = 'dui-health-dot';
    dot.setAttribute('aria-label', 'Ghost Panel health');
    dot.setAttribute('data-tooltip', 'Ghost Panel health — click for details');
    dot.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    headerEl.prepend(dot);
    this._badge = dot;
    this._syncBadge();
  }

  _syncBadge() {
    const dot = this._badge;
    if (!dot) return;
    const map = {
      healthy:  { color: '#4ade80', title: 'All checks passed' },
      warning:  { color: '#facc15', title: `${this.issues.filter(i=>i.level==='warning'&&!i.resolved).length} warning(s)` },
      error:    { color: '#f87171', title: `${this.issues.filter(i=>i.level==='error'&&!i.resolved).length} error(s)` },
      info:     { color: '#60a5fa', title: 'Info' },
      checking: { color: '#6b7280', title: 'Checking…' },
    };
    const s = map[this.status] ?? map.checking;
    dot.style.setProperty('--diag-color', s.color);
    dot.setAttribute('data-tooltip', `Ghost Panel: ${s.title} — click for details`);
    dot.dataset.status = this.status;
    // Pulse animation on non-healthy states.
    dot.classList.toggle('dui-health-dot--pulse', this.status !== 'healthy' && this.status !== 'checking');
  }

  // ── Overlay ───────────────────────────────────────────────────────────────

  show() {
    if (!this._overlay) this._createOverlay();
    this._renderOverlay();
    this._overlay.style.display = 'flex';
  }

  hide() {
    if (this._overlay) this._overlay.style.display = 'none';
  }

  toggle() {
    if (!this._overlay || this._overlay.style.display === 'none') {
      this.show();
    } else {
      this.hide();
    }
  }

  _createOverlay() {
    const el = document.createElement('div');
    el.className = 'dui-diag-overlay';
    el.style.display = 'none';
    document.body.appendChild(el);
    this._overlay = el;
  }

  _renderOverlay() {
    const ui   = this.ui;
    const open     = this.issues.filter(i => !i.resolved && !i.advisory);
    const advisory = this.issues.filter(i => !i.resolved && i.advisory);
    const fixed = this.issues.filter(i => i.resolved);

    const statusIcon = { healthy:'✓', warning:'⚠', error:'✕', checking:'…', info:'i' }[this.status] ?? '?';
    const statusLabel = { healthy:'All clear', warning:'Warnings', error:'Errors detected', checking:'Checking…', info:'Info' }[this.status] ?? this.status;

    const issueHTML = open.length === 0
      ? `<p class="dui-diag-all-good">Ghost Panel is running correctly.</p>`
      : open.map(issue => `
        <div class="dui-diag-issue dui-diag-${issue.level}">
          <div class="dui-diag-issue-title">${issue.title}</div>
          <div class="dui-diag-issue-detail">${issue.detail}</div>
          ${issue.codeHint ? `<pre class="dui-diag-code">${escHtml(issue.codeHint)}</pre>` : ''}
          ${issue.autoFixable ? `<button class="dui-diag-btn" data-fix="${issue.id}">Auto-fix</button>` : ''}
        </div>`).join('');

    const fixedHTML = fixed.length === 0 ? '' : `
      <div class="dui-diag-section-label">Auto-corrected</div>
      ${fixed.map(f => `
        <div class="dui-diag-issue dui-diag-resolved">
          <div class="dui-diag-issue-title">✓ ${f.title}</div>
          <div class="dui-diag-issue-detail">${f.resolution ?? 'Resolved automatically'}</div>
        </div>`).join('')}`;

    // Advisory sweep of the HOST page (a11y + motion). Rendered in its own
    // muted section so it reads as "here's a freebie" rather than "you broke
    // something" — these never affect the health badge above.
    const advisoryHTML = advisory.length === 0 ? '' : `
      <div class="dui-diag-section-label">Accessibility &amp; motion <span class="dui-diag-meta-inline">advisory · your page, not Ghost Panel</span></div>
      ${advisory.map(issue => `
        <div class="dui-diag-issue dui-diag-info dui-diag-advisory">
          <div class="dui-diag-issue-title">${issue.title}</div>
          <div class="dui-diag-issue-detail">${issue.detail}</div>
          ${issue.codeHint ? `<pre class="dui-diag-code">${escHtml(issue.codeHint)}</pre>` : ''}
        </div>`).join('')}`;

    const activeWfs = (ui.activeWorkflows ?? []).join(', ') || 'none';
    const om = ui.objectManager;
    const objCount  = om?.objects ? Object.keys(om.objects).length : '—';

    // ── Prompt analytics section ──────────────────────────────────────────
    const analytics    = ui._augment?.analytics;
    const analyticsHTML = (() => {
      if (!analytics) return '';
      const { total, unique, top, unhandled } = analytics.getSummary();
      if (total === 0) return '';

      const topRows = top.map(e => {
        const pct  = Math.round(100 * e.successes / e.count);
        const pill = e.successes / e.count < 0.5
          ? `<span class="dui-diag-pill dui-diag-pill--miss">needs work</span>`
          : `<span class="dui-diag-pill dui-diag-pill--hit">✓</span>`;
        return `<div class="dui-diag-prompt-row">
          <span class="dui-diag-prompt-text">${escHtml(e.prompt)}</span>
          <span class="dui-diag-prompt-count">×${e.count}</span>
          ${pill}
        </div>`;
      }).join('');

      const unhandledNote = unhandled.length > 0
        ? `<p class="dui-diag-prompt-hint">↑ ${unhandled.length} prompt${unhandled.length > 1 ? 's' : ''} marked <em>needs work</em> — consider adding them to the core tool.</p>`
        : '';

      return `
        <div class="dui-diag-section-label">What users are asking for <span class="dui-diag-meta-inline">${total} total · ${unique} unique</span></div>
        <div class="dui-diag-issues dui-diag-prompts">
          ${topRows}
          ${unhandledNote}
        </div>`;
    })();

    this._overlay.innerHTML = `
      <div class="dui-diag-panel">
        <div class="dui-diag-header">
          <span class="dui-diag-status dui-diag-status--${this.status}">${statusIcon} ${statusLabel}</span>
          <button class="dui-diag-close" aria-label="Close">×</button>
        </div>

        <div class="dui-diag-meta">
          <span>Workflows: <strong>${activeWfs}</strong></span>
          <span>Objects: <strong>${objCount}</strong></span>
          <span>update() called: <strong>${this._updateFired ? 'yes' : 'no'}</strong></span>
        </div>

        <div class="dui-diag-issues">${issueHTML}</div>
        ${fixedHTML ? `<div class="dui-diag-issues">${fixedHTML}</div>` : ''}
        ${advisoryHTML ? `<div class="dui-diag-issues">${advisoryHTML}</div>` : ''}
        ${analyticsHTML}

        <div class="dui-diag-footer">
          <button class="dui-diag-btn dui-diag-btn--secondary" data-action="rescan">↺ Re-scan</button>
          <button class="dui-diag-btn dui-diag-btn--secondary" data-action="report">⎘ Copy report</button>
          <button class="dui-diag-btn dui-diag-btn--secondary" data-action="issue">↗ GitHub issue</button>
          ${analytics?.getSummary().total > 0
            ? `<button class="dui-diag-btn dui-diag-btn--secondary" data-action="analytics">⬇ Export prompts</button>`
            : ''}
        </div>
      </div>`;

    // Wire up buttons.
    this._overlay.querySelector('.dui-diag-close')
      ?.addEventListener('click', () => this.hide());

    this._overlay.querySelectorAll('[data-fix]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const issue = this.issues.find(i => i.id === btn.dataset.fix);
        if (!issue) return;
        issue.autoFixable = true;
        await this._autoFix([issue]);
        this._renderOverlay();
      });
    });

    this._overlay.querySelector('[data-action="rescan"]')?.addEventListener('click', async () => {
      this._overlay.querySelector('.dui-diag-issues').innerHTML = '<p class="dui-diag-all-good">Re-scanning…</p>';
      await this._run(99);
    });

    this._overlay.querySelector('[data-action="report"]')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(JSON.stringify(this.getReport(), null, 2))
        .then(() => log.info('diagnostics', 'Diagnostic report copied to clipboard.'))
        .catch(() => log.info('diagnostics', 'Report:', JSON.stringify(this.getReport(), null, 2)));
    });

    this._overlay.querySelector('[data-action="issue"]')?.addEventListener('click', () => {
      this.openIssueURL();
    });

    this._overlay.querySelector('[data-action="analytics"]')?.addEventListener('click', () => {
      const analytics = this.ui._augment?.analytics;
      if (!analytics) return;
      const { total, unique, top, unhandled } = analytics.getSummary();
      const csv = [
        'prompt,count,successes,success_rate,needs_work',
        ...Object.values(analytics._data)
          .sort((a, b) => b.count - a.count)
          .map(e => {
            const rate = e.count > 0 ? (e.successes / e.count * 100).toFixed(0) : '0';
            const needsWork = e.count > 1 && e.successes / e.count < 0.5 ? 'yes' : '';
            return `"${e.prompt.replace(/"/g, '""')}",${e.count},${e.successes},${rate}%,${needsWork}`;
          }),
      ].join('\n');
      navigator.clipboard?.writeText(csv)
        .then(() => log.info('diagnostics', 'Prompt analytics copied as CSV.'))
        .catch(() => {
          const blob = new Blob([csv], { type: 'text/csv' });
          const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob),
            download: 'ghost-panel-prompts.csv',
          });
          a.click();
          URL.revokeObjectURL(a.href);
        });
    });

    // Close on backdrop click.
    this._overlay.addEventListener('click', e => {
      if (e.target === this._overlay) this.hide();
    });
  }

  // ── Public report API ─────────────────────────────────────────────────────

  getReport() {
    return {
      version:        '0.1.0',
      timestamp:      new Date().toISOString(),
      status:         this.status,
      activeWorkflows: this.ui.activeWorkflows ?? [],
      updateCalled:   this._updateFired,
      objectCount:    this.ui.objectManager?.objects
                        ? Object.keys(this.ui.objectManager.objects).length
                        : null,
      issues:         this.issues.map(({ id, level, title, detail, resolved, resolution }) =>
                        ({ id, level, title, detail, resolved, resolution })),
      env: {
        url:       location.href,
        userAgent: navigator.userAgent,
        gpVersion: '0.1.0',
      },
    };
  }

  generateIssueURL() {
    const r = this.getReport();
    const openIssues = r.issues.filter(i => !i.resolved);
    const title = openIssues.length > 0
      ? `[Ghost Panel] ${openIssues.map(i => i.title).join(' · ')}`
      : '[Ghost Panel] Diagnostic report';

    const body = [
      '## Environment',
      `- Ghost Panel version: ${r.gpVersion}`,
      `- URL: ${r.env.url}`,
      `- User-Agent: ${r.env.userAgent}`,
      `- Active workflows: ${r.activeWorkflows.join(', ') || 'none'}`,
      `- ui.update() called: ${r.updateCalled}`,
      `- Scene objects detected: ${r.objectCount ?? 'n/a'}`,
      '',
      '## Issues',
      openIssues.length === 0
        ? '*(no issues detected)*'
        : openIssues.map(i => `### ${i.level.toUpperCase()}: ${i.title}\n${i.detail}`).join('\n\n'),
      '',
      '## Steps to Reproduce',
      '<!-- Paste your createGhostPanel() call here -->',
      '',
      '## Expected Behavior',
      '<!-- What did you expect Ghost Panel to do? -->',
      '',
      '## Actual Behavior',
      '<!-- What actually happened? -->',
    ].join('\n');

    const params = new URLSearchParams({ title, body, labels: 'bug' });
    return `${this.repo}/issues/new?${params}`;
  }

  openIssueURL() {
    window.open(this.generateIssueURL(), '_blank', 'noopener');
  }

  destroy() {
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    this._badge?.remove();
    this._overlay?.remove();
  }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Factory — called automatically from createGhostPanel ────────────────────

/**
 * Attach diagnostics to a Ghost Panel ui handle.
 * Adds the health badge to the panel header and runs checks.
 *
 * @param {object} ui        - Ghost Panel ui handle
 * @param {object} [opts]
 * @param {string} [opts.repo] - GitHub repo URL for issue reporting
 * @returns {DiagnosticEngine}
 */
export function attachDiagnostics(ui, opts = {}) {
  const engine = new DiagnosticEngine(ui, opts);
  ui._diagnostics = engine;

  // Attach the badge to the panel header once the DOM is ready.
  // Panel stores its root element as panel.element (not panel.el).
  const findHeader = () => ui.panel?.element?.querySelector?.('.dui-header');
  const header = findHeader();
  if (header) {
    engine.attachBadge(header);
  } else {
    requestAnimationFrame(() => {
      const h = findHeader();
      if (h) engine.attachBadge(h);
    });
  }

  return engine;
}
