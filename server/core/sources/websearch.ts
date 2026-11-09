// Web-search providers (pay-as-you-go, no monthly cap):
//   DataForSEO  https://dataforseo.com      real Google results, ~$2 per 1,000 live searches ($50 min. deposit, no expiry)
//                                           POST api.dataforseo.com/v3/serp/google/organic/live/advanced (Basic auth: login + password)
//   Jina        https://jina.ai             search (s.jina.ai, ~$0.50 per 1,000) and page reader (r.jina.ai, renders JavaScript,
//                                           ~$0.25-0.50 per 1,000 pages); $50 = 1 billion tokens, no expiry
//   Exa         https://exa.ai              optional backup
//   SearXNG     https://docs.searxng.org    optional: free & open-source, your own instance
// Plus Google Jobs via SerpApi (optional): postings with full descriptions.
// Search results are only links: ATS links are read through official APIs, board links are opened with the Jina reader.
import { getSecret, hasSecret, type SecretName } from '../../config/secrets.js';
import { getProfile, getSettings } from '../../config/settings.js';
import { matchTargetRole, type RoleFamily } from '../discovery/roles.js';
import { ABOVE_ENTRY_TITLE, marketOfLocation, matchGulfRole, NON_GULF_PLACE } from '../gulf/markets.js';
import { daysBetween, todayLondon } from '../util/text.js';
import { politeFetch } from './http.js';
import type { DiscoveredJob, DiscoveryContext, DiscoveryPage, JobSourceAdapter } from './types.js';
import type { SearchIntent } from '../models.js';
import { buildBooleanQueries, buildRoleQueries } from '../discovery/intent.js';
import { htmlToText, isSafeHttpUrl, parsePostedDate } from '../util/text.js';
import { boardForUrl } from './boards.js';
import { parseAtsUrl } from './ats.js';
import { parseResultTitle } from './apis.js';
import { MARKETS, GULF_QUERIES } from '../gulf/markets.js';
import { canonicalBoardUrl, isEmployerSite, looksLikeListingPage, looksLikeSinglePosting, TEASER_BOARDS } from '../extraction/posting.js';
import { getDb } from '../../db/db.js';
import { safeParse } from '../discovery/events.js';

/** Gulf query order: anything you typed first, then broad → entry-level phrasings. */
const GULF_QUERY_ORDER = (intent: SearchIntent) => [...new Set([...(intent.roleQueries ?? []).filter((q) => !GULF_QUERIES.includes(q)).slice(0, 2), ...GULF_QUERIES])];

export type SearchProvider = 'dataforseo' | 'jina' | 'exa' | 'searxng';
export const SEARCH_PROVIDERS: Array<{ id: SearchProvider; name: string; secrets?: SecretName[]; free: string; signup: string }> = [
  { id: 'dataforseo', name: 'DataForSEO (Google results)', secrets: ['dataforseo_login', 'dataforseo_password'], free: '~$2 per 1,000 searches, pay-as-you-go, no cap', signup: 'https://app.dataforseo.com/register' },
  { id: 'jina', name: 'Jina search', secrets: ['jina_api_key'], free: '~$0.50 per 1,000 searches, pay-as-you-go, no cap', signup: 'https://jina.ai/api-dashboard' },
  { id: 'searxng', name: 'SearXNG (self-hosted, no key)', free: 'Free & unlimited on your own instance', signup: 'https://docs.searxng.org/admin/installation.html' },
  { id: 'exa', name: 'Exa', secrets: ['exa_api_key'], free: 'Free monthly credit', signup: 'https://dashboard.exa.ai/api-keys' },
];

interface Hit { url: string; title: string; snippet: string; date?: string | null }
export interface SearchOpts { country?: 'uk' | 'ae' | 'qa' | 'sa'; page?: number }
const COUNTRY_NAME: Record<string, string> = { uk: 'united kingdom', ae: 'united arab emirates', qa: 'qatar', sa: 'saudi arabia' };
const DFS_LOCATION: Record<string, string> = { uk: 'United Kingdom', ae: 'United Arab Emirates', qa: 'Qatar', sa: 'Saudi Arabia' };
const GOOGLE_GL: Record<string, string> = { uk: 'gb', ae: 'ae', qa: 'qa', sa: 'sa' };
/** "3 days ago — …" / "Oct 12, 2026 — …" at the start of a Google snippet. */
const snippetDate = (s: string) => s.match(/^\s*((?:\d+\s+(?:minute|hour|day|week|month)s?\s+ago)|(?:[A-Z][a-z]{2}\s+\d{1,2},\s+20\d\d))\s*[—·-]/)?.[1] ?? null;

