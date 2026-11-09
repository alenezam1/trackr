// Allow-listed, input-validated local API. Every route is declared here; nothing else is reachable.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { dataDir, getDb, j } from './db/db.js';
import { getProfile, getSettings, saveProfile, saveSettings, AppSettingsSchema } from './config/settings.js';
import { deleteSecret, hasSecret, setSecret, SECRET_NAMES, type SecretName } from './config/secrets.js';
import { activeSnapshot, importSponsorCsv } from './core/sponsors/import.js';
import { refreshFromOfficial } from './core/sponsors/refresh.js';
import { searchSponsors, proposeCandidates } from './core/sponsors/match.js';
import { addEmployer, confirmEmployerMatch, listEmployers, markEmployerNotSponsor, proposeAllMatches, setEmployerEnabled } from './core/discovery/employers.js';
import { autoDiscoveryStats, registerProgress } from './core/discovery/atsDiscovery.js';
import { allAdapters, verifySource } from './core/sources/registry.js';
import { googleQueryLinks } from './core/sources/apis.js';
import { parseNaturalLanguage, SEARCH_MODES, type SearchMode } from './core/discovery/intent.js';
import { currentRun, getRun, requestCancel, startScan, type RunMode } from './core/discovery/scan.js';
import { scheduleStatus } from './core/discovery/scheduler.js';
import { listEvents, runEfficacy } from './core/discovery/events.js';
import { analyseJob, dismissJob, reevaluateAll, saveJdVersion, upsertJob } from './core/discovery/pipeline.js';
import { importFromUrl } from './core/extraction/jd.js';
import { ensureEmployerForAts } from './core/discovery/employers.js';
import { addToBatch, buildDailyBatch, getOrCreateBatch, removeFromBatch, summarise } from './core/ranking/daily.js';
import { backupNow, exportApplications, feedback, filterTrace, importApplicationsCsv, jobDetail, jobSummaryRow, listApplications, listBackups, listJobs, setStage, updateApplication } from './core/tracker/tracker.js';
import { AI_DATA_DISCLOSURE, spentTodayUsd, testApiKey } from './core/ai/openai.js';
import { permissionView } from './core/eligibility/permission.js';
import { APPLICATION_STAGES, REASON_CODES } from './core/models.js';
import { todayLondon, isSafeHttpUrl } from './core/util/text.js';
import { exactKey } from './core/sponsors/normalize.js';
import { companySummary } from './core/discovery/companies.js';
import { MARKETS } from './core/gulf/markets.js';
import { aiRankShortlist } from './core/ai/rank.js';
import { DEFAULT_ROLE_FAMILIES } from './core/discovery/roles.js';
import { JOB_BOARDS_FOR_AI } from './core/ai/webSearch.js';

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
type Handler = (ctx: { params: Record<string, string>; query: URLSearchParams; body: any; raw: string }) => Promise<any> | any;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }
export const routes: Route[] = [];
function route(method: string, p: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + p.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, pattern, keys, handler });
}
const id = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Bad id'); return n; };
const parse = <T>(schema: z.ZodType<T>, body: any): T => { const r = schema.safeParse(body ?? {}); if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')); return r.data; };

// ------------------------------------------------------------------------------------- status
route('GET', '/api/status', () => {
  const db = getDb();
  const s = getSettings();
  const { profile, version } = getProfile();
  const today = todayLondon();
  const batch = db.get<any>('SELECT id FROM daily_batches WHERE date_london = ?', today);
  const funnel = db.all<any>('SELECT stage, COUNT(*) n FROM applications GROUP BY stage');
  const sources = db.all<any>('SELECT source_id, status, last_success_at, last_error FROM source_connections');
  const lastRun = db.get<any>('SELECT id FROM search_runs ORDER BY id DESC LIMIT 1');
  const perm = permissionView(profile, s);
  return {
    today, snapshot: activeSnapshot(), profileVersion: version, permission: perm,
    visaRule: s.graduate_visa_rules, scan: currentRun(), lastRun: lastRun ? getRun(lastRun.id) : null,
    schedule: scheduleStatus(), daily: batch ? summarise(batch.id, today) : null, funnel, sources,
    trace: filterTrace(), alertsUnread: db.get<any>('SELECT COUNT(*) n FROM alerts WHERE read = 0')?.n ?? 0,
    ai: { enabled: s.ai_enabled, keyConfigured: hasSecret('openai_api_key'), model: s.openai_model, spentTodayUsd: spentTodayUsd(), budgetUsd: s.ai_daily_budget_usd },
    employers: db.get<any>(`SELECT COUNT(*) total, SUM(CASE WHEN id IN (SELECT employer_id FROM employer_sponsor_matches WHERE active=1 AND verified_by_user=1 AND status='CONFIRMED') THEN 1 ELSE 0 END) confirmed,
                             SUM(CASE WHEN id IN (SELECT employer_id FROM employer_sponsor_matches WHERE active=1 AND status='PROPOSED') THEN 1 ELSE 0 END) proposed FROM employers`),
    autoDiscovery: autoDiscoveryStats(),
    roleFocus: s.role_focus,
    dataDir: dataDir(),
  };
});

// ------------------------------------------------------------------------------------- sponsors
route('GET', '/api/sponsors', ({ query }) => ({ snapshot: activeSnapshot(), results: searchSponsors(query.get('q') ?? '', 60) }));
route('GET', '/api/sponsors/snapshots', () => getDb().all('SELECT id, published_at, imported_at, source_url, source_file, row_count, skilled_worker_count, valid, active, quality_json, diff_json FROM sponsor_snapshots ORDER BY id DESC'));
route('GET', '/api/sponsors/local-files', () => findLocalRegisterFiles());
route('POST', '/api/sponsors/import-local', async ({ body }) => {
  const { file } = parse(z.object({ file: z.string() }), body);
  const allowed = findLocalRegisterFiles().map((f) => f.path);
  if (!allowed.includes(file)) throw new HttpError(400, 'File is not one of the detected register CSVs.');
  const r = await importSponsorCsv(file);
  proposeAllMatches();
  void reevaluateAll();
  return r;
});
route('POST', '/api/sponsors/upload', async ({ raw }) => {
  if (!raw || raw.length < 1000) throw new HttpError(400, 'Empty upload');
  const dir = path.join(dataDir(), 'sponsor-uploads'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `upload-${Date.now()}.csv`);
  fs.writeFileSync(file, raw);
  const r = await importSponsorCsv(file);
  proposeAllMatches();
  void reevaluateAll();
  return r;
});
route('POST', '/api/sponsors/refresh', async () => {
  const r = await refreshFromOfficial();
  if (r.status === 'IMPORTED') { proposeAllMatches(); void reevaluateAll(); }
  return r;
});

export function findLocalRegisterFiles() {
  const dirs = [process.cwd(), path.join(process.cwd(), 'data', 'imports'), path.join(os.homedir(), 'Downloads'), ...(process.env.TRACKR_RESOURCES ? [process.env.TRACKR_RESOURCES] : [])];
  const out: Array<{ path: string; name: string; size: number }> = [];
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) if (/worker.*register.*\.csv$|^SP_.*\.csv$/i.test(f)) {
        const p = path.join(d, f); out.push({ path: p, name: f, size: fs.statSync(p).size });
      }
    } catch { /* dir missing */ }
  }
  return out;
}

