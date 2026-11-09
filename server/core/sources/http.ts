// Polite HTTP client: identified user agent, per-source spacing, timeouts, bounded retries with
// exponential backoff, Retry-After support, a circuit breaker and robots.txt checks for HTML pages.
// No stealth, proxy rotation, CAPTCHA solving or session/cookie harvesting.

const UA = 'SponsorFirst-Daily15/0.1 (personal local job tracker; respects robots.txt)';
const lastRequestAt = new Map<string, number>();
const blockedUntil = new Map<string, number>();
const robotsCache = new Map<string, { at: number; rules: RobotsRules | null }>();

export let defaultDelayMs = 400;
export let defaultTimeoutMs = 20000;
export function configureHttp(o: { delayMs?: number; timeoutMs?: number }) {
  if (o.delayMs != null) defaultDelayMs = o.delayMs;
  if (o.timeoutMs != null) defaultTimeoutMs = o.timeoutMs;
}

export interface FetchResult {
  ok: boolean; status: number; text: string; buffer?: Buffer; url: string; contentType: string; error?: string; blocked?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function politeFetch(url: string, o: {
  sourceId: string; accept?: string; timeoutMs?: number; retries?: number; maxBytes?: number; binary?: boolean;
  method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string>; delayMs?: number;
}): Promise<FetchResult> {
  const until = blockedUntil.get(o.sourceId) ?? 0;
  if (Date.now() < until) {
    return { ok: false, status: 0, text: '', url, contentType: '', blocked: true, error: `Circuit open for ${o.sourceId} until ${new Date(until).toISOString()}` };
  }
  const retries = o.retries ?? 2;
  let attempt = 0;
  let lastErr = '';
  while (attempt <= retries) {
    const spacing = o.delayMs ?? defaultDelayMs;
    const last = lastRequestAt.get(o.sourceId) ?? 0;
    const wait = last + spacing - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(o.sourceId, Date.now());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? defaultTimeoutMs);
    try {
      const res = await fetch(url, {
        method: o.method ?? 'GET',
        body: o.body,
        headers: { 'User-Agent': UA, Accept: o.accept ?? 'text/html,application/json;q=0.9,*/*;q=0.5', ...(o.headers ?? {}) },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const ct = res.headers.get('content-type') ?? '';
      if (res.status === 429 || res.status === 503) {
        const ra = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120000) : 1000 * 2 ** (attempt + 1);
        if (attempt === retries) {
          blockedUntil.set(o.sourceId, Date.now() + Math.max(backoff, 10 * 60_000));
          return { ok: false, status: res.status, text: '', url: res.url, contentType: ct, blocked: true, error: `Rate limited (HTTP ${res.status})` };
        }
        await sleep(backoff);
        attempt++;
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        // Denial: do not hammer. Open the circuit for this source for an hour.
        blockedUntil.set(o.sourceId, Date.now() + 60 * 60_000);
        return { ok: false, status: res.status, text: '', url: res.url, contentType: ct, blocked: true, error: `Access denied (HTTP ${res.status})` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (o.maxBytes && buf.length > o.maxBytes) return { ok: false, status: res.status, text: '', url: res.url, contentType: ct, error: 'Response too large' };
      return { ok: res.ok, status: res.status, text: o.binary ? '' : buf.toString('utf8'), buffer: o.binary ? buf : undefined, url: res.url, contentType: ct };
    } catch (e) {
      lastErr = (e as Error).name === 'AbortError' ? 'Timed out' : (e as Error).message;
      if (attempt === retries) break;
      await sleep(800 * 2 ** attempt);
      attempt++;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, text: '', url, contentType: '', error: lastErr || 'Network error' };
}

export function resetCircuit(sourceId: string) { blockedUntil.delete(sourceId); }

// ---------------------------------------------------------------------------
// robots.txt (only applied to HTML page fetches; documented JSON APIs are used per their docs)
// ---------------------------------------------------------------------------
interface RobotsRules { allow: string[]; disallow: string[]; }

function parseRobots(txt: string): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
  let cur: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const lineRaw of txt.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'allow' && val) cur.allow.push(val);
      if (key === 'disallow' && val) cur.disallow.push(val);
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && UA.toLowerCase().includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const g = mine ?? star;
  return { allow: g?.allow ?? [], disallow: g?.disallow ?? [] };
}

function ruleMatches(rule: string, p: string): number {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(p) ? body.length : -1;
}

export async function robotsAllows(url: string): Promise<{ allowed: boolean; reason: string }> {
  let u: URL;
  try { u = new URL(url); } catch { return { allowed: false, reason: 'Invalid URL' }; }
  const key = u.origin;
  let entry = robotsCache.get(key);
  if (!entry || Date.now() - entry.at > 6 * 3600_000) {
    const r = await politeFetch(`${u.origin}/robots.txt`, { sourceId: `robots:${u.host}`, accept: 'text/plain', retries: 0, timeoutMs: 10000 });
    if (r.status >= 500 || r.status === 0) entry = { at: Date.now(), rules: { allow: [], disallow: ['/'] } }; // unreachable -> be conservative
    else if (!r.ok) entry = { at: Date.now(), rules: null }; // 4xx -> no robots restrictions
    else entry = { at: Date.now(), rules: parseRobots(r.text) };
    robotsCache.set(key, entry);
  }
  if (!entry.rules) return { allowed: true, reason: 'No robots.txt restrictions' };
  const p = u.pathname + u.search;
  let best = -1; let allowed = true;
  for (const d of entry.rules.disallow) { const l = ruleMatches(d, p); if (l > best) { best = l; allowed = false; } }
  for (const a of entry.rules.allow) { const l = ruleMatches(a, p); if (l >= best && l >= 0) { best = l; allowed = true; } }
  return { allowed, reason: allowed ? 'Allowed by robots.txt' : `Disallowed by ${u.origin}/robots.txt` };
}