async function runProvider(p: SearchProvider, q: string, includeDomains: string[], opts: SearchOpts = {}): Promise<{ ok: boolean; hits: Hit[]; error?: string }> {
  const s = getSettings();
  const gl = opts.country ?? 'uk';
  const recent = s.max_posting_age_days <= 7 ? 'week' : 'month';
  const siteless = q.replace(/\bsite:\S+\s*/g, '').trim();
  // Google-style providers take the site filter inside the query text (paths work too, e.g. site:bayt.com/en/uae/jobs).
  const withSites = includeDomains.length && !/\bsite:/.test(q)
    ? `${includeDomains.length === 1 ? `site:${includeDomains[0]}` : `(${includeDomains.slice(0, 3).map((d) => `site:${d}`).join(' OR ')})`} ${q}`
    : q;
  const page = Math.max(1, opts.page ?? 1);
  try {
    if (p === 'dataforseo') {
      const login = await getSecret('dataforseo_login');
      const password = await getSecret('dataforseo_password');
      const auth = Buffer.from(`${login}:${password}`).toString('base64');
      // depth = results wanted; page N asks for N×10 and keeps the last 10. "&tbs=qdr:m" = Google's "past month" filter.
      const body = [{ keyword: withSites.slice(0, 700), location_name: DFS_LOCATION[gl], language_code: 'en', device: 'desktop', depth: 10 * page,
        search_param: `&tbs=qdr:${recent === 'week' ? 'w' : 'm'}` }];
      const r = await politeFetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', { sourceId: 'search_dataforseo', method: 'POST', accept: 'application/json', retries: 1, delayMs: 0, timeoutMs: 60000,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` }, body: JSON.stringify(body) });
      if (!r.ok) return { ok: false, hits: [], error: r.status === 401 ? 'HTTP 401 (DataForSEO login/password not accepted)' : r.error ?? `HTTP ${r.status}` };
      const b = JSON.parse(r.text);
      const task = b.tasks?.[0];
      const code = Number(task?.status_code ?? b.status_code);
      if (code !== 20000) {
        // 402xx = balance used up → "credit" makes the scan switch provider and tell you; 401xx = bad login.
        const credit = code >= 40200 && code < 40300 ? ' (no credit left — top up your DataForSEO balance)' : '';
        const authErr = code >= 40100 && code < 40200 ? ' (HTTP 401: login/password not accepted)' : '';
        return { ok: false, hits: [], error: `DataForSEO ${code}: ${task?.status_message ?? b.status_message ?? 'error'}${credit}${authErr}` };
      }
      const items: any[] = (task.result?.[0]?.items ?? []).filter((x: any) => x.type === 'organic');
      const mine = page > 1 ? items.filter((x) => Number(x.rank_absolute ?? x.rank_group ?? 0) > (page - 1) * 10) : items;
      return { ok: true, hits: mine.map((x) => ({ url: x.url, title: x.title ?? '', snippet: x.description ?? '', date: x.timestamp ?? snippetDate(x.description ?? '') })) };
    }
    if (p === 'jina') {
      const key = await getSecret('jina_api_key');
      const params = new URLSearchParams({ q: withSites.slice(0, 500), gl: GOOGLE_GL[gl], hl: 'en', num: '10', ...(page > 1 ? { page: String(page) } : {}) });
      const r = await politeFetch(`https://s.jina.ai/?${params}`, { sourceId: 'search_jina', accept: 'application/json', retries: 1, delayMs: 0, timeoutMs: 45000,
        headers: { Authorization: `Bearer ${key}`, 'X-Respond-With': 'no-content', 'X-Retain-Images': 'none' } });
      if (!r.ok) {
        let msg = ''; try { const e = JSON.parse(r.text); msg = e.readableMessage ?? e.message ?? ''; } catch { /* not JSON */ }
        const credit = r.status === 402 || /balance|insufficient|quota/i.test(msg) ? ' (no credit left — top up your Jina balance)' : '';
        return { ok: false, hits: [], error: `${r.error ?? `HTTP ${r.status}`}${msg ? ` (${String(msg).slice(0, 120)})` : ''}${credit}` };
      }
      const b = JSON.parse(r.text);
      return { ok: true, hits: (b.data ?? []).map((x: any) => ({ url: x.url, title: x.title ?? '', snippet: x.description ?? x.content?.slice?.(0, 400) ?? '', date: x.date ?? x.publishedTime ?? snippetDate(x.description ?? '') })) };
    }
    if (p === 'exa') {
      const key = await getSecret('exa_api_key');
      const r = await politeFetch('https://api.exa.ai/search', { sourceId: 'search_exa', method: 'POST', accept: 'application/json', delayMs: 0, headers: { 'Content-Type': 'application/json', 'x-api-key': key! },
        body: JSON.stringify({ query: siteless, numResults: 20, type: 'fast', includeDomains: includeDomains.length ? includeDomains.map((d) => d.split('/')[0]) : undefined, contents: { text: { maxCharacters: 600 } } }) });
      if (!r.ok) return { ok: false, hits: [], error: r.error ?? `HTTP ${r.status}` };
      return { ok: true, hits: (JSON.parse(r.text).results ?? []).map((x: any) => ({ url: x.url, title: x.title ?? '', snippet: x.text ?? '', date: x.publishedDate ?? null })) };
    }
    if (p === 'searxng') {
      const base = s.searxng_url.replace(/\/+$/, '');
      if (!isSafeHttpUrl(base)) return { ok: false, hits: [], error: 'No SearXNG URL set' };
      const r = await politeFetch(`${base}/search?q=${encodeURIComponent(withSites)}&format=json&language=en&time_range=${recent}${page > 1 ? `&pageno=${page}` : ''}`, { sourceId: 'search_searxng', accept: 'application/json', delayMs: 1000 });
      if (!r.ok) return { ok: false, hits: [], error: r.error ?? `HTTP ${r.status} (is format=json enabled on the instance?)` };
      return { ok: true, hits: (JSON.parse(r.text).results ?? []).map((x: any) => ({ url: x.url, title: x.title ?? '', snippet: x.content ?? '', date: x.publishedDate ?? null })) };
    }
  } catch (e) { return { ok: false, hits: [], error: (e as Error).message }; }
  return { ok: false, hits: [], error: 'Unknown provider' };
}

/** Exposed for tests. */
export const runSearchProvider = runProvider;

export function providerConfigured(p: SearchProvider): boolean {
  if (p === 'searxng') return isSafeHttpUrl(getSettings().searxng_url);
  const def = SEARCH_PROVIDERS.find((x) => x.id === p);
  return !!def?.secrets?.length && def.secrets.every((k) => hasSecret(k));
}
export function activeProviders(): SearchProvider[] {
  const s = getSettings();
  return (s.search_providers as SearchProvider[]).filter((p) => providerConfigured(p));
}

/**
 * Learn from past scans: each site's share of links that turned out to be live, readable postings.
 * Sites that keep giving closed/unreadable links are tried last; sites with no history keep their place.
 */
export function rankBoardsByYield(boards: string[]): string[] {
  let rows: Array<{ url: string; state: string }> = [];
  try {
    rows = getDb().all(`SELECT c.url, c.state FROM search_run_candidates c JOIN search_runs r ON r.id = c.run_id
      WHERE r.started_at >= ? AND c.url IS NOT NULL ORDER BY c.id DESC LIMIT 5000`, new Date(Date.now() - 45 * 86400000).toISOString());
  } catch { return boards; }
  const stats = new Map<string, { good: number; total: number }>();
  for (const b of boards) stats.set(b, { good: 0, total: 0 });
  for (const r of rows) {
    let host = ''; let path = '';
    try { const u = new URL(r.url); host = u.hostname.replace(/^www\./, ''); path = u.pathname; } catch { continue; }
    const b = boards.find((x) => { const [h, ...p] = x.split('/'); return (host === h || host.endsWith(`.${h}`)) && (!p.length || path.startsWith(`/${p.join('/')}`)); });
    if (!b) continue;
    const st = stats.get(b)!;
    st.total++;
    // "Good" = reached grading as a live, readable, in-scope posting (whatever the final decision).
    if (/^(VERIFIED_COMPATIBLE|POTENTIAL_NO_STATED_BLOCKER|NEEDS_REVIEW|EXCLUDED)$/.test(r.state)) st.good++;
  }
  // Search history from the scan console: results and usable postings per search, per site.
  const searches = new Map<string, { n: number; results: number; kept: number }>();
  try {
    for (const e of getDb().all<{ d: string }>(`SELECT data_json d FROM scan_events WHERE stage = 'SEARCH' AND at >= ? AND data_json IS NOT NULL ORDER BY id DESC LIMIT 6000`,
      new Date(Date.now() - 45 * 86400000).toISOString())) {
      const d = safeParse(e.d); if (!d?.site || d.ok === false) continue;
      const x = searches.get(d.site) ?? { n: 0, results: 0, kept: 0 };
      x.n++; x.results += Number(d.results ?? 0); x.kept += Number(d.kept ?? 0); searches.set(d.site, x);
    }
  } catch { /* no history yet */ }
  const score = (b: string) => {
    const s = stats.get(b)!;
    const h = searches.get(b);
    // Sites that searched often and never returned a usable posting go last.
    if (h && h.n >= 6 && h.kept === 0) return 0.01;
    const graded = s.total >= 8 ? (s.good + 1) / (s.total + 2) : null;
    const keptRate = h && h.n >= 3 ? Math.min(1, h.kept / h.n / 5) : null; // ~5 usable postings per search = top score
    if (graded != null && keptRate != null) return 0.6 * graded + 0.4 * keptRate;
    return graded ?? keptRate ?? 0.5;
  };
  return boards.map((b, i) => ({ b, i, s: score(b) })).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.b);
}

/** Queries: board-targeted ("site:") searches + ATS-domain searches for your enabled roles. */
/**
 * Short, targeted queries — roughly what you would type into Google yourself:
 *   site:<board where single postings live> "<role>" <city>
 * Interleaved (role × board × city) so a limited budget still covers every board and role.
 */
