// Scan orchestrator (spec §5.4, §17). One scan at a time; state persisted in search_runs so progress,
// counts and errors survive restarts. Provider errors are recorded — never treated as "no jobs".
import { getDb, j } from '../../db/db.js';
import { getProfile, getSettings } from '../../config/settings.js';
import type { SearchIntent } from '../models.js';
import { parseNaturalLanguage, type SearchMode } from './intent.js';
import { analyseJob, isDismissed, prefilter, saveJdVersion, upsertJob } from './pipeline.js';
import { emit, type Stage } from './events.js';
import { pool } from '../util/pool.js';
import { qualitySpotCheck, writeRunReport } from './report.js';
import { fetchAtsDetail, listAtsJobs, ATS_TYPES, type AtsEmployer } from '../sources/ats.js';
import { adzunaAdapter, joobleAdapter, parseResultTitle, reedAdapter, reedDetail } from '../sources/apis.js';
import { activeProviders, boardReaderAvailable, resetBoardReader, googleJobsAdapter, readBoardPosting, resolveEmployerPosting, sameJob, siteSearchAdapter, type PageRead } from '../sources/websearch.js';
import { canonicalBoardUrl, isEmployerSite, looksLikeListingPage, TEASER_BOARDS } from '../extraction/posting.js';
import { boardForUrl } from '../sources/boards.js';
import { daysBetween, htmlToText, parsePostedDate, todayLondon } from '../util/text.js';
import { GULF_QUERIES, GULF_RULES_VERSION, gulfFamilies, MARKETS, marketOfLocation, NON_GULF_PLACE } from '../gulf/markets.js';
import { discoverGulfBoards } from '../gulf/discovery.js';
import { READABLE_BOARDS } from '../sources/boards.js';
import { gradcrackerAdapter } from '../sources/gradcracker.js';
import { arbeitnowAdapter, himalayasAdapter, hnAdapter, nhsAdapter, nhsDetail } from '../sources/feeds.js';
import { aiWebSearchAdapter } from '../ai/webSearch.js';
import { aiRankShortlist } from '../ai/rank.js';
import { aiReadLinks } from '../ai/linkReader.js';
import { discoverCompanies, type CompanyCandidate } from './companies.js';
import { familyQueries } from './roles.js';
import { RULES_VERSION } from '../models.js';
import { fetchSingleAtsJob, importFromUrl } from '../extraction/jd.js';
import { parseAtsUrl } from '../sources/ats.js';
import { recordSourceResult } from '../sources/registry.js';
import { ensureEmployerForAts } from './employers.js';
import { autoDiscoverAtsBoards } from './atsDiscovery.js';
import { buildDailyBatch } from '../ranking/daily.js';
import { activeSnapshot } from '../sponsors/import.js';
import { configureHttp } from '../sources/http.js';
import type { DiscoveredJob, DiscoveryContext, DiscoveryPage, JobSourceAdapter } from '../sources/types.js';
import { hasSecret } from '../../config/secrets.js';
import { redact } from '../../config/secrets.js';

export type RunMode = 'MANUAL_FULL' | 'SCHEDULED' | 'KEYWORD' | 'RECHECK' | 'RETRY_FAILED' | 'AUTODISCOVER' | 'COMPANY_DISCOVERY';
export type Phase = 'QUEUED' | 'DISCOVERING' | 'DEDUPLICATING' | 'SPONSOR_MATCHING' | 'RETRIEVING_FULL_JD' | 'EXTRACTING_FACTS' | 'AI_ANALYSIS'
  | 'POLICY_EVALUATION' | 'RANKING' | 'SAVING_BATCH' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export interface Counts {
  links_found: number; prefilter_passed: number; prefilter_out_of_scope: number; prefilter_non_uk: number; prefilter_intent: number;
  new_jobs: number; existing_jobs: number; full_jds: number; no_full_jd: number; sponsor_verified: number; sponsor_review: number; sponsor_not_found: number;
  verified: number; potential: number; review: number; excluded: number; stale: number; ai_calls: number; ai_errors: number;
  employers_scanned: number; boards_autodiscovered: number; sponsors_probed: number; closed_detected: number;
  unchanged_skipped: number; companies_checked: number; ai_ranked: number;
  graded: number; regraded: number; listing_skipped: number; unreadable_skipped: number; board_links_resolved: number; target: number;
  too_old: number; ai_read: number; queued_ai_read: number;
  dismissed_skipped: number; known_skipped: number; expired_skipped: number; page_reads: number;
}
const zeroCounts = (): Counts => ({
  links_found: 0, prefilter_passed: 0, prefilter_out_of_scope: 0, prefilter_non_uk: 0, prefilter_intent: 0, new_jobs: 0, existing_jobs: 0,
  full_jds: 0, no_full_jd: 0, sponsor_verified: 0, sponsor_review: 0, sponsor_not_found: 0, verified: 0, potential: 0, review: 0, excluded: 0, stale: 0,
  ai_calls: 0, ai_errors: 0, employers_scanned: 0, boards_autodiscovered: 0, sponsors_probed: 0, closed_detected: 0,
  unchanged_skipped: 0, companies_checked: 0, ai_ranked: 0,
  graded: 0, regraded: 0, listing_skipped: 0, unreadable_skipped: 0, board_links_resolved: 0, target: 0,
  too_old: 0, ai_read: 0, queued_ai_read: 0, dismissed_skipped: 0, known_skipped: 0, expired_skipped: 0, page_reads: 0,
});

let running: { runId: number; cancel: boolean } | null = null;
let companyOptions: { useAi: boolean; limit: number; extra?: CompanyCandidate[] } = { useAi: true, limit: 400 };
export function currentRun() { return running; }

export function requestCancel(runId: number) {
  getDb().run('UPDATE search_runs SET cancel_requested = 1 WHERE id = ?', runId);
  if (running?.runId === runId) running.cancel = true;
}

