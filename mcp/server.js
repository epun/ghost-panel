#!/usr/bin/env node
/**
 * Ghost Panel MCP server.
 *
 * Bridges an MCP client (Claude Code, Claude Desktop, any other) to a Ghost
 * Panel running in a browser tab. Two transports meet here:
 *
 *   MCP client  ──stdio/JSON-RPC──>  this process  ──SSE + POST──>  the page
 *
 * The page half is plain HTTP so the browser library needs no socket
 * dependency; this half uses the official MCP SDK so we don't hand-roll the
 * protocol. The SDK is an optional dependency — only someone running this
 * server installs it, and the browser bundle never sees it.
 *
 *   npx ghost-panel-mcp [--port 7391] [--no-token]
 */
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { TOOLS } from './tools.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};

const PORT = Number(flag('port', process.env.GHOST_PANEL_MCP_PORT || 7391));
const TOKEN = argv.includes('--no-token') ? null : (process.env.GHOST_PANEL_MCP_TOKEN || randomBytes(12).toString('hex'));
const CALL_TIMEOUT_MS = Number(flag('timeout', 15000));

// stdout is the JSON-RPC channel — every human-readable byte goes to stderr or
// it corrupts the protocol stream.
const note = (...a) => console.error('[ghost-panel-mcp]', ...a);

// ── The page side ─────────────────────────────────────────────────────────
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();
/** @type {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
const pending = new Map();

function authorized(req) {
  if (!TOKEN) return true;
  const url = new URL(req.url, 'http://127.0.0.1');
  return url.searchParams.get('token') === TOKEN;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  // Loopback dev origins only. The page and this server are on different
  // ports, so the browser treats every call as cross-origin.
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  if (!authorized(req)) { res.writeHead(401).end('bad token'); return; }

  if (url.pathname === '/bridge/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    note(`page connected (${clients.size} open)`);
    // Proxies and browsers drop an idle event stream; a comment every 20s is
    // enough to keep it alive and costs nothing.
    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); note(`page disconnected (${clients.size} open)`); });
    return;
  }

  if (url.pathname === '/bridge/result' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 32 * 1024 * 1024) req.destroy();   // a screenshot is the big one
    });
    req.on('end', () => {
      res.writeHead(204).end();
      let msg;
      try { msg = JSON.parse(body); } catch { return; }
      const slot = pending.get(msg.id);
      if (!slot) return;                                   // timed out already
      clearTimeout(slot.timer);
      pending.delete(msg.id);
      msg.ok ? slot.resolve(msg.result) : slot.reject(new Error(msg.error || 'The page reported an error.'));
    });
    return;
  }

  if (url.pathname === '/bridge/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pages: clients.size }));
    return;
  }

  res.writeHead(404).end();
});

/** Send one tool call to the connected page and wait for its answer. */
function callPage(tool, args) {
  if (clients.size === 0) {
    return Promise.reject(new Error(
      'No Ghost Panel is connected. Open the page and call attachMCPBridge(ui, { token }) ' +
      'in a dev build, then retry.'));
  }
  const id = randomUUID();
  const frame = `data: ${JSON.stringify({ type: 'call', id, tool, args })}\n\n`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${tool} timed out after ${CALL_TIMEOUT_MS}ms. Is the tab backgrounded or paused in the debugger?`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    // Broadcast: with several tabs open the first to answer wins, which is the
    // behaviour you want when you reload the page mid-session.
    for (const c of clients) { try { c.write(frame); } catch { clients.delete(c); } }
  });
}

// ── The MCP side ──────────────────────────────────────────────────────────
async function main() {
  let Server, StdioServerTransport, CallToolRequestSchema, ListToolsRequestSchema;
  try {
    ({ Server } = await import('@modelcontextprotocol/sdk/server/index.js'));
    ({ StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js'));
    ({ CallToolRequestSchema, ListToolsRequestSchema } =
      await import('@modelcontextprotocol/sdk/types.js'));
  } catch {
    note('Missing peer: install the MCP SDK to run this server —\n' +
         '  npm install @modelcontextprotocol/sdk');
    process.exit(1);
  }

  const mcp = new Server(
    { name: 'ghost-panel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { readOnlyHint: t.readOnly },
    })),
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const result = await callPage(name, args || {});
      // A screenshot is worth returning as an image the client can actually
      // look at, not a 200KB base64 string in a text block.
      if (name === 'screenshot' && typeof result?.dataURL === 'string') {
        return {
          content: [{
            type: 'image',
            mimeType: 'image/png',
            data: result.dataURL.replace(/^data:image\/png;base64,/, ''),
          }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
  });

  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  note(`bridge listening on http://127.0.0.1:${PORT}`);
  if (TOKEN) note(`token: ${TOKEN}\n  attachMCPBridge(ui, { token: '${TOKEN}' })`);
  else note('running WITHOUT a token — any page on this machine can drive the panel');

  await mcp.connect(new StdioServerTransport());
}

main().catch((e) => { note('failed to start:', e); process.exit(1); });