// ------------------------------------------------------------------------------------- employers
route('GET', '/api/employers', () => listEmployers());
route('POST', '/api/employers', async ({ body }) => {
  const b = parse(z.object({ name: z.string().min(1).max(200), url: z.string().url().optional().nullable() }), body);
  return addEmployer(b);
});
route('GET', '/api/employers/:id/candidates', ({ params, query }) => {
  const e = getDb().get<any>('SELECT * FROM employers WHERE id = ?', id(params.id));
  const snap = activeSnapshot();
  if (!e || !snap) return [];
  const q = query.get('q');
  return q ? searchSponsors(q, 40) : proposeCandidates(getDb(), snap.id, e.canonical_name, 20);
});
route('POST', '/api/employers/:id/confirm', async ({ params, body }) => {
  const b = parse(z.object({ sponsorOrgId: z.number().int(), evidenceUrl: z.string().nullable().optional() }), body);
  confirmEmployerMatch(id(params.id), b.sponsorOrgId, b.evidenceUrl ?? null);
  const n = await reevaluateAll({ employerId: id(params.id) });
  return { ok: true, reevaluated: n };
});
route('POST', '/api/employers/confirm-proposed', async ({ body }) => {
  const b = parse(z.object({ employerIds: z.array(z.number().int()).min(1), acknowledgement: z.literal('I checked these legal entities') }), body);
  const db = getDb();
  for (const eid of b.employerIds) {
    const m = db.get<any>("SELECT * FROM employer_sponsor_matches WHERE employer_id = ? AND active = 1 AND status = 'PROPOSED'", eid);
    if (!m) continue;
    const snap = activeSnapshot();
    const org = db.get<any>("SELECT id FROM sponsor_organisations WHERE snapshot_id = ? AND exact_key = ? AND route = 'Skilled Worker' ORDER BY CASE WHEN lower(town) = lower(?) THEN 0 ELSE 1 END LIMIT 1", snap?.id, m.exact_key, m.town ?? '');
    if (org) confirmEmployerMatch(eid, org.id, null);
  }
  void reevaluateAll();
  return { ok: true };
});
route('POST', '/api/employers/:id/not-sponsor', async ({ params, body }) => {
  markEmployerNotSponsor(id(params.id), parse(z.object({ note: z.string().max(500).nullable().optional() }), body).note ?? null);
  return { reevaluated: await reevaluateAll({ employerId: id(params.id) }) };
});
route('POST', '/api/employers/:id/enabled', ({ params, body }) => { setEmployerEnabled(id(params.id), parse(z.object({ enabled: z.boolean() }), body).enabled); return { ok: true }; });