export function siteQueries(intent: SearchIntent): Array<{ q: string; domains: string[]; relax?: string }> {
  /**
   * Every role-group × site × place combination, ordered in rounds: each round sends one search to every site
   * (best-yielding sites first) with a different role group, so a small budget stays varied and a large one covers it all.
   * A role group is several related titles joined with OR — one search finds what used to take three.
   */
  // A broad fallback per site+place: used when the strict (spec) search returns nothing — level is judged after reading.
  const BROAD = '("cyber security" OR cybersecurity OR "information security" OR SOC OR "security analyst" OR GRC)';
  const plan = (groups: string[], boards: Array<{ site: string; places: string[] }>, extra = '') => {
    const out: Array<{ q: string; domains: string[]; relax?: string }> = [];
    const maxPlaces = Math.max(...boards.map((b) => b.places.length));
    for (let r = 0; r < groups.length * maxPlaces; r++) {
      boards.forEach((b, bi) => {
        const place = b.places[Math.floor(r / groups.length) % b.places.length];
        const g = groups[(r + bi) % groups.length];
        out.push({ q: `${/ OR /.test(g) ? `(${g})` : g}${extra}${place ? ` ${place}` : ''}`.trim(), domains: [b.site], relax: `${BROAD}${place ? ` ${place}` : ''}` });
      });
    }
    const seen = new Set<string>();
    return out.filter((x) => { const k = x.q + x.domains[0]; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  // Spec §1/§3: role phrases grouped three per search, and every search carries entry-level terms.
  const SPEC_ROLES = ['SOC analyst', 'SOC analyst tier 1', 'security operations analyst', 'security analyst', 'cyber security graduate', 'cyber security intern',
    'information security analyst', 'IT security analyst', 'GRC analyst', 'IT audit assistant', 'cyber security trainee', 'security monitoring analyst',
    'junior penetration tester', 'vulnerability analyst', 'SIEM analyst'];
  const groupsOf = (roles: string[]) => { const g: string[] = []; for (let i = 0; i < roles.length; i += 3) g.push(roles.slice(i, i + 3).map((r) => `"${r}"`).join(' OR ')); return g; };
  if (intent.market) {
    const cc = intent.market === 'UAE' ? 'ae' : intent.market === 'QATAR' ? 'qa' : 'sa';
    const slug = intent.market === 'UAE' ? 'uae' : intent.market === 'QATAR' ? 'qatar' : 'saudi-arabia';
    const country = intent.market === 'UAE' ? 'UAE' : intent.market === 'QATAR' ? 'Qatar' : 'Saudi Arabia';
    const cities = intent.market === 'UAE' ? ['Dubai', 'Abu Dhabi', 'Sharjah'] : intent.market === 'QATAR' ? ['Doha'] : ['Riyadh', 'Jeddah', 'Dammam'];
    const extraRoles = (intent.roleQueries ?? []).filter((r) => !SPEC_ROLES.some((x) => x.toLowerCase() === r.toLowerCase())).slice(0, 6);
    const groups = groupsOf([...SPEC_ROLES, ...extraRoles]);
    const level = ' (junior OR graduate OR intern OR trainee OR "entry level" OR "fresh graduate")';
    // Country-scoped board sections need no city (they only list that country); local boards get the country; global sites a city.
    const scoped = [`bayt.com/en/${slug}/jobs`, `gulftalent.com/${slug}/jobs`, `${cc}.indeed.com`].map((site) => ({ site, places: [''] }));
    const local = ['naukrigulf.com', 'founditgulf.com', 'laimoon.com', 'gulfnews.com',
      ...(intent.market === 'QATAR' ? ['qatarliving.com/jobs'] : []), ...(intent.market === 'SAUDI' ? ['jadarat.sa'] : [])]
      .map((site) => ({ site, places: [country] }));
    const global = ['linkedin.com/jobs/view', 'jobs.lever.co', 'job-boards.greenhouse.io', 'boards.greenhouse.io', 'apply.workable.com', 'jobs.workable.com',
      'jobs.smartrecruiters.com', 'myworkdayjobs.com', 'successfactors.com', 'oraclecloud.com', 'teamtailor.com', 'jobs.ashbyhq.com', 'zohorecruit.com', 'glassdoor.com']
      .map((site) => ({ site, places: [...cities, country] }));
    const all = [...scoped, ...local, ...global];
    const order = rankBoardsByYield(all.map((b) => b.site));
    // Spec template 3: open-web searches with experience wording (any site; aggregator copies are handled downstream).
    const openWeb = groupsOf(SPEC_ROLES).flatMap((g) => cities.slice(0, 2).map((c) => ({ q: `(${g}) ${c} ("0-2 years" OR "fresh graduate" OR "no experience")`, domains: [] as string[] })));
    return interleaveLists(plan(groups, order.map((s) => all.find((b) => b.site === s)!), level), openWeb, 8);
  }
  // UK (spec §3): your enabled role phrasings, three per search, with entry-level terms; plus sponsorship-worded searches.
  const roles = (intent.roleQueries?.length ? intent.roleQueries : SPEC_ROLES).slice(0, 18);
  const groups = groupsOf(roles);
  const lvl = intent.roleFocus === 'INTERNSHIP' ? ' (internship OR placement OR intern)' : intent.roleFocus === 'GRADUATE' ? ' (graduate OR junior OR "entry level")' : ' (graduate OR intern OR "entry level" OR junior)';
  const place = intent.location === 'LONDON' || intent.location == null ? 'London' : 'UK';
  // Spec §1 UK cities when searching UK-wide; London only when you chose London.
  const ukPlaces = place === 'London' ? ['London'] : ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Leeds', 'Bristol', '"remote" UK'];
  const ukOnly = ['uk.indeed.com', 'gradcracker.com', 'brightnetwork.co.uk', 'prospects.ac.uk', 'milkround.com', 'targetjobs.co.uk', 'glassdoor.co.uk', 'totaljobs.com', 'cwjobs.co.uk', 'reed.co.uk']
    .map((site) => ({ site, places: ukPlaces }));
  const global = ['linkedin.com/jobs/view', 'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com', 'apply.workable.com', 'welcometothejungle.com',
    'myworkdayjobs.com', 'jobs.smartrecruiters.com', 'teamtailor.com', 'successfactors.com']
    .map((site) => ({ site, places: ukPlaces.map((p) => (p === 'London' ? 'London UK' : p)) }));
  const all = [...global, ...ukOnly];
  const order = rankBoardsByYield(all.map((b) => b.site));
  const sited = plan(groups, order.map((s) => all.find((b) => b.site === s)!), lvl);
  const sponsorWorded = ['linkedin.com/jobs/view', 'uk.indeed.com', 'reed.co.uk', 'totaljobs.com']
    .flatMap((site) => groups.slice(0, 3).map((g) => ({ q: `(${g}) ${place} ("visa sponsorship" OR "Graduate visa" OR sponsorship)`, domains: [site] })));
  const noClearance = groups.slice(0, 3).map((g) => ({ q: `(${g}) "no security clearance" ${place} UK`, domains: [] as string[] }));
  return [...interleaveLists(sited, [...sponsorWorded, ...noClearance], 6), ...buildBooleanQueries(intent).slice(0, 1).map((q) => ({ q, domains: [] }))];
}

/** Insert one item of `extra` after every `every` items of `main` (keeps both kinds of search in a small budget). */
function interleaveLists<T>(main: T[], extra: T[], every: number): T[] {
  const out: T[] = []; let e = 0;
  main.forEach((m, i) => { out.push(m); if ((i + 1) % every === 0 && e < extra.length) out.push(extra[e++]); });
  return [...out, ...extra.slice(e)];
}

// LinkedIn job ids rise steadily (~15M a month in 2026), so an id far below the newest one seen is an old posting —
// Google keeps returning those long after they close. Skipping them saves a page read / AI read each.
let liMaxId = 0;
const linkedInId = (u: string) => Number(u.match(/linkedin\.com\/jobs\/view\/(?:[^/]*?-)?(\d{8,})/)?.[1] ?? 0);
function noteLinkedInIds(urls: string[]) {
  if (!liMaxId) {
    try {
      for (const r of getDb().all<{ u: string }>("SELECT board_url AS u FROM source_jobs WHERE board_url LIKE '%linkedin.com/jobs/view/%' ORDER BY id DESC LIMIT 500")) liMaxId = Math.max(liMaxId, linkedInId(r.u));
    } catch { /* no DB in tests */ }
  }
  for (const u of urls) liMaxId = Math.max(liMaxId, linkedInId(u));
}
export function staleLinkedInId(url: string, maxId = liMaxId, windowDays = getSettings().max_posting_age_days): boolean {
  const id = linkedInId(url);
  if (!id || !maxId) return false;
  return id < maxId - 500_000 * (windowDays + 30); // ~0.5M ids/day, with a month's margin: only clearly old postings are skipped
}

export const siteSearchAdapter: JobSourceAdapter = {
  id: 'web_search', displayName: 'Web search (DataForSEO / Jina / SearXNG / Exa)', sourceHomepage: 'https://dataforseo.com/',
  mode: 'SEARCH_INDEX_DISCOVERY', kind: 'SEARCH',
  description: 'Free search APIs used to find postings on LinkedIn, Indeed, Glassdoor, Gradcracker, Totaljobs… and on employer ATS pages. Uses every provider you configured, in order, and falls back when one runs out of free credits.',
  async verifyAccess() {
    const act = activeProviders();
    if (!act.length) return { status: 'NOT_CONFIGURED', message: 'Add a DataForSEO login + password or a Jina key (or a SearXNG URL) in Settings → API keys.' };
    const r = await runProvider(act[0], 'cyber security graduate jobs London', []);
    return r.ok ? { status: 'CONNECTED', message: `Using ${act.join(' → ')}.` } : { status: /401|403|invalid/i.test(r.error ?? '') ? 'AUTH_REQUIRED' : 'ERROR', message: `${act[0]}: ${r.error}` };
  },
  async discover(intent: SearchIntent, ctx: DiscoveryContext): Promise<DiscoveryPage> {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const providers = activeProviders();
    if (!providers.length) return out;
    const dead = new Set<SearchProvider>();
    const seen = new Set<string>();
    const s = getSettings();
    const budget = intent.market ? s.gulf_web_queries_per_run : s.web_queries_per_run;
    const country = intent.market === 'UAE' ? 'ae' : intent.market === 'QATAR' ? 'qa' : intent.market === 'SAUDI' ? 'sa' : 'uk';
    const families = getProfile().profile.target_roles;
    let used = 0; let consecutiveFails = 0; let staleSkipped = 0;
    const done = new Set<string>();

    /**
     * Run ONE search and score it: results, single postings kept, postings whose title is one of your target roles at
     * entry level ("relevant"), and postings dated inside your window ("fresh"). Kept postings go to the pipeline.
     */
    const exec = async (q: string, domains: string[], page?: number): Promise<SearchStat | null> => {
      if (ctx.shouldStop() || used >= budget) return null;
      const key = `${domains[0] ?? ''}|${q.toLowerCase()}|${page ?? 1}`;
      if (done.has(key)) return null;
      done.add(key);
      const p = providers.find((x) => !dead.has(x));
      if (!p) { ctx.log('ERROR', 'Every search provider is out of credits or rejected the key — stopping web search.'); return null; }
      used++;
      const siteKey = domains[0] ?? 'any site';
      const label = `${domains.length ? `site:${domains[0]} ` : ''}${q}${page ? ` (page ${page})` : ''}`;
      out.queries.push(`${p}: ${label}`);
      const r = await runProvider(p, q, domains, { country: country as SearchOpts['country'], page });
      if (!r.ok) {
        out.errors.push(`${p}: ${r.error} — "${q}"`);
        ctx.log('SEARCH', `✗ ${p}: ${label} → ${r.error}`, { provider: p, site: siteKey, q, page: page ?? 1, ok: false, results: 0, kept: 0, relevant: 0, error: r.error });
        // Out of credits / bad key → switch to the next provider. A single bad query (HTTP 400) just skips that query.
        if (/\b(401|402|403|429)\b|quota|credit|limit/i.test(r.error ?? '')) {
          dead.add(p); ctx.log('ERROR', `${p} stopped: ${r.error}`);
          // Tell the user on the Dashboard — searches can't run until credits are topped up or another provider is added.
          if (/credit|quota/i.test(r.error ?? '')) {
            try {
              getDb().run('INSERT INTO alerts(at, kind, job_id, message) VALUES (?, ?, NULL, ?)', new Date().toISOString(), 'SEARCH_CREDITS',
                `${p === 'dataforseo' ? 'DataForSEO' : p === 'jina' ? 'Jina' : p} is out of credit — web searches stopped. Top up at ${p === 'dataforseo' ? 'app.dataforseo.com' : p === 'jina' ? 'jina.ai/api-dashboard' : 'the provider'}; if you have the other provider's key the app switches to it automatically.`);
            } catch { /* alerts are best-effort */ }
          }
        }
        if (++consecutiveFails >= 5) { dead.add(p); ctx.log('ERROR', `${p} failed 5 times in a row — switching provider.`); }
        return { q, site: siteKey, page: page ?? 1, ok: false, results: 0, kept: 0, relevant: 0, fresh: 0, titles: [], dropped: {} };
      }
      consecutiveFails = 0;
      out.linksFound += r.hits.length;
      noteLinkedInIds(r.hits.map((x) => x.url));
      // Why each result was kept or dropped (shown in the console and given to the AI planner).
      const why: Record<string, number> = {};
      const drop = (k: string) => { why[k] = (why[k] ?? 0) + 1; };
      const titles: string[] = [];
      let kept = 0; let relevant = 0; let fresh = 0;
      for (const h0 of r.hits) {
        if (!isSafeHttpUrl(h0.url)) { drop('bad link'); continue; }
        const board = boardForUrl(h0.url);
        // Board links must be a real single posting (Indeed ?jk=…, LinkedIn /jobs/view/<id>…) — tracking/search/company links are dropped.
        const canon = board ? canonicalBoardUrl(h0.url) : h0.url;
        if (!canon) { drop('not a single posting'); continue; }
        if (seen.has(canon)) { drop('duplicate'); continue; }
        seen.add(canon);
        const h = { ...h0, url: canon };
        const ats = parseAtsUrl(h.url);
        const parsed = parseResultTitle(htmlToText(h.title), board);
        const single = !ats && !board && looksLikeSinglePosting(h.url);
        // A single posting on an unknown site is the employer's only if the domain is theirs; otherwise it's a copy on an aggregator.
        const employerPosting = single && isEmployerSite(h.url, parsed.employer);
        const aggregator = single && !employerPosting ? 'web_board' : null;
        if (!ats?.jobId && !board && !single) { drop('not a job page'); continue; }
        if ((board || aggregator) && looksLikeListingPage(h.url, h.title)) { drop('job-list page'); continue; }
        if (board === 'linkedin' && staleLinkedInId(h.url)) { staleSkipped++; drop('old LinkedIn id'); continue; }
        kept++;
        const t = parsed.title || h.title;
        // Gulf: on-target also means in the right country (careers sites return jobs worldwide).
        const locText = `${parsed.location ?? ''} ${t} ${htmlToText(h.snippet ?? '').slice(0, 300)}`;
        const where = intent.market ? marketOfLocation(locText) : null;
        const wrongPlace = !!intent.market && ((where != null && where !== intent.market) || (where == null && NON_GULF_PLACE.test(locText)));
        if (!wrongPlace && isRelevantTitle(t, parsed.employer, families, !!intent.market)) relevant++;
        const posted = parsePostedDate(h.date);
        if (posted && daysBetween(posted, todayLondon()) <= s.max_posting_age_days) fresh++;
        if (titles.length < 5) titles.push(t);
        const src = board ?? aggregator;
        out.jobs.push({
          sourceId: src ?? 'web_search', sourceJobId: ats?.jobId ? `${ats.token}:${ats.jobId}` : h.url, title: parsed.title || 'Untitled result',
          employer: parsed.employer, location: parsed.location, boardUrl: src ? h.url : null, employerUrl: ats || employerPosting ? h.url : null, applyUrl: h.url, applyUrlKind: ats ? 'EMPLOYER_ATS' : employerPosting ? 'EMPLOYER_SITE' : 'BOARD',
          postedAt: posted, deadline: null, salaryText: null, descriptionText: htmlToText(h.snippet), descriptionComplete: false,
          extractionMethod: `search_${p}`, accessMode: 'SEARCH_INDEX_DISCOVERY', query: q,
        });
      }
      const whyText = Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ');
      ctx.log('SEARCH', `${p}: ${label} → ${r.hits.length} results, ${kept} postings, ${relevant} on-target${fresh ? `, ${fresh} dated in window` : ''}${whyText ? ` (dropped: ${whyText})` : ''}${titles.length ? ` — e.g. ${titles.slice(0, 3).join(' | ')}` : ''}`,
        { provider: p, site: siteKey, q, page: page ?? 1, ok: true, results: r.hits.length, kept, relevant, fresh, dropped: why, market: intent.market ?? 'UK' });
      return { q, site: siteKey, page: page ?? 1, ok: true, results: r.hits.length, kept, relevant, fresh, titles, dropped: why };
    };

    const finish = () => {
      if (staleSkipped) out.queries.push(`skipped ${staleSkipped} LinkedIn postings too old by their id (Google still lists closed ones)`);
      ctx.log('SUMMARY', `Web search done: ${used} searches, ${out.linksFound} results, ${out.jobs.length} single postings kept.`, { searches: used, results: out.linksFound, kept: out.jobs.length });
      return out;
    };

    // ---- AI-steered search (OpenAI plans, the search provider searches, results scored and fed back) ----
    if (s.ai_search_planner && s.ai_enabled && hasSecret('openai_api_key')) {
      const { runAiPlannedSearch } = await import('../ai/searchPlanner.js');
      const r = await runAiPlannedSearch({ intent, ctx, budget, exec, usedSoFar: () => used, fallback: () => siteQueries(intent), sites: plannerSites(intent) });
      if (r.ok) return finish();
      ctx.log('ERROR', `AI search planner unavailable (${r.error}) — using the standard search plan.`);
    }

    // ---- Standard plan (fixed templates, learning per site) ----
    const queue: Array<{ q: string; domains: string[]; page?: number; relax?: string }> = siteQueries(intent);
    const siteStats = new Map<string, { searches: number; kept: number; results: number }>();
    const relaxed = new Set<string>();
    const skippedSites = new Set<string>();
    const sitesInPlan = [...new Set(queue.map((x) => x.domains[0] ?? 'any site'))];
    ctx.log('PLAN', `Web search plan: ${queue.length} searches available across ${sitesInPlan.length} sites; budget ${budget} this scan (${providers.join(' → ')}).`,
      { searches: queue.length, budget, sites: sitesInPlan, providers });
    for (let qi = 0; qi < queue.length; qi++) {
      const { q, domains, page, relax } = queue[qi];
      if (ctx.shouldStop() || used >= budget) break;
      const siteKey = domains[0] ?? 'any site';
      if (skippedSites.has(siteKey) && !page) continue;
      const res = await exec(q, domains, page);
      if (!res) { if (!providers.some((x) => !dead.has(x))) break; continue; }
      const st = siteStats.get(siteKey) ?? { searches: 0, kept: 0, results: 0 };
      st.searches++; st.results += res.results; st.kept += res.kept; siteStats.set(siteKey, st);
      if (!res.ok) continue;
      // Spec §3: up to 3 pages, only while the previous page returned a full page with usable postings.
      if ((page ?? 1) < 3 && res.results >= 10 && res.kept >= 1) queue.splice(qi + 1, 0, { q, domains, page: (page ?? 1) + 1 });
      // Strict search found nothing → try the broad version for this site + place once (entry level is checked after reading).
      if (!page && res.results === 0 && relax && !relaxed.has(`${siteKey}|${relax}`)) {
        relaxed.add(`${siteKey}|${relax}`);
        queue.splice(qi + 1, 0, { q: relax, domains });
        ctx.log('PLAN', `No results for the strict search on ${siteKey} — trying a broader search next.`, { site: siteKey });
      }
      // Learning: a site giving nothing usable moves to the back of the queue; dropped only after 20+ empty searches.
      if (!page && st.kept === 0 && (st.searches === 4 || (st.searches === 3 && st.results === 0))) {
        const rest = queue.splice(qi + 1).filter(Boolean);
        const mine = rest.filter((x) => (x.domains[0] ?? 'any site') === siteKey);
        queue.push(...rest.filter((x) => (x.domains[0] ?? 'any site') !== siteKey), ...mine);
        ctx.log('SKIP', `Moving ${siteKey} to the back of the queue: ${st.searches} searches, ${st.results} results, 0 usable postings so far.`, { site: siteKey });
      }
      if (!page && st.searches >= 20 && st.kept === 0 && !skippedSites.has(siteKey)) {
        skippedSites.add(siteKey);
        ctx.log('SKIP', `Dropping ${siteKey} for this scan: ${st.searches} searches, 0 usable postings.`, { site: siteKey });
      }
    }
    return finish();
  },
};

export interface SearchStat { q: string; site: string; page: number; ok: boolean; results: number; kept: number; relevant: number; fresh: number; titles: string[]; dropped: Record<string, number> }

/** Title is one of your target roles (or clearly cyber/GRC) and not above entry level. */
function isRelevantTitle(title: string, employer: string | null, families: RoleFamily[], gulf: boolean): boolean {
  if (!title) return false;
  if (ABOVE_ENTRY_TITLE.test(title) && !/\b(junior|graduate|intern|trainee|entry)\b/i.test(title)) return false;
  const fam = (gulf ? null : matchTargetRole(title, families)) ?? matchGulfRole(title, families) ?? (employer && /\b(cyber|security)\b/i.test(employer) ? matchGulfRole(`${title} ${employer}`, families) : null);
  return !!fam;
}

/** Sites the AI planner may use, with what each is good for (country-specific sections for the Gulf). */
export function plannerSites(intent: SearchIntent): Array<{ site: string; note: string }> {
  if (intent.market) {
    const cc = intent.market === 'UAE' ? 'ae' : intent.market === 'QATAR' ? 'qa' : 'sa';
    const slug = intent.market === 'UAE' ? 'uae' : intent.market === 'QATAR' ? 'qatar' : 'saudi-arabia';
    return [
      { site: `bayt.com/en/${slug}/jobs`, note: 'largest Gulf board; country section (no city needed)' },
      { site: `gulftalent.com/${slug}/jobs`, note: 'Gulf board, country section; many professional roles' },
      { site: `${cc}.indeed.com`, note: 'Indeed for this country' },
      { site: 'naukrigulf.com', note: 'Gulf board; add the country/city' },
      { site: 'founditgulf.com', note: 'Gulf board (ex-Monster Gulf); recruiter-heavy' },
      { site: 'laimoon.com', note: 'Gulf board' },
      { site: 'linkedin.com/jobs/view', note: 'many postings but Google returns many closed ones; add city' },
      { site: 'myworkdayjobs.com', note: 'employer careers sites (banks, telcos, government-linked)' },
      { site: 'successfactors.com', note: 'employer careers sites (large regional employers)' },
      { site: 'oraclecloud.com', note: 'employer careers sites' },
      { site: 'jobs.lever.co', note: 'startup careers pages' }, { site: 'boards.greenhouse.io', note: 'startup/tech careers pages' },
      { site: 'job-boards.greenhouse.io', note: 'startup/tech careers pages' }, { site: 'apply.workable.com', note: 'SME careers pages' },
      { site: 'jobs.smartrecruiters.com', note: 'mid/large employer careers pages' },
      { site: '', note: 'no site filter: the open web (company careers pages, local boards)' },
      ...(intent.market === 'QATAR' ? [{ site: 'qatarliving.com/jobs', note: 'Qatar local board' }] : []),
      ...(intent.market === 'SAUDI' ? [{ site: 'jadarat.sa', note: 'Saudi government portal (many Saudi-only roles)' }] : []),
    ];
  }
  return [
    { site: 'linkedin.com/jobs/view', note: 'largest volume; add London/UK' }, { site: 'uk.indeed.com', note: 'large volume' },
    { site: 'gradcracker.com', note: 'STEM graduate jobs and internships' }, { site: 'brightnetwork.co.uk', note: 'graduate schemes and internships' },
    { site: 'targetjobs.co.uk', note: 'graduate schemes and internships' }, { site: 'prospects.ac.uk', note: 'graduate jobs' },
    { site: 'milkround.com', note: 'graduate jobs' }, { site: 'totaljobs.com', note: 'general board' }, { site: 'cwjobs.co.uk', note: 'IT/tech board' },
    { site: 'reed.co.uk', note: 'general board' }, { site: 'glassdoor.co.uk', note: 'general board' },
    { site: 'myworkdayjobs.com', note: 'large employers (banks, consultancies)' }, { site: 'successfactors.com', note: 'large employers' },
    { site: 'job-boards.greenhouse.io', note: 'tech/fintech careers pages' }, { site: 'jobs.lever.co', note: 'startup careers pages' },
    { site: 'jobs.ashbyhq.com', note: 'startup careers pages' }, { site: 'apply.workable.com', note: 'SME careers pages' },
    { site: 'jobs.smartrecruiters.com', note: 'mid/large employers' }, { site: 'welcometothejungle.com', note: 'startups (many non-cyber roles)' },
    { site: '', note: 'no site filter: the open web' },
  ];
}

// ------------------------------------------------------------------------------------------------
// Board-link resolver: a LinkedIn/Indeed/Glassdoor result is only a teaser. Find the SAME job on the
// employer's own careers/ATS page and read the full posting there; otherwise the link is not used.
// ------------------------------------------------------------------------------------------------
const ATS_DOMAINS = ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com', 'apply.workable.com', 'teamtailor.com', 'recruitee.com', 'jobs.personio.de', 'jobs.smartrecruiters.com', 'myworkdayjobs.com'];
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['and', 'the', 'for', 'with', 'job', 'jobs'].includes(w)));
export function sameJob(a: string, b: string): boolean {
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return false;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size) >= 0.6;
}

