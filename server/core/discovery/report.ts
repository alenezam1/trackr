// After every scan (spec §10–§11): spot-check that Eligible jobs are really still open, then write the run's results
// to CSV files and a run-log.json (queries, yield per source, rejects by reason, time per stage).
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb } from '../../db/db.js';
import { emit, runEfficacy, safeParse } from './events.js';
import { jobDetail } from '../tracker/tracker.js';
import { parseAtsUrl } from '../sources/ats.js';
import { boardForUrl } from '../sources/boards.js';
import { readBoardPosting, boardReaderAvailable } from '../sources/websearch.js';
import { politeFetch } from '../sources/http.js';
import { TEASER_BOARDS } from '../extraction/posting.js';
import { analyseJob } from './pipeline.js';

const hostOf = (u: string | null | undefined) => { try { return new URL(u ?? '').hostname.replace(/^www\./, ''); } catch { return 'unknown'; } };
const STILL_CLOSED = /no longer accepting applications|this job (has )?expired|job (has )?expired|position has been filled|job is no longer available|vacancy (is )?closed/i;

/** Is this apply/posting link still a live job? 'open' | 'closed' | 'unknown' (couldn't check, e.g. blocked). */
async function checkLive(url: string): Promise<'open' | 'closed' | 'unknown'> {
  const ats = parseAtsUrl(url);
  if (ats?.jobId) {
    const { fetchSingleAtsJob } = await import('../extraction/jd.js');
    const j = await fetchSingleAtsJob(ats.ats, ats.token, ats.jobId, url).catch(() => null);
    return !j ? 'closed' : j.listingState === 'CLOSED' ? 'closed' : 'open';
  }
  const board = boardForUrl(url) || TEASER_BOARDS.test(hostOf(url));
  if (board) {
    if (!boardReaderAvailable()) return 'unknown';
    const r = await readBoardPosting(url).catch(() => null);
    return !r ? 'unknown' : r.ok && r.expired ? 'closed' : r.ok ? 'open' : 'unknown';
  }
  const r = await politeFetch(url, { sourceId: 'spot_check', accept: 'text/html', retries: 0 });
  if (r.status === 404 || r.status === 410) return 'closed';
  if (!r.ok) return 'unknown';
  return STILL_CLOSED.test(r.text.slice(0, 20000)) ? 'closed' : 'open';
}

/** Spec §11: re-open N random Eligible jobs from this run; closed ones are marked closed (and leave Eligible). */
export async function qualitySpotCheck(runId: number, n: number) {
  const db = getDb();
  const rows = db.all<any>(`SELECT DISTINCT j.id, j.title, j.apply_url, j.source_id FROM jobs j JOIN search_run_candidates c ON c.job_id = j.id AND c.run_id = ?
    WHERE j.current_status IN ('VERIFIED_COMPATIBLE','POTENTIAL_NO_STATED_BLOCKER') AND j.apply_url IS NOT NULL ORDER BY random() LIMIT ?`, runId, n);
  if (!rows.length) return { checked: 0, open: 0, closed: 0, unknown: 0, bySource: {} as Record<string, { open: number; total: number }> };
  emit(runId, 'PLAN', `Quality check: re-opening ${rows.length} random Eligible job(s) to confirm they are still open.`);
  const bySource: Record<string, { open: number; total: number }> = {};
  let open = 0; let closed = 0; let unknown = 0;
  for (const r of rows) {
    const state = await checkLive(r.apply_url);
    const src = hostOf(r.apply_url);
    const s = (bySource[src] ??= { open: 0, total: 0 });
    if (state !== 'unknown') { s.total++; if (state === 'open') s.open++; }
    if (state === 'open') open++; else if (state === 'closed') closed++; else unknown++;
    emit(runId, 'OPEN', `Quality check: ${state.toUpperCase()} — ${r.title} (${r.apply_url})`, { url: r.apply_url, state, jobId: r.id });
    if (state === 'closed') {
      db.run("UPDATE jobs SET listing_state = 'CLOSED' WHERE id = ?", r.id);
      // Recorded so this site's yield (and next scan's site order) reflects postings that turned out closed.
      db.run('INSERT INTO search_run_candidates(run_id, job_id, state, reason_codes_json, title, employer, source_id, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        runId, r.id, 'SPOTCHECK_CLOSED', '["VACANCY_CLOSED"]', r.title, null, r.source_id, r.apply_url, new Date().toISOString());
      await analyseJob(r.id, { allowAi: false }).catch(() => null);
    }
  }
  const checked = open + closed;
  emit(runId, 'SUMMARY', `Quality check: ${open}/${checked} checkable Eligible jobs still open${unknown ? ` (${unknown} could not be checked)` : ''}${checked ? ` — ${Math.round((open / checked) * 100)}% (target ≥ 90%)` : ''}.`, { open, closed, unknown });
  for (const [src, v] of Object.entries(bySource)) {
    if (v.total >= 3 && v.open / v.total < 0.7) emit(runId, 'SKIP', `Quality check: ${src} only ${v.open}/${v.total} open (< 70%) — it moves down the search order next time.`, { site: src });
  }
  return { checked, open, closed, unknown, bySource };
}

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v).replace(/\r?\n/g, ' '); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const COLS = ['country', 'company', 'title', 'level', 'experience', 'posted_date', 'closing_date', 'apply_url', 'source_url', 'sponsor_status', 'clearance', 'score', 'tier', 'reason', 'evidence_excerpt'];