// ------------------------------------------------------------------------------------- sources
route('GET', '/api/sources', () => {
  const db = getDb();
  const s = getSettings();
  const rows = new Map(db.all<any>('SELECT * FROM source_connections').map((r) => [r.source_id, r]));
  const intent = parseNaturalLanguage('');
  return allAdapters().map((a) => {
    const r = rows.get(a.id) ?? {};
    const jobsFound = db.get<any>('SELECT COUNT(DISTINCT job_id) n FROM source_jobs WHERE source_id = ?', a.id)?.n ?? 0;
    const fullJds = db.get<any>('SELECT COUNT(DISTINCT v.job_id) n FROM job_description_versions v JOIN source_jobs sj ON sj.job_id = v.job_id AND sj.source_id = ? WHERE v.active = 1 AND v.complete = 1', a.id)?.n ?? 0;
    return {
      id: a.id, name: a.displayName, homepage: a.sourceHomepage, mode: a.mode, kind: a.kind, description: a.description,
      status: r.status ?? 'NOT_CONFIGURED', notes: r.notes ?? null, lastAttemptAt: r.last_attempt_at ?? null, lastSuccessAt: r.last_success_at ?? null, lastError: r.last_error ?? null,
      linksFound: r.links_found ?? 0, jobsFound, fullJds, enabled: s.enabled_sources[a.id] !== false, optIn: s.enabled_sources[a.id] === true,
      searchLinks: a.searchLinks ? a.searchLinks(intent) : [],
    };
  });
});
route('POST', '/api/sources/:sid/verify', async ({ params }) => verifySource(decodeURIComponent(params.sid)));
route('POST', '/api/sources/verify-all', async () => {
  const out: Record<string, any> = {};
  for (const a of allAdapters()) { try { out[a.id] = await verifySource(a.id); } catch (e) { out[a.id] = { status: 'ERROR', message: (e as Error).message }; } }
  return out;
});
route('POST', '/api/sources/:sid/enabled', ({ params, body }) => {
  const s = getSettings();
  saveSettings({ enabled_sources: { ...s.enabled_sources, [decodeURIComponent(params.sid)]: parse(z.object({ enabled: z.boolean() }), body).enabled } });
  return { ok: true };
});
route('GET', '/api/search-links', ({ query }) => {
  const intent = parseNaturalLanguage(query.get('q') ?? '', (query.get('mode') as SearchMode) ?? 'ALL');
  return {
    boards: allAdapters().filter((a) => a.searchLinks).map((a) => ({ id: a.id, name: a.displayName, links: a.searchLinks!(intent) })),
    google: googleQueryLinks(intent),
  };
});

