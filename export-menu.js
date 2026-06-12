/**
 * Export popover menu — surfaces ambient/context-aware deliverables.
 *
 * Clicking the download (↓) button in the panel header opens this menu
 * instead of immediately downloading JSON. The menu shows only exporters
 * relevant to the currently-active workflows.
 */
import { getAvailableExporters, runExport } from './exports.js';
import { icons } from './icons.js';
import { alertDialog } from './modal.js';
import { scanProject } from './project-scanner.js';

export class ExportMenu {
  constructor(ui) {
    this.ui = ui;
    // Host-supplied save exporter (registered via panel.setSaveLoadHandlers).
    // We keep it on the instance rather than in the global REGISTRY so it
    // never leaks to other UIs sharing the same Ghost Panel build.
    this._hostSave = null;
    this._build();
  }

  /** Add (or replace) a host-supplied save exporter at the top of the menu. */
  _registerHostSave(exporter) {
    this._hostSave = exporter || null;
  }
  /** Drop the host-supplied save exporter. */
  _unregisterHostSave() {
    this._hostSave = null;
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'dui-export-menu';
    document.body.appendChild(el);
    this.element = el;

    // Close on click outside
    this._onDocClick = (e) => {
      if (!el.contains(e.target) && !this._lastAnchor?.contains(e.target)) {
        this.close();
      }
    };
  }

  /** Open the menu anchored under a button. */
  open(anchor) {
    this._lastAnchor = anchor;
    this._render();
    const r = anchor.getBoundingClientRect();
    this.element.style.top  = `${r.bottom + 8}px`;
    this.element.style.left = `${r.right - this.element.offsetWidth}px`;
    this.element.classList.add('dui-visible');
    // Re-position once the element has measured size
    requestAnimationFrame(() => {
      this.element.style.left = `${r.right - this.element.offsetWidth}px`;
    });
    setTimeout(() => document.addEventListener('click', this._onDocClick), 0);
  }

  close() {
    this.element.classList.remove('dui-visible');
    document.removeEventListener('click', this._onDocClick);
  }

  _render() {
    // Combine explicitly-active workflows with anything the project
    // scanner can infer from the live page (Three.js scene, web
    // adapters, 2D canvas, etc.). Host projects that don't trip the
    // workflow auto-detection still see relevant exporters this way.
    const active = new Set(this.ui.activeWorkflows || []);
    try {
      const sigs = scanProject(this.ui);
      if (sigs.includes('three'))     active.add('3d');
      if (sigs.includes('canvas-2d')) active.add('2d');
      if (sigs.includes('web'))       active.add('web');
      // 'animation' is implied if there's a graph editor — the host
      // wires that through opts.tracks at init, so it's already in
      // activeWorkflows if relevant.
    } catch {}
    const effective = [...active];
    const items = getAvailableExporters(effective);

    // Group items: always-available first, then workflow-specific
    const universal = items.filter(i => i.workflows?.includes('*'));
    const contextual = items.filter(i => !i.workflows?.includes('*'));

    this.element.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'dui-export-menu-header';
    header.innerHTML = `
      <div class="dui-export-menu-title">Export</div>
      <div class="dui-export-menu-sub">${
        effective.length
          ? `Based on active workflows: ${effective.join(' · ')}`
          : 'Choose a deliverable'
      }</div>
    `;
    this.element.appendChild(header);

    // Host-supplied save (from panel.setSaveLoadHandlers) sits at the
    // very top — it's the user's most likely click target since the
    // host wired it intentionally. Falls back to the regular contextual
    // group if there's no host save.
    if (this._hostSave) {
      this._addGroup('Project', [this._hostSave]);
    }
    if (contextual.length) {
      this._addGroup('For this project', contextual);
    }
    if (universal.length) {
      this._addGroup('Always available', universal);
    }
    if (items.length === 0 && !this._hostSave) {
      const empty = document.createElement('div');
      empty.className = 'dui-export-menu-empty';
      empty.textContent = 'No export formats available.';
      this.element.appendChild(empty);
    }
  }

  _addGroup(label, items) {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'dui-export-menu-group';
    groupLabel.textContent = label;
    this.element.appendChild(groupLabel);

    items.forEach(exp => {
      const item = document.createElement('button');
      item.className = 'dui-export-menu-item';
      item.innerHTML = `
        <div class="dui-export-menu-item-icon">${this._iconFor(exp.id)}</div>
        <div class="dui-export-menu-item-text">
          <div class="dui-export-menu-item-label">${exp.label}</div>
          <div class="dui-export-menu-item-desc">${exp.description || ''}</div>
        </div>
        <div class="dui-export-menu-item-ext">.${exp.extension}</div>
      `;
      item.addEventListener('click', async () => {
        this.close();
        try {
          item.classList.add('dui-busy');
          // Host-supplied saves run their own callback (they typically
          // handle the download themselves), so we call run() directly
          // instead of routing through the global REGISTRY lookup.
          if (exp.isHostSave) {
            await exp.run(this.ui);
          } else {
            await runExport(this.ui, exp.id);
          }
        } catch (err) {
          console.error('[Ghost Panel] Export failed:', err);
          await alertDialog(err?.message || String(err), {
            title: 'Export failed', icon: icons.warning,
          });
        } finally {
          item.classList.remove('dui-busy');
        }
      });
      this.element.appendChild(item);
    });
  }

  _iconFor(id) {
    // Lightweight inline glyphs per format — Phosphor for visual
    // formats, plaintext mnemonics for code formats (so "css" / "glsl"
    // still read clearly as the developer-facing exports).
    const map = {
      json:           '{ }',
      png:            icons.image,
      webm:           icons.play,
      glb:            icons.cube,
      obj:            icons.cube,
      svg:            icons.image,
      'html-snippet': '<>',
      'animation-json': '{ }',
      'css-keyframes':  'css',
      glsl:           'glsl',
    };
    return `<span class="dui-export-glyph">${map[id] || '↓'}</span>`;
  }

  dispose() { this.element.remove(); }
}
