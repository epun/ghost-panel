/**
 * Connects a live Ghost Panel to the local MCP server so an agent can drive it.
 *
 * Transport is deliberately boring: Server-Sent Events down for commands, a
 * POST back up with the result. Both are built into every browser, which keeps
 * the library's zero-dependency promise intact — no socket library, nothing
 * bundled. The bridge is also strictly opt-in and localhost-only: agent control
 * of a page is not something to switch on by default.
 *
 *   import { createGhostPanel } from 'ghost-panel';
 *   import { attachMCPBridge } from 'ghost-panel/mcp-bridge';
 *
 *   const ui = createGhostPanel({ scene, camera, renderer });
 *   if (import.meta.env.DEV) attachMCPBridge(ui, { token: 'paste-from-server' });
 *
 * Then point your MCP client at `npx ghost-panel-mcp`.
 */
import { runCommand, CommandError } from './mcp-commands.js';
import { WRITE_TOOLS } from './mcp/tools.js';
import { log } from './log.js';

const DEFAULT_URL = 'http://127.0.0.1:7391';

/** Only ever talk to a loopback server; an agent bridge has no business going off-box. */
function assertLoopback(url) {
  const { hostname, protocol } = new URL(url);
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  if (!local) throw new Error(`attachMCPBridge refuses a non-loopback URL: ${url}`);
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error(`Unsupported protocol: ${protocol}`);
}

/**
 * @param {object} ui           the handle from createGhostPanel()
 * @param {object} [opts]
 * @param {string} [opts.url]       bridge server origin (loopback only)
 * @param {string} [opts.token]     shared token printed by the server on start
 * @param {boolean} [opts.readOnly] expose the panel for inspection but refuse every write
 * @param {(name, args) => boolean} [opts.confirm]
 *        Called before each mutating tool. Return false to refuse it — a hook
 *        for hosts that want a human in the loop on agent writes.
 */
export function attachMCPBridge(ui, opts = {}) {
  const url = (opts.url || DEFAULT_URL).replace(/\/$/, '');
  assertLoopback(url);
  const { token = null, readOnly = false, confirm = null } = opts;

  let source = null;
  let disposed = false;
  let retry = 1000;

  const endpoint = (path) => `${url}${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  async function reply(id, payload) {
    try {
      await fetch(endpoint('/bridge/result'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      });
    } catch (e) {
      log.debug('mcp-bridge', 'could not post result:', e);
    }
  }

  function handle(evt) {
    let msg;
    try { msg = JSON.parse(evt.data); }
    catch { return; }
    if (!msg || msg.type !== 'call') return;

    const { id, tool, args } = msg;
    try {
      // Writes only. Asking a human to approve get_scene_tree would make the
      // hook unusable, and the option is documented as gating mutations.
      if (confirm && !readOnly && WRITE_TOOLS.includes(tool)) {
        if (confirm(tool, args) === false) throw new CommandError(`The host refused ${tool}.`);
      }
      const result = runCommand(ui, tool, args || {}, { readOnly });
      reply(id, { ok: true, result });
    } catch (e) {
      // CommandError is the agent's fault and actionable; anything else is ours
      // and worth surfacing in the host console too.
      if (!(e instanceof CommandError)) log.error('mcp-bridge', `${tool} threw:`, e);
      reply(id, { ok: false, error: e.message || String(e) });
    }
  }

  function connect() {
    if (disposed) return;
    source = new EventSource(endpoint('/bridge/events'));
    source.addEventListener('open', () => {
      retry = 1000;
      log.info('mcp-bridge', `connected to ${url}${readOnly ? ' (read-only)' : ''}`);
    });
    source.addEventListener('message', handle);
    source.addEventListener('error', () => {
      // EventSource reconnects on its own, but only while the server is up.
      // Close and back off ourselves so a server that never starts doesn't
      // produce an endless stream of failed requests in the host's console.
      source?.close();
      source = null;
      if (disposed) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    });
  }

  connect();

  const bridge = {
    get connected() { return source?.readyState === 1; },
    readOnly,
    url,
    dispose() { disposed = true; source?.close(); source = null; },
  };
  ui.mcp = bridge;
  return bridge;
}
