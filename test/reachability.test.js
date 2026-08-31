/**
 * The panel has to be reachable: something must put it on screen.
 *
 * Ghost Panel used to mount hidden AND never bind the shortcut it documented,
 * which is the one combination a host cannot recover from — the panel can't
 * show itself and the user can't ask it to. Nothing errored, so a correct
 * integration looked exactly like a broken one. These tests pin the two
 * defaults that rule it out, and the warning for hosts that opt back in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGhostPanel } from '../index.js';
import { SceneObjectManager } from '../three-extensions.js';

const panels = [];
function mount(opts) {
  const ui = createGhostPanel(opts);
  panels.push(ui);
  return ui;
}

afterEach(() => {
  while (panels.length) panels.pop()?.dispose();
  document.querySelectorAll('.ghost-panel').forEach(el => el.remove());
});

/** Fire the chord a user would actually press. */
function press(key, mods = {}) {
  window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta, altKey: !!mods.alt, bubbles: true, cancelable: true,
  }));
}

describe('panel reachability', () => {
  it('mounts visible by default', () => {
    const ui = mount();
    expect(ui.isVisible()).toBe(true);
    expect(ui.panel.element.style.display).not.toBe('none');
  });

  it('binds the documented Shift+D shortcut on mount', () => {
    const ui = mount();
    expect(ui.toggleKeys).toContain('Shift+D');

    press('D', { shift: true });
    expect(ui.isVisible()).toBe(false);
    press('D', { shift: true });
    expect(ui.isVisible()).toBe(true);
  });

  it('reveals a panel that was mounted hidden', () => {
    const ui = mount({ visible: false });
    expect(ui.isVisible()).toBe(false);
    press('D', { shift: true });
    expect(ui.isVisible()).toBe(true);
  });

  it('honours a custom chord and leaves the default one unbound', () => {
    const ui = mount({ toggleKey: { key: 'G', shift: true, alt: true } });
    expect(ui.toggleKeys).toEqual(['Alt+Shift+G']);

    press('D', { shift: true });
    expect(ui.isVisible()).toBe(true);        // untouched
    press('G', { shift: true, alt: true });
    expect(ui.isVisible()).toBe(false);
  });

  it('ignores a duplicate bindToggleKey for a chord already bound', () => {
    // The README told hosts to call this themselves. Now that Ghost Panel
    // binds Shift+D on mount, a host that still does so would otherwise get
    // two listeners and a shortcut that toggles twice — i.e. does nothing.
    const ui = mount();
    ui.bindToggleKey('D', { shift: true });
    expect(ui.toggleKeys).toEqual(['Shift+D']);

    press('D', { shift: true });
    expect(ui.isVisible()).toBe(false);
  });

  it('lets a host take the gesture back with toggleKey: false', () => {
    const ui = mount({ toggleKey: false });
    expect(ui.toggleKeys).toEqual([]);
    press('D', { shift: true });
    expect(ui.isVisible()).toBe(true);        // nothing listening
  });

  it('warns when mounted hidden with no way to show it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ visible: false, toggleKey: false });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/hidden with no toggle key/i);
    warn.mockRestore();
  });

  it('stops listening after dispose', () => {
    // A leaked keydown handler pointing at a torn-down panel is what breaks
    // React StrictMode's double-mount (issue #15), and auto-binding adds one
    // handler per mount — so dispose has to take it back off the window.
    const ui = createGhostPanel();
    ui.dispose();
    const before = ui.isVisible();
    press('D', { shift: true });              // must be inert on a dead panel
    expect(ui.isVisible()).toBe(before);
  });
});

describe('scene helper suppression', () => {
  // Exercised against the prototype: constructing a real manager needs a
  // WebGLRenderer, which jsdom has no business providing.
  const helpers = (state) => ({
    setHelpersVisible: SceneObjectManager.prototype.setHelpersVisible,
    _suppressHelper: SceneObjectManager.prototype._suppressHelper,
    ...state,
  });

  it('hides gizmo and object helpers, then restores what was on before', () => {
    const gizmoHelper = { visible: true };
    const lampHelper = { visible: true };
    const camHelper = { visible: false };     // host deliberately switched this off
    const om = helpers({
      gizmo: { getHelper: () => gizmoHelper },
      objects: { Lamp: { helper: lampHelper }, POV: { helper: camHelper }, Mesh: {} },
    });

    om.setHelpersVisible(false);
    expect([gizmoHelper.visible, lampHelper.visible, camHelper.visible]).toEqual([false, false, false]);

    om.setHelpersVisible(true);
    expect(gizmoHelper.visible).toBe(true);
    expect(lampHelper.visible).toBe(true);
    expect(camHelper.visible).toBe(false);    // stays off — it was never ours to turn on
  });

  it('suppresses helpers registered while hidden', () => {
    const om = helpers({ gizmo: null, objects: {} });
    om.setHelpersVisible(false);

    const late = { visible: true };
    om._suppressHelper(late);
    expect(late.visible).toBe(false);

    om.setHelpersVisible(true);
    expect(late.visible).toBe(true);
  });

  it('is idempotent — a second hide does not overwrite the saved state', () => {
    const helper = { visible: true };
    const om = helpers({ gizmo: null, objects: { Lamp: { helper } } });

    om.setHelpersVisible(false);
    om.setHelpersVisible(false);
    om.setHelpersVisible(true);
    expect(helper.visible).toBe(true);
  });
});
