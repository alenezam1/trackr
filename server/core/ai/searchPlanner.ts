// AI-steered search. OpenAI is the strategist, the search provider (DataForSEO / Jina) does the searching, and the app scores every search on what came
// back (real single postings, postings on your target roles at entry level, postings dated in your window):
//
//   1. PROPOSE  OpenAI writes a varied set of test searches for your goal (+ what worked in past scans).
//   2. PROBE    The search provider runs a small batch; each search is scored.
//   3. PLAN     OpenAI reads the scores, works out which sites / wordings are "hot", and writes a ranked plan that doubles
//               down on winners (variants, more cities, next pages) and drops losers.
//   4. ADAPT    The plan runs in rounds; between rounds OpenAI re-plans with the new scores.
// Every posting found still goes through the normal checks (opened, live, dated, graded). Each step is shown in the
// scan console. If OpenAI is unavailable, the standard search plan is used instead.
import { chatJson } from './client.js';
import { safeParse } from '../discovery/events.js';
import { pool } from '../util/pool.js';
import { getDb } from '../../db/db.js';
import { getProfile, getSettings } from '../../config/settings.js';
import type { SearchIntent } from '../models.js';
import type { DiscoveryContext } from '../sources/types.js';
import type { SearchStat } from '../sources/websearch.js';

type Exec = (q: string, domains: string[], page?: number) => Promise<SearchStat | null>;
interface PlanItem { q: string; site: string; pages: number; why: string }

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    insights: { type: 'array', items: { type: 'string' } },
    queries: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { q: { type: 'string' }, site: { type: 'string' }, pages: { type: 'integer' }, why: { type: 'string' } },
        required: ['q', 'site', 'pages', 'why'],
      },
    },
  },
  required: ['insights', 'queries'],
};

const SYSTEM = `You are the search strategist for a personal job finder. You write Google search queries that the app sends to a
search API, one query per search. You get measured results back and must maximise the number of REAL, CURRENT, SINGLE job
postings that match the candidate's goal per search spent. Output strict JSON only.
Query rules:
- Put the site (a domain or domain/path from the catalog) in "site", never "site:" inside "q". Use "" for the open web.
- "q" is at most 120 characters. You may use "quoted phrases", OR, and parentheses.
- Over-constrained queries return nothing (e.g. three exact titles AND a required level phrase AND a city). Balance: one
  or two role phrases, optionally ONE level word, plus a place unless the site is already country-specific.
- Postings are filtered for recency by the API; do not add dates. Do not invent sites outside the catalog.
- Seniority, experience and nationality are checked after reading each posting, so you do not need to filter them in the query.
- "pages": 1-3. Ask for 2-3 only when a query shape has proven to return many on-target postings.`;

function goalText(intent: SearchIntent, sites: Array<{ site: string; note: string }>) {
  const s = getSettings();
  const { profile } = getProfile();
  const roles = profile.target_roles.filter((f: any) => f.enabled).map((f: any) => `${f.label}${f.keywords?.length ? ` (${f.keywords.slice(0, 6).join(', ')})` : ''}`);
  const focus = intent.roleFocus === 'INTERNSHIP' ? 'internships and placements' : intent.roleFocus === 'GRADUATE' ? 'graduate schemes and entry-level / junior jobs' : 'internships, graduate schemes and entry-level / junior jobs';
  const where = intent.market
    ? `${intent.market === 'UAE' ? 'the UAE (Dubai, Abu Dhabi, Sharjah)' : intent.market === 'QATAR' ? 'Qatar (Doha)' : 'Saudi Arabia (Riyadh, Jeddah, Dammam)'}; roles open to expats (not nationals-only); max 2 years' experience`
    : `${intent.location === 'UK' ? 'the UK (London, Manchester, Birmingham, Edinburgh, Leeds, Bristol, remote UK)' : 'London, UK'}; employers that can sponsor visas or accept the Graduate visa; no existing security clearance required`;
  const target = intent.market ? 'entry-level cyber security roles: SOC analyst (L1/tier 1), security operations, GRC / IT audit, IT security analyst, cyber intern/graduate/trainee, junior pen tester, vulnerability analyst, SIEM analyst'
    : `${focus} in: ${roles.join('; ')}`;
  return `GOAL: find ${target} in ${where}. Posted within the last ${s.max_posting_age_days} days.
${intent.keywords.length ? `Extra keywords from the user: ${intent.keywords.join(' ')}\n` : ''}SITE CATALOG (site → notes):
${sites.map((x) => `- ${x.site || '(open web)'} → ${x.note}`).join('\n')}`;
}

