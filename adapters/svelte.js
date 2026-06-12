/**
 * Ghost Panel · Svelte adapter
 *
 * Two ways to use this:
 *
 * 1. Action (works in Svelte 3 / 4 / 5) — mount it via `use:ghostPanel`:
 *
 *      <script>
 *        import { ghostPanel } from 'ghost-panel/svelte';
 *        let ui;
 *      </script>
 *
 *      <div use:ghostPanel={{
 *        options: { title: 'Inspector' },
 *        onReady: u => ui = u,
 *      }} />
 *
 *    The element the action is attached to is NOT used — the panel
 *    mounts to document.body. The action just owns the lifecycle.
 *
 * 2. Plain function (works anywhere) — call it from your own onMount:
 *
 *      import { onMount, onDestroy } from 'svelte';
 *      import { mountGhostPanel } from 'ghost-panel/svelte';
 *      let ui;
 *      onMount(() => { ui = mountGhostPanel({ title: 'Inspector' }); });
 *      onDestroy(() => ui?.dispose?.());
 */

import { createGhostPanel } from '../index.js';

/** Svelte action — attach via `use:ghostPanel={{ options, onReady, onDispose }}`. */
export function ghostPanel(node, params = {}) {
  let ui = createGhostPanel(params.options || {});
  params.onReady?.(ui);
  return {
    update(next = {}) {
      // Re-mount only if the consumer explicitly passes a new `key`
      // (matches React semantics). Per-control values are mutated
      // through the `ui` handle, not by re-creating.
      if (next.key !== undefined && next.key !== params.key) {
        params.onDispose?.(ui);
        ui?.dispose?.();
        ui = createGhostPanel(next.options || {});
        next.onReady?.(ui);
      }
      params = next;
    },
    destroy() {
      params.onDispose?.(ui);
      ui?.dispose?.();
      ui = null;
    },
  };
}

/** Plain function — pairs with onMount/onDestroy. */
export function mountGhostPanel(options = {}) {
  return createGhostPanel(options);
}

export default ghostPanel;