/** Spec §10: results/{date}/eligible.csv, review.csv, excluded.csv + run-log.json in the app's data folder. */
export function writeRunReport(runId: number, extra: Record<string, unknown> = {}) {
  const db = getDb();
  const run = db.get<any>('SELECT * FROM search_runs WHERE id = ?', runId);
  if (!run) return null;
  const dir = path.join(dataDir(), 'results', String(run.started_at).slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const ids = db.all<{ job_id: number }>('SELECT DISTINCT job_id FROM search_run_candidates WHERE run_id = ? AND job_id IS NOT NULL', runId).map((r) => r.job_id);
  const tiers: Record<string, string[]> = { eligible: [], review: [], excluded: [] };
  for (const id of ids) {
    const d: any = jobDetail(id);
    if (!d) continue;
    const tier = ['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER'].includes(d.status) ? 'eligible' : d.status === 'NEEDS_REVIEW' ? 'review' : 'excluded';
    const reasons: any[] = d.reasons ?? [];
    const main = reasons.find((r) => r.severity === 'hard_fail') ?? reasons.find((r) => r.severity === 'uncertain') ?? reasons[0];
    const score = /score (\d+)/i.exec(reasons.find((r) => r.code === 'LOW_ENTRY_LEVEL_SCORE')?.message ?? '')?.[1] ?? d.fit ?? '';
    const src = (d.sources ?? []).find((s: any) => s.board_url)?.board_url ?? d.applyUrl;
    const row = [
      d.market ?? 'UK', d.employer, d.title, d.employmentType, d.facts?.requiredExperienceYears != null ? `${d.facts.requiredExperienceYears}y ${String(d.facts.experienceRequirement ?? '').toLowerCase()}` : 'not stated',
      d.postedAt, d.deadline, d.applyUrl, src, d.market && d.market !== 'UK' ? '' : d.sponsor?.status ?? '',
      (d.facts?.mandatoryClearances ?? []).join(' ') || ((d.facts?.optionalClearances ?? []).length ? `optional: ${d.facts.optionalClearances.join(' ')}` : 'none stated'),
      score, tier, main ? `${main.code}: ${main.message}` : '', main?.evidence?.quote ?? '',
    ];
    tiers[tier].push(row.map(csvCell).join(','));
  }
  // Per-run file names (several scans a day don't overwrite each other) + "latest" copies.
  const tag = `run${runId}`;
  for (const [t, rows] of Object.entries(tiers)) {
    const content = [COLS.join(','), ...rows].join('\r\n');
    fs.writeFileSync(path.join(dir, `${t}-${tag}.csv`), '﻿' + content, 'utf8');
    fs.writeFileSync(path.join(dir, `${t}.csv`), '﻿' + content, 'utf8');
  }
  // run-log.json: queries run, yield per source, rejects by reason, time per stage.
  const searches = db.all<any>("SELECT at, msg, data_json FROM scan_events WHERE run_id = ? AND stage = 'SEARCH' ORDER BY id", runId).map((e) => ({ at: e.at, ...(safeParse(e.data_json) ?? {}), line: e.msg }));
  const rejects = db.all<any>('SELECT state, COUNT(*) n FROM search_run_candidates WHERE run_id = ? GROUP BY state ORDER BY n DESC', runId);
  const stageTimes = db.all<any>('SELECT stage, MIN(at) first, MAX(at) last, COUNT(*) events FROM scan_events WHERE run_id = ? GROUP BY stage', runId)
    .map((s) => ({ ...s, seconds: Math.round((Date.parse(s.last) - Date.parse(s.first)) / 1000) }));
  const log = { runId, startedAt: run.started_at, finishedAt: run.finished_at, intent: JSON.parse(run.intent_json ?? '{}'), counts: JSON.parse(run.counts_json ?? '{}'),
    queries: searches, yieldPerSource: runEfficacy(runId), rejectsByReason: rejects, timePerStage: stageTimes, ...extra };
  fs.writeFileSync(path.join(dir, `run-log-${tag}.json`), JSON.stringify(log, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'run-log.json'), JSON.stringify(log, null, 2), 'utf8');
  // Spec §11: if one reason makes up > 60% of rejects, show its counts so that rule can be reviewed.
  const rejectTotal = rejects.filter((r) => !['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER', 'NEEDS_REVIEW'].includes(r.state)).reduce((a, r) => a + r.n, 0);
  const top = rejects.find((r) => !['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER', 'NEEDS_REVIEW'].includes(r.state));
  if (top && rejectTotal >= 10 && top.n / rejectTotal > 0.6) emit(runId, 'SUMMARY', `Rule check: "${top.state}" caused ${top.n} of ${rejectTotal} rejects (${Math.round((top.n / rejectTotal) * 100)}%) — review that rule if it looks too strict.`, { state: top.state, n: top.n, total: rejectTotal });
  emit(runId, 'SUMMARY', `Results saved: ${tiers.eligible.length} eligible, ${tiers.review.length} review, ${tiers.excluded.length} excluded → ${dir}`, { dir });
  return { dir, eligible: tiers.eligible.length, review: tiers.review.length, excluded: tiers.excluded.length };
}
