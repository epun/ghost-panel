/**
 * Vite plugin — exposes `POST /__ghost-panel/apply-fix` so the browser-side
 * LearningStore can write proposals back to source files in dev.
 *
 *   import { ghostPanelPlugin } from 'ghost-panel/vite-plugin';
 *   export default defineConfig({ plugins: [ghostPanelPlugin()] });
 *
 * Request body shape:
 *   { file: 'modal-transform.js', find: '...', replace: '...', reason: '...' }
 *
 * Safety:
 *   • `file` must be a path INSIDE the project root, never absolute,
 *     never containing `..`. Plugin refuses anything else.
 *   • `find` must occur exactly once in the file. The plugin returns 409
 *     otherwise (so we never blindly mass-replace).
 *   • Every applied fix is appended to `.ghost-panel-fixes.log` with a
 *     timestamp + reason, so you have an audit trail.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { log } from './log.js';

const LOG_PATH       = '.ghost-panel-fixes.log';
const ANALYTICS_PATH = '.ghost-panel-analytics.ndjson';

export function ghostPanelPlugin(opts = {}) {
  const root = opts.root || process.cwd();
  return {
    name: 'Ghost Panel',
    apply: 'serve',   // dev-only — never ships to a production build
    configureServer(server) {
      // ── POST /__ghost-panel/analytics ──────────────────────────────────────
      // Appends each augment prompt event to .ghost-panel-analytics.ndjson.
      // Read it with: jq -s 'group_by(.prompt)|map({p:.[0].prompt,n:length})|sort_by(-.n)' .ghost-panel-analytics.ndjson
      server.middlewares.use('/__ghost-panel/analytics', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        for await (const chunk of req) body += chunk;
        let payload;
        try { payload = JSON.parse(body); }
        catch { return send(res, 400, { error: 'invalid JSON' }); }

        const line = JSON.stringify({ ...payload, _serverTs: new Date().toISOString() }) + '\n';
        try { await appendFile(resolve(root, ANALYTICS_PATH), line); } catch (e) { log.warn('vite-plugin', 'analytics append failed:', e); }
        send(res, 200, { ok: true });
      });

      // ── GET /__ghost-panel/analytics/summary ───────────────────────────────
      // Returns the top N prompts from the NDJSON log so you can see what to
      // build next without leaving the browser. Open in DevTools or fetch().
      server.middlewares.use('/__ghost-panel/analytics/summary', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const n = Number(new URL(req.url, 'http://x').searchParams.get('n') ?? 20);
        let raw;
        try { raw = await readFile(resolve(root, ANALYTICS_PATH), 'utf8'); }
        catch { return send(res, 200, { prompts: [], total: 0, note: 'No analytics yet.' }); }

        // Aggregate counts server-side
        const counts = {};
        for (const line of raw.split('\n').filter(Boolean)) {
          try {
            const { prompt, successes, count } = JSON.parse(line);
            if (!prompt) continue;
            const e = counts[prompt] ?? { prompt, count: 0, successes: 0 };
            e.count     += count ?? 1;
            e.successes += successes ?? (count ?? 1);
            counts[prompt] = e;
          } catch (e) { log.debug('vite-plugin', 'analytics parse failed:', e); }
        }

        const sorted = Object.values(counts)
          .sort((a, b) => b.count - a.count)
          .slice(0, n)
          .map(e => ({
            prompt:      e.prompt,
            count:       e.count,
            successRate: e.count > 0 ? Math.round(100 * e.successes / e.count) + '%' : '—',
            needsWork:   e.count > 0 && (e.successes / e.count) < 0.5,
          }));

        const total = Object.values(counts).reduce((s, e) => s + e.count, 0);
        send(res, 200, { total, unique: Object.keys(counts).length, prompts: sorted });
      });

      // ── POST /__ghost-panel/apply-fix ──────────────────────────────────────
      server.middlewares.use('/__ghost-panel/apply-fix', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        for await (const chunk of req) body += chunk;
        let payload;
        try { payload = JSON.parse(body); }
        catch { return send(res, 400, { error: 'invalid JSON' }); }

        const { file, find, replace, reason } = payload || {};
        if (typeof file !== 'string' || typeof find !== 'string' || typeof replace !== 'string') {
          return send(res, 400, { error: 'file, find, and replace are required strings' });
        }
        if (isAbsolute(file) || file.includes('..')) {
          return send(res, 400, { error: 'file must be a project-relative path' });
        }

        const target = resolve(root, file);
        let source;
        try { source = await readFile(target, 'utf8'); }
        catch (e) { return send(res, 404, { error: `cannot read ${file}: ${e.message}` }); }

        const occurrences = source.split(find).length - 1;
        if (occurrences === 0) {
          return send(res, 409, { error: `find string not present in ${file}` });
        }
        if (occurrences > 1) {
          return send(res, 409, { error: `find string is ambiguous (${occurrences} occurrences) in ${file}` });
        }
        const patched = source.replace(find, replace);
        await writeFile(target, patched, 'utf8');
        const entry = `[${new Date().toISOString()}] ${file}\n  reason: ${reason || '(none)'}\n`;
        try { await appendFile(resolve(root, LOG_PATH), entry); } catch (e) { log.warn('vite-plugin', 'audit append failed:', e); }
        send(res, 200, { ok: true, file, bytesWritten: patched.length });
      });
    },
  };
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
