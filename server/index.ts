// Local-only HTTP server: binds 127.0.0.1, serves the built UI and the allow-listed /api routes.
// CSRF/DNS-rebinding protection: Host must be loopback; state-changing requests must carry the
// custom X-SponsorFirst header (forces a CORS preflight that this server never approves).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db/db.js';
import { routes, HttpError, findLocalRegisterFiles } from './api.js';
import { proposeAllMatches, seedEmployers } from './core/discovery/employers.js';
import { activeSnapshot, importSponsorCsv } from './core/sponsors/import.js';
import { allAdapters, ensureSourceRows, verifySource } from './core/sources/registry.js';
import { recoverInterruptedRuns, startScan } from './core/discovery/scan.js';
import { reevaluateAll } from './core/discovery/pipeline.js';
import { buildDailyBatch } from './core/ranking/daily.js';
import { getSettings } from './config/settings.js';
import { startScheduler } from './core/discovery/scheduler.js';
import { redact } from './config/secrets.js';
import { log } from './log.js';

const PORT = Number(process.env.TRACKR_PORT ?? 4317);
const HOST = '127.0.0.1';
const DIST = process.env.TRACKR_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(data);
}

function hostOk(req: http.IncomingMessage) {
  const h = (req.headers.host ?? '').toLowerCase();
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h);
}

async function readBody(req: http.IncomingMessage, limit = 60 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!hostOk(req)) return send(res, 421, 'Misdirected request');
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        const method = req.method ?? 'GET';
        if (method !== 'GET') {
          if (req.headers['x-sponsorfirst'] !== '1') return send(res, 403, { error: 'Missing X-SponsorFirst header' });
          const origin = req.headers.origin;
          if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Cross-origin request refused' });
        }
        const r = routes.find((x) => x.method === method && x.pattern.test(url.pathname));
        if (!r) return send(res, 404, { error: 'Unknown route' });
        const m = url.pathname.match(r.pattern)!;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const raw = method === 'GET' ? '' : await readBody(req);
        let body: any = null;
        if (raw && (req.headers['content-type'] ?? '').includes('application/json')) {
          try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
        }
        const out = await r.handler({ params, query: url.searchParams, body, raw });
        if (out && out.__download) {
          const ct = out.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8';
          res.writeHead(200, { 'Content-Type': ct, 'Content-Disposition': `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.${out.format}"`, 'Cache-Control': 'no-store' });
          return res.end(out.content);
        }
        return send(res, 200, out ?? { ok: true });
      }
      // Static UI
      let p = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
      if (!p.startsWith(DIST)) return send(res, 400, 'Bad path');
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
      if (!fs.existsSync(p)) return send(res, 200, 'UI not built yet. Run "npm run build:ui" (or use "npm run dev:web" for development).');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
      fs.createReadStream(p).pipe(res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const msg = redact((e as Error).message ?? 'Error');
      if (status >= 500) log('error', 'request_failed', { path: req.url, error: msg });
      send(res, status, { error: msg });
    }
  });
}

let interrupted: ReturnType<typeof recoverInterruptedRuns> = null;
export function bootstrap() {
  getDb();
  ensureSourceRows();
  seedEmployers();
  interrupted = recoverInterruptedRuns();
}

/** Start the full app server (used by `npm run start:server` and by the packaged .exe in-process). */
export function startApp(port = PORT): Promise<http.Server> {
  bootstrap();
  // First run on a new computer: import the sponsor register bundled with the .exe.
  if (!activeSnapshot() && process.env.TRACKR_RESOURCES) {
    const f = findLocalRegisterFiles().find((x) => x.path.startsWith(process.env.TRACKR_RESOURCES!));
    if (f) void importSponsorCsv(f.path).then(() => proposeAllMatches()).catch((e) => log('error', 'bundled_register_import_failed', { error: String(e) }));
  }
  if (process.env.TRACKR_NO_SCHEDULER !== '1') startScheduler();
  // Pick up where you left off: a scan cut short by closing the app continues automatically.
  if (interrupted && getSettings().resume_interrupted_scans && activeSnapshot()) {
    const it = interrupted; interrupted = null;
    setTimeout(() => {
      try { startScan({ mode: it.mode === 'SCHEDULED' ? 'MANUAL_FULL' : it.mode, query: it.query, scope: it.intent?.scope, market: it.intent?.market, roleFocus: it.intent?.roleFocus }); log('info', 'scan_resumed', { mode: it.mode }); }
      catch (e) { log('warn', 'scan_resume_failed', { error: String(e) }); }
    }, 5000);
  }
  // After an update with new rules: re-grade jobs graded under the old rules (no AI calls), then refill today's Daily 15.
  setTimeout(() => {
    void reevaluateAll({ outdatedOnly: true })
      .then((n) => { if (n) log('info', 'regraded_after_update', { jobs: n }); buildDailyBatch(); })
      .catch((e) => log('warn', 'regrade_failed', { error: String(e) }));
  }, 8000);
  // Refresh source connection status in the background (robots.txt checks, ATS probes, key checks).
  setTimeout(async () => {
    for (const a of allAdapters()) { try { await verifySource(a.id); } catch { /* recorded per source */ } }
  }, 3000);
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(port, HOST, () => {
      log('info', 'server_started', { url: `http://${HOST}:${port}` });
      console.log(`SponsorFirst running at http://${HOST}:${port}`);
      resolve(srv);
    });
  });
}

const isMain = !process.versions.electron && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void startApp();