/** Past searches for this market, best and worst (from the scan console of earlier scans). */
function history(market: string) {
  const rows = getDb().all<any>(`SELECT e.data_json d FROM scan_events e WHERE e.stage = 'SEARCH' AND e.at >= ? AND e.data_json LIKE ? ORDER BY e.id DESC LIMIT 4000`,
    new Date(Date.now() - 45 * 86400000).toISOString(), `%"market":"${market}"%`);
  const byQ = new Map<string, { site: string; q: string; n: number; results: number; kept: number; relevant: number }>();
  const bySite = new Map<string, { n: number; results: number; kept: number; relevant: number }>();
  for (const r of rows) {
    const d = safeParse(r.d); if (!d?.ok) continue;
    const k = `${d.site}|${d.q}`;
    const x = byQ.get(k) ?? { site: d.site, q: d.q, n: 0, results: 0, kept: 0, relevant: 0 };
    x.n++; x.results += d.results ?? 0; x.kept += d.kept ?? 0; x.relevant += d.relevant ?? 0; byQ.set(k, x);
    const y = bySite.get(d.site) ?? { n: 0, results: 0, kept: 0, relevant: 0 };
    y.n++; y.results += d.results ?? 0; y.kept += d.kept ?? 0; y.relevant += d.relevant ?? 0; bySite.set(d.site, y);
  }
  const all = [...byQ.values()];
  const best = all.filter((x) => x.relevant > 0).sort((a, b) => b.relevant / b.n - a.relevant / a.n).slice(0, 12);
  const sitesLine = [...bySite.entries()].sort((a, b) => b[1].relevant - a[1].relevant)
    .map(([s, v]) => `${s}: ${v.n} searches, ${(v.results / v.n).toFixed(1)} results/search, ${(v.relevant / v.n).toFixed(1)} on-target/search`).slice(0, 25);
  return { best, sitesLine, any: rows.length > 0 };
}

const fmtStat = (x: SearchStat) => `${x.site} | ${x.q}${x.page > 1 ? ` (p${x.page})` : ''} | results ${x.results} | postings ${x.kept} | on-target ${x.relevant} | dated-in-window ${x.fresh}${x.titles.length ? ` | e.g. ${x.titles.slice(0, 3).join(' ; ')}` : ''}`;

function statsSummary(stats: SearchStat[]) {
  const bySite = new Map<string, { n: number; results: number; kept: number; relevant: number }>();
  for (const x of stats) { const y = bySite.get(x.site) ?? { n: 0, results: 0, kept: 0, relevant: 0 }; y.n++; y.results += x.results; y.kept += x.kept; y.relevant += x.relevant; bySite.set(x.site, y); }
  const sites = [...bySite.entries()].sort((a, b) => b[1].relevant / b[1].n - a[1].relevant / a[1].n)
    .map(([s, v]) => `${s}: ${v.n} searches → ${v.results} results, ${v.kept} postings, ${v.relevant} on-target (${(v.relevant / v.n).toFixed(1)}/search)`);
  const recent = stats.slice(-90).map(fmtStat);
  return `PER SITE (this scan):\n${sites.join('\n')}\n\nSEARCHES RUN SO FAR (newest last):\n${recent.join('\n')}`;
}