// ------------------------------------------------------------------------------------------------
// Board-posting reader (Jina Reader, r.jina.ai — renders JavaScript): opens ONE posting the app itself can't fetch
// (LinkedIn/Indeed/Bayt…), confirms it is still live, returns its text and the employer's own apply/careers links
// found on the page. If no Jina key is set (or it runs out), the OpenAI link reader is used instead.
// ------------------------------------------------------------------------------------------------
const EXPIRED = /no longer accepting applications|this job (has )?expired|job (has )?expired|job is no longer (available|active|open)|this (job|position|vacancy) (is|has been) (closed|filled|removed)|position has been filled|vacancy (is )?closed|no longer (available|open|active)\b|the job you are looking for (is|was)|page (was )?not found|invalid request|job not found/i;
const BOT_WALL = /just a moment|verify you are human|enable javascript and cookies|access denied|captcha|unusual traffic|sign in to (view|see)|join now to see/i;
const SOCIAL = /(^|\.)(facebook|twitter|x|instagram|youtube|tiktok|google|apple|microsoft|cloudflare|gstatic|w3|schema|wikipedia)\.[a-z.]+$/i;
let scrapeUnavailable = '';
export function boardReaderAvailable() { return hasSecret('jina_api_key') && !scrapeUnavailable; }
/** Called at the start of every scan: a problem in an earlier scan must not switch the page reader off for good. */
export function resetBoardReader() { scrapeUnavailable = ''; }
export interface PageRead { ok: boolean; expired?: boolean; wall?: boolean; text?: string; title?: string; postedAt?: string | null; employerLinks?: string[]; error?: string }

