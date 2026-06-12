/**
 * Ghost Panel · Solid.js adapter
 *
 *   import { GhostPanel } from 'ghost-panel/solid';
 *
 *   function App() {
 *     let ui;
 *     return (
 *       <>
 *         <YourCanvas />
 *         <GhostPanel options={{ title: 'Inspector' }} onReady={u => (ui = u)} />
 *       </>
 *     );
 *   }
 *
 * Mounts on `onMount`, disposes on `onCleanup`. Solid's reactivity is
 * fine-grained so we don't need stale-closure guards the way React does.
 */

import { onMount, onCleanup } from 'solid-js';
import { createGhostPanel as _createGhostPanel } from '../index.js';

export function GhostPanel(props) {
  let ui = null;
  onMount(() => {
    ui = _createGhostPanel(props.options || {});
    props.onReady?.(ui);
  });
  onCleanup(() => {
    props.onDispose?.(ui);
    ui?.dispose?.();
    ui = null;
  });
  return props.children ?? null;
}

/**
 * Primitive-style hook for composing without a wrapper element.
 *
 *   const ui = createGhostPanel({ title: 'Inspector' });
 */
export function createGhostPanel(options = {}) {
  let ui = null;
  onMount(() => { ui = _createGhostPanel(options); });
  onCleanup(() => { ui?.dispose?.(); ui = null; });
  return () => ui;
}

export default GhostPanel;
