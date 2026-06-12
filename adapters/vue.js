/**
 * Ghost Panel · Vue 3 adapter
 *
 *   <script setup>
 *   import { GhostPanel } from 'ghost-panel/vue';
 *   const ui = ref(null);
 *   </script>
 *
 *   <template>
 *     <YourCanvas />
 *     <GhostPanel :options="{ title: 'Inspector' }" @ready="ui = $event" />
 *   </template>
 *
 * Renders nothing — the panel mounts to document.body. Disposes
 * automatically on component unmount.
 */

import { defineComponent, onMounted, onBeforeUnmount } from 'vue';
import { createGhostPanel } from '../index.js';

export const GhostPanel = defineComponent({
  name: 'GhostPanel',
  props: {
    options: { type: Object, default: () => ({}) },
  },
  emits: ['ready', 'dispose'],
  setup(props, { emit, slots }) {
    let ui = null;
    onMounted(() => {
      ui = createGhostPanel(props.options);
      emit('ready', ui);
    });
    onBeforeUnmount(() => {
      emit('dispose', ui);
      ui?.dispose?.();
      ui = null;
    });
    return () => slots.default ? slots.default() : null;
  },
});

/**
 * Composable for users who'd rather wire lifecycle in their own setup().
 *
 *   const ui = useGhostPanel({ title: 'Inspector' });
 */
export function useGhostPanel(options = {}) {
  let ui = null;
  onMounted(() => { ui = createGhostPanel(options); });
  onBeforeUnmount(() => { ui?.dispose?.(); ui = null; });
  return () => ui;
}

/** Vue plugin form — `app.use(GhostPanelPlugin)` registers the component globally. */
export const GhostPanelPlugin = {
  install(app) {
    app.component('GhostPanel', GhostPanel);
  },
};

export default GhostPanel;