export async function readBoardPosting(url: string): Promise<PageRead> {
  if (!boardReaderAvailable()) return { ok: false, error: scrapeUnavailable || 'No Jina key' };
  const key = await getSecret('jina_api_key');
  const r = await politeFetch(`https://r.jina.ai/${url}`, { sourceId: 'jina_reader', accept: 'application/json', retries: 1, delayMs: 0, timeoutMs: 45000,
    headers: { Authorization: `Bearer ${key}`, 'X-Return-Format': 'markdown', 'X-Timeout': '25', 'X-Retain-Images': 'none', 'X-With-Links-Summary': 'true' } });
  let body: any = null; try { body = JSON.parse(r.text); } catch { /* not JSON */ }
  const msg = String(body?.readableMessage ?? body?.message ?? '');
  if (!r.ok) {
    // The POSTING is gone (the page returned 404/410) → that job is closed, nothing more.
    if (/returned error 40[14]|returned error 410|\b404\b.*not found|not found/i.test(msg) || r.status === 404 || r.status === 410) return { ok: true, expired: true, text: '', title: '' };
    // Bad key / no balance → stop using the page reader for this scan only (the OpenAI reader takes over).
    if ([401, 402].includes(r.status) || /balance|insufficient|quota/i.test(msg)) scrapeUnavailable = `Jina page reader unavailable (HTTP ${r.status}${msg ? `: ${msg.slice(0, 120)}` : ''})`;
    return { ok: false, wall: [403, 422, 451].includes(r.status), error: `${r.error ?? `HTTP ${r.status}`}${msg ? ` (${msg.slice(0, 120)})` : ''}` };
  }
  const d = body?.data ?? {};
  const content = String(d.content ?? '');
  // Links summary → markdown links, so the employer's apply/careers links can be picked out.
  const links = Array.isArray(d.links) ? d.links.map((x: any) => (Array.isArray(x) ? `[${x[0]}](${x[1]})` : '')).join('\n')
    : d.links && typeof d.links === 'object' ? Object.entries(d.links).map(([t, u]) => `[${t}](${u})`).join('\n') : '';
  if (/target url returned error 40[14]|target url returned error 410/i.test(content.slice(0, 300))) return { ok: true, expired: true, text: '', title: '' };
  const read = parseScrapedPosting(content, `${content}\n${links}`, String(d.title ?? ''));
  // Jina reports the page's publish date when it can find one.
  if (read.ok && !read.expired && !read.postedAt && d.publishedTime) read.postedAt = parsePostedDate(String(d.publishedTime));
  return read;
}