/** Start a scan in the background. Returns the run id immediately. */
export function startScan(input: { mode: RunMode; query?: string; searchMode?: SearchMode; roleFocus?: 'BOTH' | 'INTERNSHIP' | 'GRADUATE'; scope?: 'REGISTRY' | 'BOARDS' | 'ALL' | 'GULF'; market?: 'UAE' | 'QATAR' | 'SAUDI'; companyOptions?: { useAi: boolean; limit: number; extra?: CompanyCandidate[] } }): number {
  if (running) throw new Error(`Scan #${running.runId} is already running.`);
  const db = getDb();
  const intent = parseNaturalLanguage(input.query ?? '', input.searchMode ?? 'ALL');
  intent.roleFocus = input.roleFocus ?? getSettings().role_focus;
  intent.scope = input.scope ?? (input.mode === 'COMPANY_DISCOVERY' || input.mode === 'AUTODISCOVER' ? 'REGISTRY' : 'ALL');
  const { version, profile } = getProfile();
  intent.roleQueries = familyQueries(profile.target_roles.filter((f) => intent.categories.includes(f.category)));
  if (intent.scope === 'GULF') {
    // Gulf tabs: any entry-level cyber role in the chosen country.
    intent.market = input.market ?? 'UAE';
    intent.categories = ['SOC_SECURITY', 'GRC_RISK_AUDIT'];
    intent.roleQueries = [...new Set([...(intent.keywords.length ? [intent.keywords.join(' ')] : []), ...GULF_QUERIES, ...familyQueries(gulfFamilies(profile.target_roles).filter((f) => f.custom))])];
    intent.keywords = [];
  }
  companyOptions = input.companyOptions ?? { useAi: true, limit: 400 };
  const snap = activeSnapshot();
  const r = db.run(`INSERT INTO search_runs(mode, started_at, status, phase, query, intent_json, profile_version, sponsor_snapshot_id, counts_json, errors_json, source_stats_json)
                    VALUES (?, ?, 'RUNNING', 'QUEUED', ?, ?, ?, ?, ?, '[]', '{}')`,
    input.mode, new Date().toISOString(), input.query ?? '', JSON.stringify(intent), version, snap?.id ?? null, JSON.stringify(zeroCounts()));
  const runId = r.lastInsertRowid;
  running = { runId, cancel: false };
  void runScan(runId, input.mode, intent).finally(() => { running = null; });
  return runId;
}


