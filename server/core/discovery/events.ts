// Scan console: a step-by-step log of what the search algorithm does during a scan, so you can watch it work
// (plan → each search sent → what came back and why links were kept/dropped → pages opened → decisions).
import { getDb } from '../../db/db.js';

export type Stage = 'PLAN' | 'SEARCH' | 'FILTER' | 'OPEN' | 'AI' | 'CAREERS' | 'SKIP' | 'GRADE' | 'SOURCE' | 'SUMMARY' | 'ERROR';

export interface ScanEvent { id: number; run_id: number; at: string; stage: Stage; msg: string; data: Record<string, unknown> | null }

/** Record one console line for a run. Never throws (the console must not break a scan). */
export function emit(runId: number | null | undefined, stage: Stage, msg: string, data?: Record<string, unknown>) {
  if (!runId) return;
  try {
    // Never cut JSON mid-way (that made it unreadable): shorten long lists instead, and drop details if still too big.
    let json = data ? JSON.stringify(data) : null;
    if (json && json.length > 6000) {
      const short = Object.fromEntries(Object.entries(data!).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 25) : typeof v === 'string' ? v.slice(0, 500) : v]));
      json = JSON.stringify(short);
      if (json.length > 6000) json = JSON.stringify({ truncated: true });
    }
    getDb().run('INSERT INTO scan_events(run_id, at, stage, msg, data_json) VALUES (?, ?, ?, ?, ?)',
      runId, new Date().toISOString(), stage, msg.slice(0, 500), json);
  } catch { /* console is best-effort */ }
}

export function listEvents(runId: number, after = 0, limit = 400): ScanEvent[] {
  return getDb().all<any>('SELECT * FROM scan_events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?', runId, after, Math.min(limit, 2000))
    .map((r) => ({ ...r, data: safeParse(r.data_json) }));
}

/** Older builds stored some cut-off JSON — never let one bad row break the console. */
export function safeParse(s: string | null | undefined): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

const hostOf = (u: string | null | undefined) => { try { return new URL(u ?? '').hostname.replace(/^www\./, ''); } catch { return 'unknown'; } };

/**
 * How well each search engine / job site worked in this run:
 * searches sent → results → single postings kept → opened → live → graded → eligible.
 */
export function runEfficacy(runId: number) {
  const db = getDb();
  const sites = new Map<string, { site: string; searches: number; results: number; kept: number; relevant: number; failed: number; outcomes: Record<string, number> }>();
  const site = (k: string) => { let s = sites.get(k); if (!s) { s = { site: k, searches: 0, results: 0, kept: 0, relevant: 0, failed: 0, outcomes: {} }; sites.set(k, s); } return s; };
  const providers: Record<string, { searches: number; results: number; kept: number; relevant: number; failed: number }> = {};
  for (const e of db.all<any>("SELECT data_json FROM scan_events WHERE run_id = ? AND stage = 'SEARCH' AND data_json IS NOT NULL", runId)) {
    const d = safeParse(e.data_json);
    if (!d) continue;
    const s = site(String(d.site ?? 'any site'));
    s.searches++; s.results += Number(d.results ?? 0); s.kept += Number(d.kept ?? 0); s.relevant += Number(d.relevant ?? 0); if (d.ok === false) s.failed++;
    const p = (providers[String(d.provider ?? '?')] ??= { searches: 0, results: 0, kept: 0, relevant: 0, failed: 0 });
    p.searches++; p.results += Number(d.results ?? 0); p.kept += Number(d.kept ?? 0); p.relevant += Number(d.relevant ?? 0); if (d.ok === false) p.failed++;
  }
  // Outcomes of the postings each site led to (graded status, expired, unreadable, too old…).
  for (const c of db.all<any>('SELECT url, state FROM search_run_candidates WHERE run_id = ?', runId)) {
    const h = hostOf(c.url);
    const key = [...sites.keys()].find((k) => k !== 'any site' && (h === k.split('/')[0] || h.endsWith(`.${k.split('/')[0]}`))) ?? h;
    const s = site(key);
    s.outcomes[c.state] = (s.outcomes[c.state] ?? 0) + 1;
  }
  const rows = [...sites.values()].map((s) => {
    const o = s.outcomes;
    const graded = (o.POTENTIAL_NO_STATED_BLOCKER ?? 0) + (o.VERIFIED_COMPATIBLE ?? 0) + (o.NEEDS_REVIEW ?? 0) + (o.EXCLUDED ?? 0) + (o.STALE ?? 0);
    const eligible = (o.POTENTIAL_NO_STATED_BLOCKER ?? 0) + (o.VERIFIED_COMPATIBLE ?? 0);
    const dead = (o.EXPIRED ?? 0) + (o.UNREADABLE_OR_EXPIRED ?? 0) + (o.UNREADABLE ?? 0) + (o.TOO_OLD ?? 0) + (o.UNDATED_BOARD_POSTING ?? 0);
    return { ...s, graded, eligible, dead, keptPerSearch: s.searches ? +(s.kept / s.searches).toFixed(1) : null, gradedPerSearch: s.searches ? +(graded / s.searches).toFixed(2) : null };
  }).sort((a, b) => b.graded - a.graded || b.kept - a.kept);
  return { providers, sites: rows };
}