/** Decide from a scraped page whether it is a live, readable single posting (and pull out date + employer links). */
export function parseScrapedPosting(rawText: string, md: string, title: string): PageRead {
  const text = htmlToText(rawText).trim();
  if (text.length < 200 || BOT_WALL.test(text.slice(0, 600))) return { ok: false, wall: true, error: 'Page blocked or empty' };
  // Only the posting itself counts: "Similar jobs / People also viewed…" lists other jobs (their dates and text are not this job's).
  const cut = text.search(/\n\s*\*?\s*(similar jobs|people also viewed|more jobs|recommended jobs|similar searches|jobs you may be interested in|other jobs|related jobs|explore (more|collaborative))\b/i);
  const main = (cut > 0 ? text.slice(0, cut) : text).trim();
  if (EXPIRED.test(title) || EXPIRED.test(main.slice(0, 3000)) || /no longer accepting applications|this job has expired|job is no longer available/i.test(main)) return { ok: true, expired: true, text: main, title };
  // A real posting page has the description; LinkedIn closed/cut-down pages only show the header and similar jobs.
  const postingBody = main.replace(/^.*?\n/, '');
  const looksLikePosting = postingBody.length >= 600 && /\b(responsibilit|requirement|qualification|experience|skills|duties|about the (role|job)|job description|what you('ll| will))/i.test(postingBody);
  if (!looksLikePosting) return { ok: false, error: 'Posting text not available from the page reader' };
  const posted = main.match(/\b(?:re)?posted\s*(?:on|:)?\s*((?:\d+\+?\s+(?:minute|hour|day|week|month|year)s?\s+ago)|today|yesterday|\d{1,2}\s+[A-Z][a-z]+\s+20\d\d|20\d\d-\d\d-\d\d)/i)?.[1]
    ?? main.slice(0, 1500).match(/\b(\d+\+?\s+(?:hour|day|week|month|year)s?\s+ago)\b/i)?.[1];
  const textOut = main;
  const links = new Set<string>();
  const mdCut = md.search(/(similar jobs|people also viewed|more jobs|recommended jobs|related jobs)/i);
  for (const m of (mdCut > 0 ? md.slice(0, mdCut) : md).matchAll(/\[([^\]]{0,80})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const [, label, href] = m;
    try {
      const h = new URL(href).hostname;
      if (boardForUrl(href) || TEASER_BOARDS.test(h) || SOCIAL.test(h)) continue;
      // Employer apply/careers pages only — not the company homepage.
      if (parseAtsUrl(href)?.jobId || looksLikeSinglePosting(href) || (/apply|career/i.test(label) && /career|jobs?\b|vacanc|recruit|apply|talent|workday|successfactors|taleo|oraclecloud/i.test(href))) links.add(href);
    } catch { /* ignore */ }
  }
  return { ok: true, text: textOut.slice(0, 20000), title, postedAt: parsePostedDate(posted ?? null), employerLinks: [...links].slice(0, 5) };
}

const GULF_CC: Record<string, SearchOpts['country']> = { UAE: 'ae', QATAR: 'qa', SAUDI: 'sa' };
const isBoardOrAggregator = (url: string) => !!boardForUrl(url) || TEASER_BOARDS.test(new URL(url).hostname);

/**
 * Find the SAME job on the employer's own careers site. Returns:
 *  - a full employer posting (descriptionComplete) when it could be read, or
 *  - the job with only `employerUrl` set when the careers page was found but could not be read, or
 *  - null when the employer has no findable careers posting.
 */
export async function resolveEmployerPosting(d: DiscoveredJob, budget: { left: number }): Promise<DiscoveredJob | null> {
  if (!d.employer || !d.title || budget.left <= 0) return null;
  const providers = activeProviders();
  if (!providers.length) return null;
  const { fetchSingleAtsJob, importFromUrl } = await import('../extraction/jd.js');
  const empToken = (d.employer.toLowerCase().replace(/^(the|al)\s+/, '').split(/[\s,.&-]+/)[0] ?? '').slice(0, 5);
  const country = d.market && d.market !== 'UK' ? GULF_CC[d.market] : 'uk';
  // Same job title AND a page on the employer's own domain / careers platform (aggregator copies don't count).
  const matches = (h: Hit) => sameJob(d.title, h.title) && isEmployerSite(h.url, d.employer) && (!empToken || (h.title + ' ' + h.url + ' ' + h.snippet).toLowerCase().includes(empToken));
  let careersUrl: string | null = null;
  // 1) The employer's ATS (Greenhouse, Lever, Workday…). 2) Anywhere else that isn't a job board = the employer's careers site.
  for (const domains of [ATS_DOMAINS, []]) {
    if (budget.left <= 0) break;
    budget.left--;
    const r = await runProvider(providers[0], `"${d.title}" "${d.employer}" ${domains.length ? 'careers' : 'careers apply'}`, domains, { country });
    if (!r.ok) continue;
    for (const h of r.hits.slice(0, 8)) {
      if (!isSafeHttpUrl(h.url) || isBoardOrAggregator(h.url) || !matches(h)) continue;
      const ats = parseAtsUrl(h.url);
      if (ats?.jobId) {
        const full = await fetchSingleAtsJob(ats.ats, ats.token, ats.jobId, h.url);
        if (full?.listingState === 'CLOSED') return null; // the employer has closed it — the board copy is stale
        if (full?.descriptionComplete) return { ...full, employer: d.employer, market: d.market, boardUrl: d.boardUrl ?? d.applyUrl, query: d.query };
      } else if (looksLikeSinglePosting(h.url) || /career|jobs?\b|vacanc|recruit/i.test(h.url)) {
        careersUrl ??= h.url;
        const imp = await importFromUrl(h.url, null, { title: d.title, employer: d.employer, location: d.location ?? undefined });
        if (imp.job?.descriptionComplete && imp.job.listingState !== 'CLOSED') return { ...imp.job, market: d.market, boardUrl: d.boardUrl ?? d.applyUrl, query: d.query };
      }
    }
  }
  return careersUrl ? { ...d, employerUrl: careersUrl } : null;
}

// ------------------------------------------------------------------------------------------------
// Google Jobs via SerpApi (free 250 searches/month): Google's job index aggregates LinkedIn, Indeed,
// Glassdoor, Totaljobs, company sites… and returns the FULL description, so jobs can be fully analysed.
// ------------------------------------------------------------------------------------------------
const PREFER_NOT = /linkedin\.com|indeed\.com|glassdoor\.|ziprecruiter|talent\.com|jooble|adzuna|simplyhired|bebee|learn4good|jobrapido/i;

export const googleJobsAdapter: JobSourceAdapter = {
  id: 'google_jobs', displayName: 'Google Jobs (via SerpApi, free 250/month)', sourceHomepage: 'https://serpapi.com/google-jobs-api',
  mode: 'OFFICIAL_API', kind: 'API',
  description: 'Google Jobs aggregates postings from LinkedIn, Indeed, Glassdoor, Totaljobs and company careers sites, with the full job description. Free SerpApi plan: 250 searches/month (the app uses ~4 per scan).',
  async verifyAccess() {
    if (!hasSecret('serpapi_api_key')) return { status: 'NOT_CONFIGURED', message: 'Add a free SerpApi key in Settings (serpapi.com → sign up).' };
    const key = await getSecret('serpapi_api_key');
    const r = await politeFetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key!)}`, { sourceId: 'google_jobs', accept: 'application/json', retries: 0 });
    if (!r.ok) return { status: r.status === 401 ? 'AUTH_REQUIRED' : 'ERROR', message: r.error ?? `HTTP ${r.status}` };
    const a = JSON.parse(r.text);
    return { status: 'CONNECTED', message: `SerpApi key accepted — ${a.plan_searches_left ?? a.total_searches_left ?? '?'} searches left this month.` };
  },
  async discover(intent, ctx) {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const key = await getSecret('serpapi_api_key');
    if (!key) return out;
    const s = getSettings();
    const gulfLocs = intent.market ? MARKETS[intent.market].googleLocations : null;
    const loc = intent.location === 'UK' || intent.location === 'REMOTE' ? 'United Kingdom' : 'London, England, United Kingdom';
    const budget = gulfLocs ? s.gulf_google_queries_per_run : s.google_jobs_queries_per_run;
    // Gulf: broad queries first, rotating through the country's cities (Dubai → Abu Dhabi → whole UAE…), capped by your budget.
    const qs = gulfLocs ? GULF_QUERY_ORDER(intent) : buildRoleQueries(intent, budget);
    // Gulf: every query in every city (first round = each query once, rotating cities; later rounds fill in the rest).
    const plan = (gulfLocs
      ? gulfLocs.flatMap((_, round) => qs.map((q, i) => ({ q, loc: gulfLocs[(i + round) % gulfLocs.length] })))
      : qs.map((q) => ({ q, loc }))).slice(0, budget);
    // Only postings inside your age window (Google Jobs date chips).
    const chip = s.max_posting_age_days <= 1 ? 'today' : s.max_posting_age_days <= 3 ? '3days' : s.max_posting_age_days <= 7 ? 'week' : 'month';
    const gl = intent.market === 'UAE' ? 'ae' : intent.market === 'QATAR' ? 'qa' : intent.market === 'SAUDI' ? 'sa' : 'uk';
    const seen = new Set<string>();
    // Gulf: each query can page on (10 jobs per page) — paging a productive query beats starting a weak new one.
    const queue: Array<{ q: string; loc: string; token?: string; page?: number }> = [...plan];
    let used = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const { q, loc, token, page } = queue[qi];
      if (ctx.shouldStop() || used >= budget) break;
      used++;
      ctx.budget.queriesLeft--;
      out.queries.push(`google_jobs: ${q} @ ${loc} (posted ≤ ${chip})${page ? ` page ${page}` : ''}`);
      const r = await politeFetch(`https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(q)}&location=${encodeURIComponent(loc)}&gl=${gl}&hl=en&chips=date_posted:${chip}${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}&api_key=${encodeURIComponent(key)}`, { sourceId: 'google_jobs', accept: 'application/json', delayMs: 1500 });
      if (!r.ok) { out.errors.push(`Google Jobs "${q}": ${r.error ?? r.status}`); ctx.log('SEARCH', `✗ google_jobs: ${q} @ ${loc} → ${r.error ?? r.status}`, { provider: 'google_jobs', site: 'Google Jobs', q, ok: false, results: 0, kept: 0 }); if (r.blocked || r.status === 401) break; continue; }
      const body = JSON.parse(r.text);
      ctx.log('SEARCH', `google_jobs: ${q} @ ${loc}${page ? ` (page ${page})` : ''} → ${(body.jobs_results ?? []).length} jobs with full descriptions`, { provider: 'google_jobs', site: 'Google Jobs', q, page: page ?? 1, ok: true, results: (body.jobs_results ?? []).length, kept: (body.jobs_results ?? []).length });
      const next = body.serpapi_pagination?.next_page_token;
      if (gulfLocs && next && (page ?? 1) < 3 && (body.jobs_results ?? []).length >= 8) queue.splice(qi + 1, 0, { q, loc, token: next, page: (page ?? 1) + 1 });
      const res = (body.jobs_results ?? []).filter((x: any) => { const k = x.job_id ?? `${x.title}|${x.company_name}`; if (seen.has(k)) return false; seen.add(k); return true; });
      out.linksFound += res.length;
      for (const j of res) {
        // Apply link preference: employer ATS → employer careers site → a clean single-posting board link. Broken board links are dropped.
        const opts: Array<{ title: string; link: string }> = (j.apply_options ?? []).filter((o: any) => isSafeHttpUrl(o.link))
          .map((o: any) => ({ ...o, link: boardForUrl(o.link) || TEASER_BOARDS.test(new URL(o.link).hostname) ? canonicalBoardUrl(o.link) : o.link }))
          .filter((o: any) => !!o.link);
        const best = opts.find((o) => parseAtsUrl(o.link)) ?? opts.find((o) => !PREFER_NOT.test(o.link) && !boardForUrl(o.link)) ?? opts[0];
        const url = best?.link;
        if (!url || !isSafeHttpUrl(url)) continue;
        const ats = parseAtsUrl(url);
        const board = boardForUrl(url);
        const text = String(j.description ?? '');
        const ext = j.detected_extensions ?? {};
        out.jobs.push({
          sourceId: 'google_jobs', sourceJobId: String(j.job_id ?? url).slice(0, 300), title: j.title, employer: j.company_name ?? null, location: j.location ?? null,
          boardUrl: board ? url : (opts.find((o) => PREFER_NOT.test(o.link))?.link ?? null), employerUrl: !board ? url : null, applyUrl: url,
          applyUrlKind: ats ? 'EMPLOYER_ATS' : board ? 'BOARD' : 'EMPLOYER_SITE', postedAt: parsePostedDate(ext.posted_at), deadline: null,
          salaryText: ext.salary ?? null, descriptionText: `${ext.schedule_type ? `Employment type: ${ext.schedule_type}\n` : ''}Listed via: ${j.via ?? 'Google Jobs'}\n${text}`,
          descriptionComplete: text.length > 500, extractionMethod: 'google_jobs_serpapi', accessMode: 'OFFICIAL_API', query: q,
        });
      }
    }
    return out;
  },
};