async function runScan(runId: number, mode: RunMode, intent: SearchIntent) {
  const db = getDb();
  const s = getSettings();
  configureHttp({ delayMs: s.per_source_delay_ms, timeoutMs: s.request_timeout_ms });
  const counts = zeroCounts();
  const errors: string[] = [];
  const sourceStats: Record<string, { links: number; jobs: number; fullJds: number; errors: number; queries: string[] }> = {};
  const stat = (id: string) => (sourceStats[id] ??= { links: 0, jobs: 0, fullJds: 0, errors: 0, queries: [] });
  let aiLeft = s.ai_max_jobs_per_run;
  let jobsLeft = s.max_jobs_per_run;
  const profileVersion = getProfile().version;
  const snapshotId = activeSnapshot()?.id ?? null;
  const resolveBudget = { left: intent.scope === 'GULF' ? 150 : 60 };
  let pageReads = 0;
  const seenTitleKeys = new Set<string>();
  const aiReadQueue = new Map<string, DiscoveredJob>();
  const canAiRead = s.ai_enabled && s.ai_read_fallback && hasSecret('openai_api_key') && s.ai_link_reads_per_run > 0;
  /** Read queued links with OpenAI (8 per call) and grade them. */
  const drainAiReadQueue = async () => {
    const items = [...aiReadQueue.values()];
    aiReadQueue.clear();
    const batches: DiscoveredJob[][] = [];
    for (let i = 0; i < items.length; i += 8) batches.push(items.slice(i, i + 8));
    let aiStopped = false;
    // Three AI reader calls at a time (each takes 30-60 s; they don't depend on each other).
    await pool(batches, 3, async (batch, bi) => {
      if (stop() || !timeLeft() || aiStopped) return;
      save('RETRIEVING_FULL_JD');
      const urlOf = (b: DiscoveredJob) => (b.boardUrl ?? b.applyUrl)!;
      emit(runId, 'AI', `AI reader: opening ${batch.length} postings (batch ${bi + 1} of ${batches.length})…`, { urls: batch.map(urlOf) });
      const r = await aiReadLinks(batch.map(urlOf));
      if (r.error) { errors.push(redact(`AI link reader: ${r.error}`)); emit(runId, 'ERROR', `AI reader: ${r.error}`); if (/budget|switched off|No OpenAI|401/.test(r.error)) { aiStopped = true; return; } }
      const got = new Map(r.results.map((x) => [x.url, x]));
      emit(runId, 'AI', `AI reader: ${r.results.length} of ${batch.length} confirmed live and read; ${batch.length - r.results.length} closed, expired or unreadable.`, { confirmed: r.results.length, batch: batch.length });
      for (const d of batch) {
        const x = got.get(urlOf(d));
        // Not opened, or the board says it's expired / no longer accepting applications → never listed.
        if (!x) { counts.unreadable_skipped++; candidateLog(null, d, 'UNREADABLE_OR_EXPIRED', ['FULL_JD_NOT_READ']); emit(runId, 'FILTER', `Dropped: AI reader found it closed/expired or couldn't open it — ${d.title}`, { url: urlOf(d), state: 'UNREADABLE_OR_EXPIRED' }); continue; }
        let next: DiscoveredJob = { ...d, aiReadText: x.text, title: d.title && d.title !== 'Untitled result' ? d.title : x.title, employer: d.employer ?? (x.company || null), location: d.location ?? (x.location || null), postedAt: x.postedAt ?? (isGulfScan ? null : d.postedAt) };
        // The posting linked to the employer's own careers/apply page: apply there (and read it directly when possible).
        if (x.employerUrl && d.applyUrlKind === 'BOARD' && isEmployerSite(x.employerUrl, next.employer)) {
          const { importFromUrl } = await import('../extraction/jd.js');
          const imp = await importFromUrl(x.employerUrl, null, { title: next.title, employer: next.employer, location: next.location ?? undefined }).catch(() => null);
          next = imp?.job?.descriptionComplete && imp.job.listingState !== 'CLOSED'
            ? { ...imp.job, market: d.market, boardUrl: urlOf(d), postedAt: imp.job.postedAt ?? next.postedAt, query: d.query }
            : { ...next, employerUrl: x.employerUrl, applyUrl: x.employerUrl, applyUrlKind: 'EMPLOYER_SITE', boardUrl: urlOf(d) };
          counts.board_links_resolved++;
        }
        await processOne(next);
      }
      save('POLICY_EVALUATION');
    });
  };
  const isGulfScan = intent.scope === 'GULF';
  resetBoardReader();
  // Tidy stored board links: keep the canonical single-posting address; links that never opened a posting are closed.
  for (const j of db.all<any>("SELECT id, apply_url, apply_url_kind, advertised_employer FROM jobs WHERE apply_url_kind IN ('BOARD', 'EMPLOYER_SITE') AND apply_url IS NOT NULL AND id NOT IN (SELECT job_id FROM applications)")) {
    let host = ''; try { host = new URL(j.apply_url).hostname; } catch { /* invalid → closed below */ }
    if (j.apply_url_kind === 'EMPLOYER_SITE' && host && !boardForUrl(j.apply_url) && !TEASER_BOARDS.test(host)) {
      // Labelled "employer careers site" but the domain isn't the employer's → it's a re-posting site.
      if (!isEmployerSite(j.apply_url, j.advertised_employer)) db.run("UPDATE jobs SET apply_url_kind = 'BOARD' WHERE id = ?", j.id);
      continue;
    }
    const canon = canonicalBoardUrl(j.apply_url);
    if (!canon) db.run('DELETE FROM jobs WHERE id = ?', j.id); // never pointed at a real posting (made-up id, search/salary/profile page)
    else if (canon !== j.apply_url) db.run('UPDATE jobs SET apply_url = ? WHERE id = ?', canon, j.id);
  }
  const target = mode === 'RECHECK' || mode === 'AUTODISCOVER' || isGulfScan ? 0 : s.min_roles_per_scan;
  const deadline = Date.now() + s.scan_time_budget_minutes * 60_000;
  const timeLeft = () => Date.now() < deadline;
  counts.target = target;
  const doRegistry = intent.scope !== 'BOARDS' && !isGulfScan;
  const doBoards = intent.scope !== 'REGISTRY';
  const t0 = Date.now();
  const save = (phase: Phase, status = 'RUNNING') => db.run('UPDATE search_runs SET phase = ?, status = ?, counts_json = ?, errors_json = ?, source_stats_json = ?, budget_json = ? WHERE id = ?',
    phase, status, JSON.stringify(counts), JSON.stringify(errors.slice(-200)), JSON.stringify(sourceStats),
    JSON.stringify({ aiJobsLeft: aiLeft, jobsLeft, elapsedMs: Date.now() - t0 }), runId);
  const stop = () => !!running?.cancel || !!db.get<any>('SELECT cancel_requested FROM search_runs WHERE id = ?', runId)?.cancel_requested;
  const candidateLog = (jobId: number | null, d: DiscoveredJob, state: string, codes: string[] = []) =>
    db.run('INSERT INTO search_run_candidates(run_id, job_id, state, reason_codes_json, title, employer, source_id, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      runId, jobId, state, JSON.stringify(codes), d.title, d.employer, d.sourceId, d.applyUrl, new Date().toISOString());

  /** Process one discovered posting through the pipeline. */
  const processOne = async (d0: DiscoveredJob, detail?: (d: DiscoveredJob) => Promise<DiscoveredJob>, force = false) => {
    if (stop() || jobsLeft <= 0) return;
    // Employer-ATS feeds return one posting per item, so only links from boards/search can be listing pages.
    const fromAts = d0.accessMode === 'PUBLIC_ATS';
    /** Scan console + efficacy record for what happened to this posting (employer-feed jobs are only shown once graded). */
    const tell = (stage: Stage, state: string | null, msg: string, x: DiscoveredJob = d0) => {
      if (fromAts && stage !== 'GRADE') return;
      if (state) candidateLog(null, x, state, []);
      emit(runId, stage, `${msg} — ${x.title}${x.employer ? ` @ ${x.employer}` : ''}`, { url: x.boardUrl ?? x.applyUrl, state, source: x.sourceId });
    };
    // The posting itself is the board copy when the apply link is the employer's (general) careers page.
    const postingUrl = (x: DiscoveredJob) => (x.boardUrl && x.applyUrlKind === 'EMPLOYER_SITE' ? x.boardUrl : x.applyUrl ?? x.boardUrl);
    if (!fromAts && looksLikeListingPage(postingUrl(d0), d0.title)) { counts.listing_skipped++; tell('FILTER', 'LISTING_PAGE', 'Dropped: a job-list page, not one posting'); return; }
    const pf = force ? { pass: true as const } : prefilter(d0, intent);
    if (!pf.pass) {
      if (pf.reason === 'OUT_OF_SCOPE' || pf.reason === 'ABOVE_ENTRY' || pf.reason === 'NATIONALS_ONLY') counts.prefilter_out_of_scope++;
      else if (pf.reason === 'NON_UK') counts.prefilter_non_uk++;
      else counts.prefilter_intent++;
      const why: Record<string, [string, string]> = {
        OUT_OF_SCOPE: ['NOT_TARGET_ROLE', 'Dropped: title is not one of your target roles'],
        ABOVE_ENTRY: ['ABOVE_ENTRY_TITLE', 'Dropped: title is above entry level (senior / lead / L2-L3 / tier 2-3 / architect)'],
        NATIONALS_ONLY: ['NATIONALS_ONLY', 'Dropped: title says nationals only'],
        NON_UK: ['WRONG_LOCATION', `Dropped: location "${d0.location ?? '?'}" is outside this search`],
        INTENT_MISMATCH: ['NOT_YOUR_SEARCH', 'Dropped: doesn\'t match your search filters'],
      };
      tell('FILTER', why[pf.reason][0], why[pf.reason][1]);
      return;
    }
    // Your posting-age window: older postings are never graded or shown.
    const posted = parsePostedDate(d0.postedAt);
    if (posted && daysBetween(posted, todayLondon()) > s.max_posting_age_days) { counts.too_old++; tell('FILTER', 'TOO_OLD', `Dropped: posted ${posted}, older than your ${s.max_posting_age_days}-day window`); return; }
    if (!posted && !s.allow_undated_postings && d0.accessMode !== 'PUBLIC_ATS') { counts.too_old++; tell('FILTER', 'TOO_OLD', 'Dropped: no posting date'); return; }
    // Jobs you removed never come back.
    if (isDismissed(d0)) { counts.dismissed_skipped++; tell('SKIP', 'DISMISSED', 'Skipped: you removed this job'); return; }
    // Spec §4: the same job found on another site in this scan (same title + company + city) is not read twice.
    if (!fromAts && d0.employer) {
      const k = `${d0.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${d0.employer.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(d0.location ?? '').toLowerCase().split(/[,-]/)[0].trim()}`;
      if (seenTitleKeys.has(k)) { tell('SKIP', null, 'Duplicate of a posting already checked in this scan (another site)'); return; }
      seenTitleKeys.add(k);
    }
    // Efficiency: a board posting graded in the last 3 days is not re-read (no search/AI/page-read spent on it).
    const knownUrl = !fromAts && !force ? (d0.boardUrl ?? d0.applyUrl) : null;
    if (knownUrl) {
      const known = db.get<any>(`SELECT j.id FROM jobs j WHERE j.listing_state = 'OPEN' AND j.last_seen_at >= ? AND (j.apply_url = ? OR j.id IN (SELECT job_id FROM source_jobs WHERE board_url = ?))
        AND EXISTS (SELECT 1 FROM job_decisions d WHERE d.job_id = j.id AND d.active = 1 AND d.rules_version IN (?, ?)) LIMIT 1`,
        new Date(Date.now() - 3 * 86400000).toISOString(), knownUrl, knownUrl, RULES_VERSION, GULF_RULES_VERSION);
      if (known) { db.run('UPDATE jobs SET last_seen_at = ? WHERE id = ?', new Date().toISOString(), known.id); counts.known_skipped++; tell('SKIP', null, 'Already graded in the last 3 days — not re-read'); return; }
    }
    counts.prefilter_passed++;
    let d = d0;
    if (!d.descriptionComplete && detail) {
      try { d = await detail(d0); } catch (e) { errors.push(redact(`Detail fetch failed for ${d0.title}: ${(e as Error).message}`)); }
    }
    // Open the board posting itself (Jina page reader): drop expired ones, read the full JD, and take the employer's
    // own apply/careers link from the page — no extra searches needed.
    const boardLink = d.boardUrl ?? (d.applyUrlKind === 'BOARD' ? d.applyUrl : null);
    if (!d.descriptionComplete && boardLink && !d0.aiReadText && pageReads < s.board_page_reads_per_run && boardReaderAvailable()) {
      pageReads++;
      const pr = await readBoardPosting(boardLink).catch((e) => ({ ok: false, error: (e as Error).message } as PageRead));
      if (!pr.ok && pr.error && !pr.wall && !boardReaderAvailable()) { errors.push(redact(pr.error)); emit(runId, 'ERROR', pr.error); }
      if (pr.ok && pr.expired) {
        counts.expired_skipped++;
        db.run("UPDATE jobs SET listing_state = 'CLOSED' WHERE apply_url = ? OR id IN (SELECT job_id FROM source_jobs WHERE board_url = ?)", boardLink, boardLink);
        tell('OPEN', 'EXPIRED', 'Opened page: closed / no longer accepting applications', d);
        return;
      }
      if (!pr.ok) tell('OPEN', null, `Opened page: ${pr.wall ? 'blocked by the site' : pr.error ?? 'no posting text'} → will try the employer site / AI reader`, d);
      if (pr.ok && pr.text) {
        counts.page_reads++;
        tell('OPEN', null, `Opened page: live posting, ${pr.text.length} chars${pr.postedAt ? `, posted ${pr.postedAt}` : ', no date shown'}${pr.employerLinks?.length ? `, ${pr.employerLinks.length} employer link(s)` : ''}`, d);
        // The page's own title is complete (search titles are cut off with "…"): take title, company and location from it.
        const parsed = pr.title ? parseResultTitle(htmlToText(pr.title), boardForUrl(boardLink)) : null;
        if (parsed?.title && (/\.\.\.|…|^untitled/i.test(d.title) || !d.title)) d = { ...d, title: parsed.title };
        // The page title's company wins over a search snippet's truncated / garbled one ("Job in Dubai, UAE by Al …").
        if (parsed?.employer && (!d.employer || /\.\.\.|…|^jobs? in\b/i.test(d.employer))) d = { ...d, employer: parsed.employer };
        if (parsed?.location && !d.location) d = { ...d, location: parsed.location };
        if (isGulfScan) {
          const m = marketOfLocation(d.location) ?? marketOfLocation(pr.text.slice(0, 1200));
          if ((m && m !== intent.market) || (!m && NON_GULF_PLACE.test(`${d.title} ${d.location ?? ''} ${pr.text.slice(0, 600)}`))) { counts.prefilter_non_uk++; tell('FILTER', 'WRONG_LOCATION', `Dropped: the page shows it is in ${d.location ?? 'another country'}`, d); return; }
          if (m && !d.location) d = { ...d, location: MARKETS[m].name };
        }
        // The page's own date wins: a search engine's date is often when it crawled the page, not when the job was posted.
        const postedAt = pr.postedAt ?? (isGulfScan ? null : d.postedAt) ?? null;
        const p = parsePostedDate(postedAt);
        if (p && daysBetween(p, todayLondon()) > s.max_posting_age_days) { counts.too_old++; tell('FILTER', 'TOO_OLD', `Dropped: page says posted ${p}, older than your window`, d); return; }
        // Gulf: no date on the page → let the AI reader confirm it is live and when it was posted.
        const needsAiDate = isGulfScan && !p && canAiRead;
        d = { ...d, postedAt, descriptionText: pr.text, descriptionComplete: !needsAiDate && pr.text.length > 400, extractionMethod: 'board_page_read', boardUrl: boardLink };
        for (const link of (pr.employerLinks ?? []).filter((l) => isEmployerSite(l, d.employer))) {
          const ats = parseAtsUrl(link);
          const { fetchSingleAtsJob, importFromUrl } = await import('../extraction/jd.js');
          const full = ats?.jobId ? await fetchSingleAtsJob(ats.ats, ats.token, ats.jobId, link).catch(() => null)
            : (await importFromUrl(link, null, { title: d.title, employer: d.employer, location: d.location ?? undefined }).catch(() => null))?.job ?? null;
          if (full?.listingState === 'CLOSED') { counts.expired_skipped++; tell('CAREERS', 'EXPIRED', `Employer page says the job is closed (${link})`, d); return; }
          if (full?.descriptionComplete && sameJob(d.title, full.title)) { d = { ...full, employer: d.employer ?? full.employer, market: d.market, boardUrl: boardLink, postedAt: full.postedAt ?? postedAt, query: d.query }; counts.board_links_resolved++; tell('CAREERS', null, `Employer careers posting found and read: ${link}`, d); break; }
          // Employer apply page found but not readable as a posting: still apply there.
          if (d.applyUrlKind === 'BOARD') { d = { ...d, employerUrl: link, applyUrl: link, applyUrlKind: ats ? 'EMPLOYER_ATS' : 'EMPLOYER_SITE' }; counts.board_links_resolved++; tell('CAREERS', null, `Employer apply page found: ${link}`, d); }
        }
      }
    }
    // A board teaser (LinkedIn/Indeed/Glassdoor/snippet) is never graded: find the employer's own posting first.
    // Gulf: even a complete board copy (e.g. Google Jobs → Indeed) is looked up on the employer's careers site, so you apply there.
    const boardOnly = d.applyUrlKind === 'BOARD';
    if ((!d.descriptionComplete || (isGulfScan && boardOnly)) && s.resolve_board_links && !d0.aiReadText) { // AI-read jobs were already looked up before queueing
      const resolved = await resolveEmployerPosting(d, resolveBudget).catch(() => null);
      if (resolved?.descriptionComplete) { d = resolved; counts.board_links_resolved++; tell('CAREERS', null, `Searched the employer's careers site: same job found and read (${resolved.applyUrl})`, d); }
      else if (resolved?.employerUrl) {
        // Careers page found but the app can't read it: apply there; the board copy is still used to read the JD.
        const careers = { employerUrl: resolved.employerUrl, applyUrl: resolved.employerUrl, applyUrlKind: 'EMPLOYER_SITE' as const, boardUrl: d0.boardUrl ?? d0.applyUrl };
        d = { ...d, ...careers }; d0 = { ...d0, ...careers }; counts.board_links_resolved++;
        tell('CAREERS', null, `Searched the employer's careers site: apply page found (${resolved.employerUrl})`, d);
      } else if (boardOnly && d.employer) tell('CAREERS', null, 'No employer careers page found — will list the job-board posting', d);
    }
    // Last resort: the posting was opened and quoted back by OpenAI web search (clearly labelled on the job).
    if (!d.descriptionComplete && s.ai_read_fallback && d0.aiReadText) {
      d = { ...d, descriptionText: d0.aiReadText, descriptionComplete: true, extractionMethod: 'ai_web_read', accessMode: 'SEARCH_INDEX_DISCOVERY' };
      counts.ai_read++;
    }
    // Queue single postings the app can't open (LinkedIn, Bayt, Indeed…) for the AI link reader.
    const readUrl = d0.boardUrl ?? d0.applyUrl;
    if (!d.descriptionComplete && canAiRead && !d0.aiReadText && aiReadQueue.size < s.ai_link_reads_per_run && readUrl && !looksLikeListingPage(readUrl, d0.title)) {
      if (!aiReadQueue.has(readUrl)) { aiReadQueue.set(readUrl, d0); counts.queued_ai_read++; tell('AI', null, `Queued for the AI reader (${aiReadQueue.size}/${s.ai_link_reads_per_run}) to confirm it is live and read it`, d); }
      return;
    }
    // Gulf board-only postings (no employer careers page) must show a posted date — undated Indeed/LinkedIn copies are often long expired.
    if (isGulfScan && d.applyUrlKind === 'BOARD' && !parsePostedDate(d.postedAt)) { counts.too_old++; tell('FILTER', 'UNDATED_BOARD_POSTING', 'Dropped: job-board posting with no posting date', d); return; }
    if (!d.descriptionComplete) { counts.unreadable_skipped++; tell('FILTER', 'UNREADABLE', 'Dropped: the full posting could not be read', d); return; }
    if (!fromAts && d.accessMode !== 'PUBLIC_ATS' && d.listingState !== 'CLOSED' && looksLikeListingPage(postingUrl(d), d.title)) { counts.listing_skipped++; tell('FILTER', 'LISTING_PAGE', 'Dropped: a job-list page, not one posting', d); return; }
    if (d !== d0 && isDismissed(d)) { counts.dismissed_skipped++; tell('SKIP', 'DISMISSED', 'Skipped: you removed this job', d); return; }
    // Final age check on the posting actually read (the employer/ATS copy may carry an older date than the search result).
    const finalPosted = parsePostedDate(d.postedAt);
    if (finalPosted && daysBetween(finalPosted, todayLondon()) > s.max_posting_age_days) { counts.too_old++; tell('FILTER', 'TOO_OLD', `Dropped: posted ${finalPosted}, older than your window`, d); return; }
    jobsLeft--;
    counts.graded++;
    const { jobId, isNew } = upsertJob(d, runId);
    if (isNew) counts.new_jobs++; else counts.existing_jobs++;
    const v = saveJdVersion(jobId, d);
    if (d.descriptionComplete) { counts.full_jds++; stat(d.sourceId).fullJds++; } else counts.no_full_jd++;
    // Efficiency: a known job whose JD, rules, profile and register snapshot are unchanged keeps its decision.
    if (!isNew && !v.changed) {
      const prev = db.get<any>('SELECT d.status, d.rules_version, d.profile_version, d.sponsor_snapshot_id, j.listing_state FROM job_decisions d JOIN jobs j ON j.id = d.job_id WHERE d.job_id = ? AND d.active = 1', jobId);
      if (prev && prev.rules_version === RULES_VERSION && prev.profile_version === profileVersion && prev.sponsor_snapshot_id === snapshotId && prev.listing_state === 'OPEN') {
        counts.unchanged_skipped++;
        candidateLog(jobId, d, prev.status, ['UNCHANGED']);
        emit(runId, 'GRADE', `Unchanged since last grading (${prev.status}) — ${d.title}${d.employer ? ` @ ${d.employer}` : ''}`, { jobId, status: prev.status, unchanged: true });
        ({ VERIFIED_COMPATIBLE: () => counts.verified++, POTENTIAL_NO_STATED_BLOCKER: () => counts.potential++, NEEDS_REVIEW: () => counts.review++, EXCLUDED: () => counts.excluded++, STALE: () => counts.stale++ } as Record<string, () => number>)[prev.status]?.();
        return;
      }
    }
    const allowAi = aiLeft > 0;
    const r = await analyseJob(jobId, { allowAi, runId, intent });
    if (r.aiUsed && allowAi) { aiLeft--; counts.ai_calls++; }
    if (r.aiError && r.aiError !== 'AI disabled' && r.aiError !== 'No API key') counts.ai_errors++;
    if (r.reasons.includes('SPONSOR_NOT_FOUND')) counts.sponsor_not_found++;
    else if (r.reasons.some((c) => ['SPONSOR_AMBIGUOUS', 'ACTUAL_EMPLOYER_UNKNOWN'].includes(c))) counts.sponsor_review++;
    else counts.sponsor_verified++;
    ({ VERIFIED_COMPATIBLE: () => counts.verified++, POTENTIAL_NO_STATED_BLOCKER: () => counts.potential++, NEEDS_REVIEW: () => counts.review++, EXCLUDED: () => counts.excluded++, STALE: () => counts.stale++ } as Record<string, () => number>)[r.status]?.();
    candidateLog(jobId, d, r.status, r.reasons);
    const label = ({ VERIFIED_COMPATIBLE: 'ELIGIBLE (verified)', POTENTIAL_NO_STATED_BLOCKER: 'ELIGIBLE', NEEDS_REVIEW: 'NEEDS REVIEW', EXCLUDED: 'EXCLUDED', STALE: 'CLOSED' } as Record<string, string>)[r.status] ?? r.status;
    emit(runId, 'GRADE', `${label}${r.reasons.length ? ` [${r.reasons.slice(0, 3).join(', ')}]` : ''} — ${d.title}${d.employer ? ` @ ${d.employer}` : ''}${r.aiUsed ? ' (AI read the JD)' : ''}`,
      { jobId, status: r.status, reasons: r.reasons, url: d.applyUrl, apply: d.applyUrlKind, source: d.sourceId });
  };

  emit(runId, 'PLAN', `Scan #${runId} started: ${isGulfScan ? `Gulf · ${intent.market}` : intent.scope === 'REGISTRY' ? 'sponsor careers pages' : intent.scope === 'BOARDS' ? 'job boards' : 'everything'} · window ${s.max_posting_age_days} days · up to ${isGulfScan ? s.gulf_web_queries_per_run : s.web_queries_per_run} web searches, ${s.board_page_reads_per_run} page reads, ${s.ai_link_reads_per_run} AI reads · time limit ${s.scan_time_budget_minutes} min.`,
    { scope: intent.scope, market: intent.market ?? null, windowDays: s.max_posting_age_days, providers: activeProviders(), dataforseo: hasSecret('dataforseo_login') && hasSecret('dataforseo_password'), jina: hasSecret('jina_api_key'), serpapi: hasSecret('serpapi_api_key'), openai: hasSecret('openai_api_key') });
  try {
    // ------------------------------------------------------------- RECHECK saved/applied/batch jobs
    if (mode === 'RECHECK') {
      save('RETRIEVING_FULL_JD');
      const rows = db.all<any>(`SELECT DISTINCT j.* FROM jobs j WHERE j.id IN (SELECT job_id FROM applications) OR j.id IN (SELECT job_id FROM daily_batch_jobs WHERE removed_at IS NULL)`);
      for (const job of rows) {
        if (stop()) break;
        const ref = job.apply_url ? parseAtsUrl(job.apply_url) : null;
        if (ref?.jobId) {
          const fresh = await fetchSingleAtsJob(ref.ats, ref.token, ref.jobId, job.apply_url);
          if (fresh) {
            if (fresh.listingState === 'CLOSED') { db.run("UPDATE jobs SET listing_state = 'CLOSED' WHERE id = ?", job.id); counts.closed_detected++; }
            else { const v = saveJdVersion(job.id, fresh); if (v.changed) db.run('INSERT INTO alerts(at, kind, job_id, message) VALUES (?, ?, ?, ?)', new Date().toISOString(), 'JD_CHANGED', job.id, `The job description for "${job.title}" changed; re-assessed.`); }
          }
        }
        const r = await analyseJob(job.id, { allowAi: aiLeft-- > 0, runId });
        if (r.status === 'STALE') counts.stale++;
      }
      save('COMPLETED', 'COMPLETED');
      return finish(runId, 'COMPLETED');
    }

    // ------------------------------------------------------------- TRACK B0: company lists (fintech/startups, AI-generated)
    if (mode === 'COMPANY_DISCOVERY') {
      save('DISCOVERING');
      try {
        const cd = await discoverCompanies({ useAi: companyOptions.useAi, limit: companyOptions.limit, extra: companyOptions.extra, shouldStop: stop });
        counts.companies_checked += cd.checked;
        counts.boards_autodiscovered += cd.boardsFound;
        errors.push(...cd.errors.slice(0, 20));
      } catch (e) { errors.push(redact(`Company discovery: ${(e as Error).message}`)); }
      save('DISCOVERING');
    }

    // ------------------------------------------------------------- TRACK B: register → ATS auto-discovery
    if (doRegistry && (mode === 'AUTODISCOVER' || ((mode === 'MANUAL_FULL' || mode === 'SCHEDULED') && s.ats_autodiscover_per_run > 0))) {
      save('DISCOVERING');
      try {
        const ad = await autoDiscoverAtsBoards({ maxSponsors: mode === 'AUTODISCOVER' ? Math.max(s.ats_autodiscover_per_run, 150) : s.ats_autodiscover_per_run, shouldStop: stop });
        counts.sponsors_probed += ad.probedSponsors;
        counts.boards_autodiscovered += ad.boardsFound.length;
      } catch (e) { errors.push(redact(`ATS auto-discovery: ${(e as Error).message}`)); }
      save('DISCOVERING');
    }

    // ------------------------------------------------------------- TRACK B: scan tracked employers' public ATS boards
    const scannedEmployers = new Set<number>();
    const employerRows = (ignoreSchedule: boolean, limit: number) => db.all<any>(`SELECT e.* FROM employers e
          WHERE e.enabled = 1 AND e.ats_type IN (${ATS_TYPES.map(() => '?').join(',')})
            AND e.id NOT IN (SELECT employer_id FROM employer_sponsor_matches WHERE active = 1 AND status = 'NOT_SPONSOR')
            ${mode === 'RETRY_FAILED' ? 'AND e.failure_count > 0' : ''}
            ${ignoreSchedule ? '' : 'AND (e.next_check_at IS NULL OR e.next_check_at <= ?)'}
          ORDER BY CASE WHEN e.last_checked_at IS NULL THEN 0 ELSE 1 END, e.last_checked_at ASC, e.priority DESC
          LIMIT ?`, ...ATS_TYPES, ...(ignoreSchedule ? [] : [new Date().toISOString()]), limit).filter((e) => !scannedEmployers.has(e.id));
    const enough = () => target > 0 && counts.graded + counts.regraded >= target;
    const scanEmployers = (emps: any[]) => pool(emps, s.global_concurrency, async (e: any) => {
        if (stop() || enough() || !timeLeft()) return;
        scannedEmployers.add(e.id);
        const emp: AtsEmployer = { id: e.id, canonical_name: e.canonical_name, ats_type: e.ats_type, ats_token: e.ats_token };
        const listing = await listAtsJobs(emp);
        const st = stat(`ats_${e.ats_type}`);
        counts.employers_scanned++;
        if (!listing.ok) {
          st.errors++;
          errors.push(`${e.canonical_name} (${e.ats_type}/${e.ats_token}): ${listing.error}`);
          const fails = (e.failure_count ?? 0) + 1;
          db.run('UPDATE employers SET failure_count = ?, last_error = ?, last_checked_at = ?, next_check_at = ? WHERE id = ?',
            fails, listing.error, new Date().toISOString(), new Date(Date.now() + Math.min(7, 2 ** fails) * 86400000 / 4).toISOString(), e.id);
          recordSourceResult(`ats_${e.ats_type}`, { ok: false, error: `${e.canonical_name}: ${listing.error}` });
          return;
        }
        st.links += listing.jobs.length; counts.links_found += listing.jobs.length;
        emit(runId, 'SOURCE', `Employer board: ${e.canonical_name} (${e.ats_type}) lists ${listing.jobs.length} open jobs — checking titles and locations.`, { employer: e.canonical_name, ats: e.ats_type, jobs: listing.jobs.length });
        recordSourceResult(`ats_${e.ats_type}`, { ok: true, status: 'CONNECTED', links: listing.jobs.length });
        let newJobs = 0;
        // Some ATS feeds repeat a posting once per office location — grade each posting once.
        const uniq = new Map<string, DiscoveredJob>();
        for (const x of listing.jobs) if (!uniq.has(x.sourceJobId ?? x.applyUrl ?? x.title)) uniq.set(x.sourceJobId ?? x.applyUrl ?? x.title, x);
        for (const d of uniq.values()) {
          const before = counts.new_jobs;
          await processOne(d, listing.needsDetail ? (x) => fetchAtsDetail(emp, x) : undefined);
          if (counts.new_jobs > before) newJobs++;
          st.jobs++;
        }
        // Jobs from this board that disappeared from the listing are closed.
        const liveIds = new Set(listing.jobs.map((x) => x.sourceJobId));
        const stored = db.all<any>("SELECT id, source_job_id FROM jobs WHERE employer_id = ? AND source_id = ? AND listing_state = 'OPEN'", e.id, `ats_${e.ats_type}`);
        for (const sj of stored) if (!liveIds.has(sj.source_job_id)) {
          db.run("UPDATE jobs SET listing_state = 'CLOSED' WHERE id = ?", sj.id); counts.closed_detected++;
          await analyseJob(sj.id, { allowAi: false });
        }
        db.run('UPDATE employers SET last_checked_at = ?, last_new_jobs = ?, total_jobs_seen = total_jobs_seen + ?, failure_count = 0, last_error = NULL, next_check_at = ?, discovery_status = ? WHERE id = ?',
          new Date().toISOString(), newJobs, listing.jobs.length, new Date(Date.now() + 20 * 3600_000).toISOString(), 'ACTIVE', e.id);
        save('POLICY_EVALUATION');
      });
    if (doRegistry) {
      save('DISCOVERING');
      await scanEmployers(employerRows(false, mode === 'KEYWORD' ? 1000 : s.max_employers_per_run));
    }

    // ------------------------------------------------------------- TRACK A: role-first APIs + search provider
    if (doBoards && !stop()) {
      save('DISCOVERING');
      const budget = { queriesLeft: s.search_max_queries_per_run + 12 };
      const ctx: DiscoveryContext = { runId, shouldStop: stop, budget, log: (stage, msg, data) => emit(runId, stage, msg, data) };
      const adapters: Array<[JobSourceAdapter, boolean]> = [
        [reedAdapter, hasSecret('reed_api_key')],
        [adzunaAdapter, hasSecret('adzuna_app_id') && hasSecret('adzuna_app_key')],
        [joobleAdapter, hasSecret('jooble_api_key')],
        [googleJobsAdapter, hasSecret('serpapi_api_key')],
        [siteSearchAdapter, activeProviders().length > 0],
        [gradcrackerAdapter, s.enabled_sources.gradcracker_reader === true],
        [nhsAdapter, true], [arbeitnowAdapter, true], [himalayasAdapter, true], [hnAdapter, true],
        [aiWebSearchAdapter, s.ai_web_search_enabled && hasSecret('openai_api_key')],
      ];
      const GULF_CAPABLE = new Set(['jooble', 'google_jobs', 'web_search', 'ai_web_search']);
      // Gulf: highest-yield sources first (full postings), snippet sources last.
      const GULF_ORDER = ['google_jobs', 'web_search', 'jooble', 'ai_web_search'];
      if (isGulfScan) adapters.sort((a, b) => GULF_ORDER.indexOf(a[0].id) - GULF_ORDER.indexOf(b[0].id));
      // The AI web search takes minutes: start it now, in parallel, and grade its results after the fast sources.
      const aiEntry = adapters.find(([a]) => a.id === 'ai_web_search');
      const aiOn = !!aiEntry?.[1] && s.enabled_sources.ai_web_search !== false;
      const aiPage = aiOn ? aiWebSearchAdapter.discover!(intent, ctx).catch((e) => ({ jobs: [], linksFound: 0, queries: [], errors: [redact(`AI web search: ${(e as Error).message}`)] } as DiscoveryPage)) : null;
      for (const [a, configured] of adapters) {
        if (stop()) break;
        if (isGulfScan && !GULF_CAPABLE.has(a.id)) continue;
        if (!configured || (a.id !== 'gradcracker_reader' && s.enabled_sources[a.id] === false)) continue;
        try {
          emit(runId, 'SOURCE', `Source: ${a.displayName} — ${a.id === 'ai_web_search' && aiPage ? 'collecting results of the background AI search' : 'searching…'}`, { source: a.id });
          const page = a.id === 'ai_web_search' && aiPage ? await aiPage : await a.discover!(intent, ctx);
          emit(runId, 'SOURCE', `Source: ${a.displayName} returned ${page.linksFound} links → ${page.jobs.length} postings to check${page.errors.length ? ` (${page.errors.length} errors)` : ''}.`, { source: a.id, links: page.linksFound, jobs: page.jobs.length, errors: page.errors.slice(0, 5) });
          const st = stat(a.id);
          st.links += page.linksFound; st.queries.push(...page.queries); st.errors += page.errors.length;
          counts.links_found += page.linksFound;
          errors.push(...page.errors);
          recordSourceResult(a.id, { ok: page.errors.length === 0 || page.linksFound > 0, status: page.errors.length && !page.linksFound ? 'ERROR' : 'CONNECTED', error: page.errors[0] ?? null, links: page.linksFound });
          // Postings are checked 4 at a time (opening pages, careers lookups and grading are mostly waiting on the network).
          save('RETRIEVING_FULL_JD');
          await pool(page.jobs, Math.max(1, s.global_concurrency), async (d0) => {
            if (stop()) return;
            let d = d0;
            // Search/aggregator links that point at a public ATS posting are resolved via the official ATS API.
            const ats = d.applyUrl ? parseAtsUrl(d.applyUrl) : null;
            if (ats?.jobId) {
              const full = await fetchSingleAtsJob(ats.ats, ats.token, ats.jobId, d.applyUrl!);
              if (full) {
                const empId = ensureEmployerForAts(ats.ats, ats.token, d.employer ?? full.employer);
                const empName = db.get<any>('SELECT canonical_name FROM employers WHERE id = ?', empId)?.canonical_name;
                d = { ...full, employerId: empId, employer: empName ?? full.employer, query: d.query, boardUrl: d.boardUrl };
              }
            }
            const detail = d.sourceId === 'reed' ? reedDetail : d.sourceId === 'nhs_jobs' ? nhsDetail
              : (d.sourceId === 'ai_web_search' && d.applyUrlKind === 'EMPLOYER_SITE') || READABLE_BOARDS.has(d.sourceId)
                ? async (x: DiscoveredJob) => (await importFromUrl(x.applyUrl!, null, { title: x.title, employer: x.employer ?? undefined, location: x.location ?? undefined })).job ?? x
                : undefined;
            await processOne(d, detail);
            st.jobs++;
            if (st.jobs % 10 === 0) save('POLICY_EVALUATION');
          });
        } catch (e) {
          errors.push(redact(`${a.displayName}: ${(e as Error).message}`));
          recordSourceResult(a.id, { ok: false, status: 'ERROR', error: (e as Error).message });
        }
      }
    }

    if (stop()) { save('CANCELLED', 'CANCELLED'); return finish(runId, 'CANCELLED'); }
    // ------------------------------------------------------------- AI link reader for postings the app couldn't open itself
    if (aiReadQueue.size && !stop()) await drainAiReadQueue();

    // ------------------------------------------------------------- GULF: careers boards of Gulf employers (after the high-yield searches)
    if (isGulfScan && !stop()) {
      save('DISCOVERING');
      try { const g = await discoverGulfBoards({ shouldStop: stop }); counts.companies_checked += g.checked; counts.boards_autodiscovered += g.found; }
      catch (e) { errors.push(redact(`Gulf careers boards: ${(e as Error).message}`)); }
      const gulfEmps = db.all<any>(`SELECT e.* FROM employers e WHERE e.enabled = 1 AND e.ats_type IN (${ATS_TYPES.map(() => '?').join(',')})
          AND (e.sector = 'Gulf' OR e.id IN (SELECT DISTINCT employer_id FROM jobs WHERE market != 'UK' AND employer_id IS NOT NULL)) LIMIT 300`, ...ATS_TYPES);
      await scanEmployers(gulfEmps);
    }

    // ------------------------------------------------------------- TOP-UP: reach your target of graded roles (default 150)
    if (target > 0 && !stop()) {
      // Move FORWARD through the register: check the next sponsors nobody has checked yet, then scan only the new
      // careers pages they lead to. Pages already scanned in the last 20 hours are never re-scanned here.
      for (let round = 0; doRegistry && round < 8 && !enough() && timeLeft() && !stop(); round++) {
        save('DISCOVERING');
        let probed = 0;
        try {
          const ad = await autoDiscoverAtsBoards({ maxSponsors: 150, shouldStop: () => stop() || !timeLeft() });
          probed = ad.probedSponsors;
          counts.sponsors_probed += ad.probedSponsors; counts.boards_autodiscovered += ad.boardsFound.length;
        } catch (e) { errors.push(redact(`ATS auto-discovery: ${(e as Error).message}`)); }
        await scanEmployers(employerRows(false, 200));
        if (probed === 0) break; // every sponsor has been checked recently
      }
      if (!enough() && timeLeft()) {
        // Re-grade stored open postings (full JD already read) with your CURRENT rules until the target is met.
        save('POLICY_EVALUATION');
        const groupSql = intent.scope === 'REGISTRY' ? "AND j.source_id LIKE 'ats\\_%' ESCAPE '\\'" : intent.scope === 'BOARDS' ? "AND j.source_id NOT LIKE 'ats\\_%' ESCAPE '\\'" : '';
        const rows = db.all<any>(`SELECT j.id FROM jobs j JOIN job_description_versions v ON v.job_id = j.id AND v.active = 1 AND v.complete = 1
            WHERE j.listing_state = 'OPEN' AND j.is_demo = 0 AND j.current_status != 'STALE' ${groupSql}
              AND j.id NOT IN (SELECT job_id FROM search_run_candidates WHERE run_id = ? AND job_id IS NOT NULL)
            ORDER BY j.last_checked_at ASC LIMIT ?`, runId, Math.max(0, target - counts.graded - counts.regraded));
        for (const { id } of rows) {
          if (stop() || !timeLeft()) break;
          const r = await analyseJob(id, { allowAi: aiLeft > 0, runId });
          if (r.aiUsed) { aiLeft--; counts.ai_calls++; }
          counts.regraded++;
        }
      }
      save('RANKING');
    }

    save('RANKING');
    // AI triage ranking of the eligible shortlist (only if you enabled AI and saved a key).
    if (s.ai_enabled && s.ai_rank_after_scan && hasSecret('openai_api_key')) {
      try { const rr = await aiRankShortlist({ limit: s.ai_rank_limit, shouldStop: stop }); counts.ai_ranked += rr.ranked; errors.push(...rr.errors.slice(0, 5)); } catch (e) { errors.push(redact(`AI ranking: ${(e as Error).message}`)); }
    }
    // Every scan refills today's Daily 15 (only empty slots — your current picks are kept).
    if (mode !== 'AUTODISCOVER') {
      save('SAVING_BATCH');
      try { const d = buildDailyBatch(); emit(runId, 'SUMMARY', `Daily 15 updated: ${d.message}`, { daily: d }); } catch (e) { emit(runId, 'ERROR', `Daily 15 not updated: ${(e as Error).message}`); }
    }
    // Spec §11: re-open random Eligible jobs to confirm they are live; then §10: save CSVs + run-log.json.
    let quality: unknown = null;
    if (s.quality_spot_checks > 0 && !stop()) {
      try { quality = await qualitySpotCheck(runId, s.quality_spot_checks); } catch (e) { emit(runId, 'ERROR', `Quality check failed: ${(e as Error).message}`); }
    }
    const final = errors.length && counts.links_found === 0 ? 'FAILED' : errors.length ? 'PARTIAL' : 'COMPLETED';
    emit(runId, 'SUMMARY', `Scan finished in ${Math.round((Date.now() - t0) / 1000)}s: ${counts.links_found} links seen → ${counts.prefilter_passed} worth checking → ${counts.page_reads} pages opened, ${counts.ai_read} read by AI, ${counts.expired_skipped + counts.unreadable_skipped} closed/unreadable, ${counts.too_old} too old → ${counts.graded} graded: ${counts.verified + counts.potential} eligible, ${counts.review} review, ${counts.excluded} excluded.`,
      { counts, seconds: Math.round((Date.now() - t0) / 1000), errors: errors.length });
    try { writeRunReport(runId, { qualityCheck: quality, errors: errors.slice(0, 100) }); } catch (e) { emit(runId, 'ERROR', `Could not save results files: ${(e as Error).message}`); }
    save(final as Phase, final);
    finish(runId, final);
  } catch (e) {
    errors.push(redact(`Fatal: ${(e as Error).message}`));
    save('FAILED', 'FAILED');
    finish(runId, 'FAILED');
  }
}

function finish(runId: number, status: string) {
  getDb().run('UPDATE search_runs SET finished_at = ?, status = ?, phase = ? WHERE id = ?', new Date().toISOString(), status, status, runId);
}

export function getRun(runId: number) {
  const r = getDb().get<any>('SELECT * FROM search_runs WHERE id = ?', runId);
  if (!r) return null;
  return { ...r, counts: j(r.counts_json, {}), errors: j(r.errors_json, []), sourceStats: j(r.source_stats_json, {}), intent: j(r.intent_json, {}), budget: j(r.budget_json, {}) };
}

/** Mark runs left RUNNING by a crash/close as interrupted (state persisted between restarts). */
export function recoverInterruptedRuns(): { mode: RunMode; query: string; intent: any } | null {
  const last = getDb().get<any>("SELECT mode, query, intent_json, started_at FROM search_runs WHERE status = 'RUNNING' ORDER BY id DESC LIMIT 1");
  getDb().run("UPDATE search_runs SET status = 'PARTIAL', phase = 'PARTIAL', finished_at = COALESCE(finished_at, ?), errors_json = json_insert(COALESCE(errors_json,'[]'), '$[#]', 'Interrupted: the app was closed during this scan.') WHERE status = 'RUNNING'", new Date().toISOString());
  if (!last || Date.now() - Date.parse(last.started_at) > 12 * 3600_000) return null;
  return { mode: last.mode, query: last.query ?? '', intent: j(last.intent_json, {}) };
}