// ------------------------------------------------------------------------------------- scans
const ScanBody = z.object({
  mode: z.enum(['MANUAL_FULL', 'KEYWORD', 'RECHECK', 'RETRY_FAILED', 'AUTODISCOVER', 'COMPANY_DISCOVERY']), query: z.string().max(300).optional(),
  searchMode: z.enum(Object.keys(SEARCH_MODES) as [SearchMode, ...SearchMode[]]).optional(), roleFocus: z.enum(['BOTH', 'INTERNSHIP', 'GRADUATE']).optional(),
  scope: z.enum(['REGISTRY', 'BOARDS', 'ALL', 'GULF']).optional(), market: z.enum(['UAE', 'QATAR', 'SAUDI']).optional(),
  companyOptions: z.object({ useAi: z.boolean(), limit: z.number().int().min(10).max(600), extra: z.array(z.object({ name: z.string().min(1).max(120), careersUrl: z.string().max(500).nullable().optional() })).max(200).optional() }).optional(),
});
route('POST', '/api/scan', ({ body }) => {
  const b = parse(ScanBody, body);
  if (!activeSnapshot()) throw new HttpError(409, 'Import the sponsor register first (Sponsors page).');
  const co = b.companyOptions ? { useAi: b.companyOptions.useAi, limit: b.companyOptions.limit, extra: (b.companyOptions.extra ?? []).map((x) => ({ name: x.name, careersUrl: x.careersUrl ?? null, source: 'user' as const })) } : undefined;
  try { return { runId: startScan({ mode: b.mode as RunMode, query: b.query, searchMode: b.searchMode, roleFocus: b.roleFocus, scope: b.scope, market: b.market, companyOptions: co }) }; } catch (e) { throw new HttpError(409, (e as Error).message); }
});
route('GET', '/api/gulf/markets', () => Object.values(MARKETS).map((m) => ({ id: m.id, name: m.name, flag: m.flag, boards: m.boards,
  counts: getDb().get<any>(`SELECT SUM(current_status IN ('VERIFIED_COMPATIBLE','POTENTIAL_NO_STATED_BLOCKER')) eligible, SUM(current_status = 'NEEDS_REVIEW') review, SUM(current_status = 'EXCLUDED') excluded, COUNT(*) total FROM jobs WHERE market = ? AND is_demo = 0`, m.id) })));
route('GET', '/api/companies', () => companySummary());
route('GET', '/api/registry/progress', () => registerProgress());
route('POST', '/api/ai/rank', async ({ body }) => {
  const b = parse(z.object({ jobIds: z.array(z.number().int()).max(100).optional(), limit: z.number().int().min(1).max(100).optional() }), body);
  return aiRankShortlist({ limit: b.limit ?? 20, jobIds: b.jobIds });
});
route('GET', '/api/search-setup', () => {
  const { profile } = getProfile();
  return { target_roles: profile.target_roles, custom_restrictions: profile.custom_restrictions, defaults: DEFAULT_ROLE_FAMILIES, aiBoards: JOB_BOARDS_FOR_AI };
});
route('POST', '/api/role-focus', ({ body }) => {
  const { focus } = parse(z.object({ focus: z.enum(['BOTH', 'INTERNSHIP', 'GRADUATE']) }), body);
  saveSettings({ role_focus: focus });
  return { focus };
});
route('POST', '/api/scan/:id/cancel', ({ params }) => { requestCancel(id(params.id)); return { ok: true }; });
route('GET', '/api/runs', () => getDb().all<any>('SELECT id FROM search_runs ORDER BY id DESC LIMIT 60').map((r) => getRun(r.id)));
route('GET', '/api/runs/:id/events', ({ params, query }) => listEvents(id(params.id), Number(query.get('after') ?? 0), Number(query.get('limit') ?? 400)));
route('GET', '/api/runs/:id/efficacy', ({ params }) => runEfficacy(id(params.id)));
route('GET', '/api/runs/:id',({ params }) => ({ ...getRun(id(params.id)), candidates: getDb().all('SELECT * FROM search_run_candidates WHERE run_id = ? ORDER BY id DESC LIMIT 500', id(params.id)) }));