/** Clean what the model wrote: site from the catalog (or open web), no site: in the query, short, unique. */
function sanitize(items: PlanItem[], sites: Array<{ site: string }>, done: Set<string>): PlanItem[] {
  const allowed = new Set(sites.map((x) => x.site));
  const out: PlanItem[] = [];
  for (const it of items ?? []) {
    let q = String(it.q ?? '').trim();
    let site = String(it.site ?? '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    const inQ = q.match(/\bsite:(\S+)/i);
    if (inQ) { if (!site) site = inQ[1].replace(/^www\./, ''); q = q.replace(/\bsite:\S+\s*/gi, '').trim(); }
    if (site && !allowed.has(site)) { const m = [...allowed].find((a) => a && (site.startsWith(a) || a.startsWith(site))); if (!m) continue; site = m; }
    if (!q || q.length > 160) continue;
    const key = `${site}|${q.toLowerCase()}`;
    if (done.has(key)) continue;
    done.add(key);
    out.push({ q, site, pages: Math.min(3, Math.max(1, Number(it.pages) || 1)), why: String(it.why ?? '').slice(0, 160) });
  }
  return out;
}

export async function runAiPlannedSearch(o: {
  intent: SearchIntent; ctx: DiscoveryContext; budget: number; exec: Exec; usedSoFar: () => number;
  fallback: () => Array<{ q: string; domains: string[] }>; sites: Array<{ site: string; note: string }>;
}): Promise<{ ok: boolean; error?: string }> {
  const { intent, ctx, budget, exec, usedSoFar, sites } = o;
  const s = getSettings();
  const market = intent.market ?? 'UK';
  const goal = goalText(intent, sites);
  const hist = history(market);
  const planned = new Set<string>();
  const stats: SearchStat[] = [];
  const left = () => budget - usedSoFar();
  const histText = hist.any
    ? `PAST SCANS (last 45 days):\nSites: ${hist.sitesLine.join(' ; ')}\nBest past searches (on-target per search):\n${hist.best.map((b) => `${b.site} | ${b.q} | ${(b.relevant / b.n).toFixed(1)} on-target/search over ${b.n} runs`).join('\n') || '(none yet)'}`
    : 'PAST SCANS: none yet.';

  // ---- 1. PROPOSE test searches ----
  const probeN = Math.min(s.ai_search_probe_size, Math.max(6, Math.floor(budget / 4)));
  ctx.log('AI', `AI search planner: asking OpenAI for ${probeN} test searches (goal: ${market === 'UK' ? 'UK' : market} ${intent.roleFocus ?? 'BOTH'}).`);
  const prop = await chatJson<{ insights: string[]; queries: PlanItem[] }>('ai_search_propose', SYSTEM,
    `${goal}\n\n${histText}\n\nTASK: Propose ${probeN + 8} TEST searches to learn what works right now. Cover at least 8 different catalog sites plus the open web, ` +
    `mix broad and specific wordings (job titles, "graduate"/"intern"/"junior" variants, programme names), and re-test the best past searches if any. ` +
    `Order them so the first ${probeN} are the most informative set. Keep pages = 1.`, SCHEMA, 'search_plan');
  if (!prop.ok || !prop.data) return { ok: false, error: prop.error ?? 'no plan' };
  const probe = sanitize(prop.data.queries, sites, planned);
  // Diversity: at most 3 test searches per site.
  const perSite = new Map<string, number>();
  const probeSet = probe.filter((p) => { const n = perSite.get(p.site) ?? 0; if (n >= 3) return false; perSite.set(p.site, n + 1); return true; }).slice(0, probeN);
  for (const line of prop.data.insights.slice(0, 4)) ctx.log('AI', `AI: ${line}`);
  ctx.log('PLAN', `Probe: running ${probeSet.length} test searches across ${new Set(probeSet.map((p) => p.site || 'open web')).size} sites.`, { probe: probeSet.map((p) => `${p.site} | ${p.q}`) });

  // ---- 2. PROBE ----
  // Searches run 4 at a time (the search provider is an API — no reason to wait between calls).
  await pool(probeSet, 4, async (p) => {
    if (ctx.shouldStop() || left() <= 0) return;
    const r = await exec(p.q, p.site ? [p.site] : []);
    if (r) stats.push(r);
  });
  const probeOnTarget = stats.reduce((a, x) => a + x.relevant, 0);
  ctx.log('SUMMARY', `Probe done: ${stats.length} searches → ${stats.reduce((a, x) => a + x.results, 0)} results, ${stats.reduce((a, x) => a + x.kept, 0)} postings, ${probeOnTarget} on-target.`,
    { probe: true, searches: stats.length, onTarget: probeOnTarget });

  // ---- 3+4. PLAN, run, re-plan ----
  const rounds = s.ai_search_replans + 1;
  for (let round = 0; round < rounds && left() > 0 && !ctx.shouldStop(); round++) {
    const roundsLeft = rounds - round;
    const n = round === rounds - 1 ? left() : Math.ceil(left() / roundsLeft);
    ctx.log('AI', `AI search planner: round ${round + 1}/${rounds} — sending ${stats.length} scored searches to OpenAI, asking for the best ${n} next searches.`);
    const plan = await chatJson<{ insights: string[]; queries: PlanItem[] }>('ai_search_plan', SYSTEM,
      `${goal}\n\n${histText}\n\n${statsSummary(stats)}\n\nTASK: Write the next ${n} searches, best first. Favour the sites and wordings with the most ON-TARGET postings per search; ` +
      `expand winners (other cities, title variants, synonyms, programme names, next pages via "pages"); stop using sites/wordings that returned 0 results or 0 on-target postings; ` +
      `keep about 15% for new ideas. Do not repeat a search already run. In "insights", state briefly what is hot and what is not.`, SCHEMA, 'search_plan');
    if (!plan.ok || !plan.data) { ctx.log('ERROR', `AI planner round ${round + 1} failed (${plan.error}) — continuing with the standard plan.`); break; }
    for (const line of plan.data.insights.slice(0, 5)) ctx.log('AI', `AI: ${line}`);
    const items = sanitize(plan.data.queries, sites, planned).slice(0, Math.ceil(n * 1.2));
    ctx.log('PLAN', `AI plan round ${round + 1}: ${items.length} searches (top: ${items.slice(0, 3).map((i) => `${i.site || 'web'} ${i.q}`).join(' | ')}).`, { plan: items.map((i) => `${i.site} | ${i.q} | p${i.pages} | ${i.why}`) });
    let ran = 0;
    await pool(items, 4, async (it) => {
      if (ctx.shouldStop() || left() <= 0 || ran >= n) return;
      ran++;
      let prev = await exec(it.q, it.site ? [it.site] : []);
      if (!prev) return;
      stats.push(prev);
      // Next pages only while they keep paying off.
      for (let pg = 2; pg <= it.pages && left() > 0 && !ctx.shouldStop(); pg++) {
        if (prev.results < 10 || prev.kept < 1) break;
        const rp = await exec(it.q, it.site ? [it.site] : [], pg);
        if (!rp) break;
        stats.push(rp);
        prev = rp;
      }
    });
  }

  // ---- Leftover budget: standard searches on sites that produced something this scan ----
  if (left() > 0 && !ctx.shouldStop()) {
    const productive = new Set(stats.filter((x) => x.kept > 0).map((x) => x.site));
    const fill = o.fallback().filter((x) => productive.has(x.domains[0] ?? 'any site'));
    if (fill.length) ctx.log('PLAN', `Using the remaining ${left()} searches on standard searches for sites that worked this scan (${[...productive].slice(0, 6).join(', ')}).`);
    await pool(fill, 4, async (f) => {
      if (ctx.shouldStop() || left() <= 0) return;
      const r = await exec(f.q, f.domains);
      if (r) stats.push(r);
    });
  }
  const total = stats.reduce((a, x) => a + x.relevant, 0);
  ctx.log('SUMMARY', `AI-steered search: ${stats.length} searches → ${stats.reduce((a, x) => a + x.kept, 0)} postings, ${total} on-target (${stats.length ? (total / stats.length).toFixed(2) : 0} per search; probe was ${probeSet.length ? (probeOnTarget / Math.max(1, probeSet.length)).toFixed(2) : 0}).`);
  return { ok: true };
}
