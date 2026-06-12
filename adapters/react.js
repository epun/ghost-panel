/**
 * Ghost Panel · React adapter
 *
 * Thin wrapper that mounts createGhostPanel() once on `useEffect` and
 * disposes on unmount. Re-mounts only when `key`-changing props would
 * meaningfully change the UI (workflow / workflowOpts.background) —
 * other prop changes are passed through via a re-init.
 *
 *   import { GhostPanel } from 'ghost-panel/react';
 *
 *   function App() {
 *     const uiRef = useRef(null);
 *     return (
 *       <>
 *         <YourCanvas />
 *         <GhostPanel options={{ title: 'Inspector' }} onReady={ui => uiRef.current = ui} />
 *       </>
 *     );
 *   }
 *
 * `options` is forwarded straight to createGhostPanel. `onReady` receives
 * the ui handle after mount. The component renders no DOM of its own —
 * the panel mounts to document.body by default.
 */

import { createElement, useEffect, useRef } from 'react';
import { createGhostPanel } from '../index.js';

export function GhostPanel({ options = {}, onReady, onDispose, children = null }) {
  const uiRef = useRef(null);
  const onReadyRef = useRef(onReady);
  const onDisposeRef = useRef(onDispose);
  // Keep the latest callback refs without retriggering the effect.
  useEffect(() => { onReadyRef.current = onReady; onDisposeRef.current = onDispose; });

  // Mount/unmount lifecycle. React strict mode will double-invoke this
  // in dev — we early-return if a panel is already mounted to avoid
  // creating two of them in the document.
  useEffect(() => {
    if (uiRef.current) return;
    const ui = createGhostPanel(options);
    uiRef.current = ui;
    onReadyRef.current?.(ui);
    return () => {
      onDisposeRef.current?.(ui);
      ui?.dispose?.();
      uiRef.current = null;
    };
    // Intentionally not depending on `options` — the panel is mutable
    // at runtime via the returned `ui` handle. If you want a hard reset,
    // change the React `key` of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children;
}

/**
 * Hook variant for users who prefer composing into an existing component
 * tree without rendering a wrapper element.
 *
 *   function App() {
 *     const ui = useGhostPanel({ title: 'Inspector' });
 *     return <YourCanvas />;
 *   }
 */
export function useGhostPanel(options = {}) {
  const uiRef = useRef(null);
  useEffect(() => {
    if (uiRef.current) return;
    uiRef.current = createGhostPanel(options);
    return () => { uiRef.current?.dispose?.(); uiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return uiRef.current;
}

export default GhostPanel;