// ------------------------------------------------------------------------------------- jobs
route('GET', '/api/jobs', ({ query }) => {
  const statuses = query.get('statuses')?.split(',').filter(Boolean);
  return {
    ...listJobs({
      statuses, category: query.get('category'), q: query.get('q'), searchMode: (query.get('mode') as SearchMode) ?? 'ALL',
      verifiedOnly: query.get('verifiedOnly') === '1', internshipOnly: query.get('internship') === '1', offCycleOnly: query.get('offcycle') === '1', graduateOnly: query.get('graduate') === '1',
      location: (query.get('location') as any) || null, includeDemo: query.get('demo') !== '0', reasonCode: query.get('reason'),
      group: (query.get('group') as any) || null, market: query.get('market'),
      limit: Number(query.get('limit') ?? 100), offset: Number(query.get('offset') ?? 0), sort: (query.get('sort') as any) ?? 'fit',
    }),
    trace: filterTrace(getDb(), query.get('market') ?? 'UK'),
    policyWarnings: query.get('q') ? parseNaturalLanguage(query.get('q')!).policyWarnings : [],
  };
});
route('GET', '/api/jobs/:id', ({ params }) => { const d = jobDetail(id(params.id)); if (!d) throw new HttpError(404, 'Not found'); return d; });
route('POST', '/api/jobs/:id/remove', ({ params }) => dismissJob(id(params.id)));
route('POST', '/api/jobs/:id/reanalyse', async ({ params, body }) => analyseJob(id(params.id), { allowAi: !!body?.allowAi }));
route('POST', '/api/jobs/:id/paste-jd', async ({ params, body }) => {
  const b = parse(z.object({ text: z.string().min(50).max(200000) }), body);
  const job = getDb().get<any>('SELECT * FROM jobs WHERE id = ?', id(params.id));
  if (!job) throw new HttpError(404, 'Not found');
  saveJdVersion(job.id, { sourceId: 'user_paste', sourceJobId: null, title: job.title, employer: job.advertised_employer, location: job.location, boardUrl: null, employerUrl: null, applyUrl: job.apply_url, applyUrlKind: job.apply_url_kind, postedAt: null, deadline: null, salaryText: null, descriptionText: b.text, descriptionComplete: b.text.trim().length > 300, extractionMethod: 'user_pasted_text', accessMode: 'MANUAL_IMPORT' });
  return analyseJob(job.id, { allowAi: true });
});
route('POST', '/api/jobs/:id/feedback', async ({ params, body }) => {
  const b = parse(z.object({ notInterested: z.boolean().optional(), strongFit: z.boolean().optional(), rating: z.number().int().min(1).max(5).nullable().optional(), note: z.string().max(2000).nullable().optional(), reviewVerdict: z.enum(['CONFIRMED_ELIGIBLE', 'CONFIRMED_INELIGIBLE', 'UNKNOWN']).nullable().optional() }), body);
  feedback(id(params.id), b);
  if (b.reviewVerdict || b.strongFit) await analyseJob(id(params.id), { allowAi: false });
  return { ok: true };
});
route('POST', '/api/jobs/:id/stage', ({ params, body }) => {
  const b = parse(z.object({ stage: z.enum(APPLICATION_STAGES), note: z.string().max(2000).nullable().optional(), confirmSubmitted: z.boolean().optional() }), body);
  try { return setStage(id(params.id), b.stage, { note: b.note, confirmSubmitted: b.confirmSubmitted, userAction: 'user' }); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route('POST', '/api/jobs/:id/application', ({ params, body }) => updateApplication(id(params.id), parse(z.object({
  cv_version: z.string().max(200).nullable().optional(), cover_letter_version: z.string().max(200).nullable().optional(), qa_notes: z.string().max(20000).nullable().optional(),
  followup_at: z.string().max(40).nullable().optional(), interview_at: z.string().max(40).nullable().optional(), recruiter: z.string().max(300).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(), rating: z.number().int().min(1).max(5).nullable().optional(), outcome: z.string().max(500).nullable().optional(), tags: z.array(z.string().max(40)).max(20).optional(),
}), body)));
route('POST', '/api/jobs/:id/correct-employer', async ({ params, body }) => {
  const b = parse(z.object({ sponsorOrgId: z.number().int().nullable(), notSponsor: z.boolean().optional(), evidenceUrl: z.string().nullable().optional() }), body);
  const db = getDb();
  const job = db.get<any>('SELECT * FROM jobs WHERE id = ?', id(params.id));
  if (!job) throw new HttpError(404, 'Not found');
  let empId = job.employer_id as number | null;
  if (!empId) {
    const name = job.advertised_employer ?? 'Unknown employer';
    const ex = db.get<any>("SELECT id FROM employers WHERE ats_type = 'manual' AND ats_token = ?", exactKey(name));
    empId = ex?.id ?? db.run("INSERT INTO employers(canonical_name, ats_type, ats_token, provenance, first_seen_at, discovery_status) VALUES (?, 'manual', ?, 'entity_correction', ?, 'MANUAL_ONLY')", name, exactKey(name), new Date().toISOString()).lastInsertRowid;
    db.run('UPDATE jobs SET employer_id = ? WHERE advertised_employer = ? AND employer_id IS NULL', empId, name);
  }
  if (b.notSponsor) markEmployerNotSponsor(empId!, 'Corrected from job detail');
  else if (b.sponsorOrgId) confirmEmployerMatch(empId!, b.sponsorOrgId, b.evidenceUrl ?? null);
  return { reevaluated: await reevaluateAll({ employerId: empId! }) };
});
route('POST', '/api/import', async ({ body }) => {
  const b = parse(z.object({ url: z.string().max(2000).optional().nullable(), text: z.string().max(200000).optional().nullable(), title: z.string().max(300).optional().nullable(), employer: z.string().max(300).optional().nullable(), location: z.string().max(300).optional().nullable() }), body);
  if (!b.url && !b.text) throw new HttpError(400, 'Provide a URL or the JD text.');
  if (b.url && !isSafeHttpUrl(b.url)) throw new HttpError(400, 'Only http(s) links can be imported.');
  const url = b.url || `manual:${Date.now()}`;
  const out = b.url
    ? await importFromUrl(b.url, b.text, { title: b.title ?? undefined, employer: b.employer ?? undefined, location: b.location ?? undefined })
    : { job: { sourceId: 'user_paste', sourceJobId: url, title: b.title || 'Pasted job', employer: b.employer ?? null, location: b.location ?? null, boardUrl: null, employerUrl: null, applyUrl: null, applyUrlKind: 'UNKNOWN' as const, postedAt: null, deadline: null, salaryText: null, descriptionText: b.text!, descriptionComplete: b.text!.trim().length > 300, extractionMethod: 'user_pasted_text', accessMode: 'MANUAL_IMPORT' as const }, message: 'Using pasted text (no application link — add one later).' };
  if (!out.job) throw new HttpError(400, out.message);
  const d = { ...out.job };
  if ('atsRef' in out && out.atsRef) d.employerId = ensureEmployerForAts(out.atsRef.ats, out.atsRef.token, b.employer ?? d.employer);
  if (d.employerId) d.employer = getDb().get<any>('SELECT canonical_name FROM employers WHERE id = ?', d.employerId)?.canonical_name ?? d.employer;
  const { jobId } = upsertJob(d, null);
  saveJdVersion(jobId, d);
  const r = await analyseJob(jobId, { allowAi: true });
  return { jobId, message: out.message, ...r };
});

// ------------------------------------------------------------------------------------- deadline radar
route('GET', '/api/radar', () => {
  const s = getSettings();
  const { profile } = getProfile();
  const today = todayLondon();
  const until = new Date(Date.parse(today) + s.deadline_radar_days * 86400000).toISOString().slice(0, 10);
  const rows = getDb().all<any>(`SELECT j.*, d.reasons_json, d.matrix_json, d.sponsor_match_json, d.fit_json, a.stage AS app_stage, NULL AS not_interested
      FROM jobs j LEFT JOIN job_decisions d ON d.job_id = j.id AND d.active = 1 LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.is_demo = 0 AND j.listing_state = 'OPEN' AND j.deadline_at IS NOT NULL AND j.deadline_at >= ? AND j.deadline_at <= ? AND j.market = 'UK'
        AND (j.current_status IN ('VERIFIED_COMPATIBLE','POTENTIAL_NO_STATED_BLOCKER')
             OR (j.current_status = 'NEEDS_REVIEW' AND j.category IN ('SOC_SECURITY','GRC_RISK_AUDIT','IT_TECHNICAL'))
             OR a.stage IS NOT NULL)
        AND COALESCE(a.stage, '') NOT IN ('Applied','Assessment','Recruiter Screen','Interview','Offer','Rejected','Withdrawn','Archived')
      ORDER BY j.deadline_at ASC LIMIT 60`, today, until);
  // Graduate visa application cut-off: 24 months if applied on/before 31 Dec 2026, 18 months after (configurable rule).
  const cutoff = s.graduate_visa_rules.periods.find((p) => p.applied_on_or_before)?.applied_on_or_before ?? null;
  const visaCutoff = cutoff && ['graduate_planned', 'student'].includes(profile.uk_visa_status) && today <= cutoff
    ? { date: cutoff, daysLeft: Math.round((Date.parse(cutoff) - Date.parse(today)) / 86400000), note: `Apply for your Graduate visa on or before ${cutoff} to get 24 months instead of 18 (rule ${s.graduate_visa_rules.rule_version}; verify on GOV.UK).` }
    : null;
  return { today, windowDays: s.deadline_radar_days, visaCutoff, jobs: rows.map((r) => ({ ...jobSummaryRow(r), daysLeft: Math.round((Date.parse(r.deadline_at) - Date.parse(today)) / 86400000) })) };
});

// ------------------------------------------------------------------------------------- daily 15
route('GET', '/api/daily', ({ query }) => {
  const date = query.get('date') ?? todayLondon();
  const db = getDb();
  let batch = db.get<any>('SELECT * FROM daily_batches WHERE date_london = ?', date);
  const history = db.all<any>('SELECT date_london, summary_json FROM daily_batches ORDER BY date_london DESC LIMIT 30').map((h) => ({ date: h.date_london, summary: j(h.summary_json, null) }));
  // First visit of the day: build today's batch from jobs already found (no scan needed).
  if (!batch && date === todayLondon()) { buildDailyBatch(date); batch = db.get<any>('SELECT * FROM daily_batches WHERE date_london = ?', date); }
  if (!batch) return { date, summary: null, jobs: [], removed: [], history, settings: dailySettings() };
  const rows = db.all<any>(`SELECT j.*, d.reasons_json, d.matrix_json, d.sponsor_match_json, d.fit_json, a.stage AS app_stage, dbj.category_slot, dbj.rank, dbj.added_by, dbj.note AS batch_note, dbj.removed_at, dbj.eligibility_label
      FROM daily_batch_jobs dbj JOIN jobs j ON j.id = dbj.job_id LEFT JOIN job_decisions d ON d.job_id = j.id AND d.active = 1 LEFT JOIN applications a ON a.job_id = j.id
      WHERE dbj.batch_id = ? ORDER BY dbj.rank`, batch.id);
  const map = (r: any) => ({ ...jobSummaryRow(r), slot: r.category_slot, rank: r.rank, addedBy: r.added_by, batchNote: r.batch_note, removedAt: r.removed_at, labelAtSelection: r.eligibility_label });
  return { date, summary: summarise(batch.id, date), jobs: rows.filter((r) => !r.removed_at).map(map), removed: rows.filter((r) => r.removed_at).map(map), history, settings: dailySettings() };
});
function dailySettings() {
  const s = getSettings();
  return { markets: s.daily_markets, fillWithReview: s.daily_fill_with_review, roleFocus: s.role_focus, gulfMinScore: s.gulf_eligible_min_score };
}
route('POST', '/api/daily/build', ({ body }) => buildDailyBatch(todayLondon(), { alternateMix: !!body?.alternateMix }));
route('POST', '/api/daily/add', ({ body }) => {
  const b = parse(z.object({ jobId: z.number().int(), replaceJobId: z.number().int().nullable().optional(), note: z.string().max(500).nullable().optional() }), body);
  try { return addToBatch(b.jobId, b.note ?? null, b.replaceJobId ?? null); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route('POST', '/api/daily/remove', ({ body }) => { const b = parse(z.object({ jobId: z.number().int(), note: z.string().max(500).nullable().optional() }), body); return removeFromBatch(b.jobId, b.note ?? null); });

// ------------------------------------------------------------------------------------- applications
route('GET', '/api/applications', () => ({ stages: APPLICATION_STAGES, applications: listApplications() }));
route('GET', '/api/applications/export', ({ query }) => ({ __download: true, format: query.get('format') === 'json' ? 'json' : 'csv', content: exportApplications(query.get('format') === 'json' ? 'json' : 'csv') }));
route('POST', '/api/applications/import', ({ body }) => {
  const b = parse(z.object({ csv: z.string().min(5).max(5_000_000), commit: z.boolean() }), body);
  try { return importApplicationsCsv(b.csv, b.commit); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route('GET', '/api/drafts/:id', ({ params, query }) => draft(id(params.id), query.get('kind') ?? 'recruiter'));

// ------------------------------------------------------------------------------------- settings / profile / secrets
route('GET', '/api/settings', () => ({ settings: getSettings(), dataDir: dataDir(), secrets: Object.fromEntries(SECRET_NAMES.map((n) => [n, hasSecret(n)])), aiDisclosure: AI_DATA_DISCLOSURE, reasonCodes: REASON_CODES, searchModes: SEARCH_MODES }));
route('POST', '/api/settings', ({ body }) => {
  const patch = parse(AppSettingsSchema.partial(), body);
  const before = getSettings();
  const saved = saveSettings(patch);
  // A different Gulf threshold changes which Gulf jobs are Eligible — re-grade them now (no AI calls), then refill today's Daily 15.
  if (saved.gulf_eligible_min_score !== before.gulf_eligible_min_score) void reevaluateAll({ gulfOnly: true }).then(() => buildDailyBatch()).catch(() => {});
  else if (JSON.stringify(saved.daily_markets) !== JSON.stringify(before.daily_markets) || saved.daily_fill_with_review !== before.daily_fill_with_review) {
    try { buildDailyBatch(); } catch { /* best-effort */ }
  }
  return saved;
});
route('GET', '/api/profile', () => getProfile());
route('POST', '/api/profile', async ({ body }) => {
  const b = parse(z.object({ profile: z.any(), acknowledgeProtectedChange: z.boolean().optional() }), body);
  const cur = getProfile().profile;
  const next = b.profile;
  const protectedKeys = ['disallow_mandatory_clearance', 'accept_only_paid_roles', 'allow_student_only_placements', 'max_required_relevant_experience_years', 'needs_eventual_skilled_worker_transition', 'require_explicit_role_sponsorship', 'allow_long_programme_exception', 'enabled_categories'] as const;
  const changed = protectedKeys.filter((k) => JSON.stringify((cur as any)[k]) !== JSON.stringify(next?.[k]));
  if (changed.length && !b.acknowledgeProtectedChange) throw new HttpError(409, `Protected eligibility settings changed (${changed.join(', ')}). Confirm the change explicitly.`);
  try {
    const saved = saveProfile(next, changed.length ? `protected change: ${changed.join(', ')}` : 'user edit');
    void reevaluateAll();
    return saved;
  } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route('POST', '/api/secrets/:name', async ({ params, body }) => {
  const name = params.name as SecretName;
  if (!SECRET_NAMES.includes(name)) throw new HttpError(400, 'Unknown secret');
  const { value } = parse(z.object({ value: z.string().min(8).max(500) }), body);
  await setSecret(name, value.trim());
  // Saved keys are used straight away.
  if (name === 'openai_api_key') saveSettings({ ai_enabled: true });
  return { ok: true };
});
route('DELETE', '/api/secrets/:name', ({ params }) => {
  const name = params.name as SecretName;
  if (!SECRET_NAMES.includes(name)) throw new HttpError(400, 'Unknown secret');
  deleteSecret(name);
  return { ok: true };
});
route('POST', '/api/ai/test', () => testApiKey());
route('GET', '/api/ai/ledger', () => getDb().all('SELECT * FROM api_cost_ledger ORDER BY id DESC LIMIT 200'));
route('POST', '/api/reevaluate', async () => ({ reevaluated: await reevaluateAll() }));

// ------------------------------------------------------------------------------------- alerts / backup
route('GET', '/api/alerts', () => getDb().all('SELECT * FROM alerts ORDER BY id DESC LIMIT 200'));
route('POST', '/api/alerts/read', () => { getDb().run('UPDATE alerts SET read = 1 WHERE read = 0'); return { ok: true }; });
route('POST', '/api/backup', () => backupNow());
route('GET', '/api/backups', () => listBackups());

// ------------------------------------------------------------------------------------- drafts
function draft(jobId: number, kind: string) {
  const d = jobDetail(jobId);
  if (!d) throw new HttpError(404, 'Not found');
  const { profile } = getProfile();
  const matched = (d.fitInfo?.whyItFits ?? []).slice(0, 3);
  if (kind === 'recruiter') return { kind, text: d.recruiterQuestions.join('\n\n') || 'No open eligibility questions for this role.' };
  const lines = [
    `Dear Hiring Team,`, '',
    `I am applying for the ${d.title} role at ${d.employer ?? 'your organisation'}. I hold an ${profile.education[0] ?? 'MSc'}${profile.education[1] ? ` and a ${profile.education[1]}` : ''}.`,
    profile.experience.length ? `My experience includes: ${profile.experience.join('; ')}.` : '',
    matched.length ? `Relevant to this role: ${matched.join(' ')}` : '',
    profile.certifications_in_progress.length ? `I am currently working towards ${profile.certifications_in_progress.join(' and ')} (not yet completed).` : '',
    `I would be working in the UK on a Graduate visa, which permits full-time work without sponsorship.`, '',
    `Kind regards,`, profile.name || '[Your name]',
    '', '— Draft only. Edit before use; nothing is sent automatically. Only facts from your profile are used.',
  ];
  return { kind: 'cover', text: lines.filter((l) => l !== '').join('\n') };
}

export { getOrCreateBatch };
