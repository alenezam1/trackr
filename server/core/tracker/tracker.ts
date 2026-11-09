import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, j, type Db } from '../../db/db.js';
import { APPLICATION_STAGES, type ApplicationStage, type SearchIntent } from '../models.js';
import { getProfile, getSettings } from '../../config/settings.js';
import { parseNaturalLanguage, type SearchMode } from '../discovery/intent.js';
import { classifyLocation } from '../extraction/classify.js';
import { collapseWs } from '../util/text.js';
import { exactKey } from '../sponsors/normalize.js';

const now = () => new Date().toISOString();

// ----------------------------------------------------------------------------- job queries
export interface JobListFilter {
  statuses?: string[]; category?: string | null; q?: string | null; searchMode?: SearchMode; verifiedOnly?: boolean; includePotential?: boolean;
  internshipOnly?: boolean; offCycleOnly?: boolean; graduateOnly?: boolean; group?: 'registry' | 'boards' | null; market?: string | null; location?: 'LONDON' | 'UK' | 'REMOTE' | null; includeDemo?: boolean; reasonCode?: string | null;
  limit?: number; offset?: number; sort?: 'fit' | 'recent' | 'deadline' | 'ai';
}

export function jobSummaryRow(r: any) {
  const reasons = j<any>(r.reasons_json, {});
  const matrix = j<any>(r.matrix_json, {});
  const sponsor = j<any>(r.sponsor_match_json, {});
  const facts = reasons.facts ?? {};
  return {
    id: r.id, title: r.title, employer: r.advertised_employer, legalEmployer: r.legal_employer, location: r.location, category: r.category,
    employmentType: r.employment_type, status: r.current_status, fit: r.current_fit, applyUrl: r.apply_url, applyUrlKind: r.apply_url_kind,
    sourceId: r.source_id, postedAt: r.posted_at, deadline: r.deadline_at, firstSeenAt: r.first_seen_at, lastCheckedAt: r.last_checked_at,
    listingState: r.listing_state, isDemo: !!r.is_demo, salaryText: r.salary_text,
    reasons: (reasons.reasons ?? []).slice(0, 12), matrix,
    sponsor: { status: sponsor.status, legalName: sponsor.matched?.legal_name ?? null, rating: sponsor.matched?.rating ?? null, typeRating: sponsor.matched?.type_rating ?? null, snapshotDate: sponsor.snapshotDate, note: sponsor.note },
    facts: {
      contractMonths: facts.contractMonths ?? null, programmeMonths: facts.programmeMonths ?? null, isPaid: facts.isPaid ?? null,
      requiredExperienceYears: facts.requiredExperienceYears ?? null, experienceRequirement: facts.experienceRequirement ?? null,
      mandatoryClearances: facts.mandatoryClearances ?? [], optionalClearances: facts.optionalClearances ?? [], backgroundChecks: facts.backgroundChecks ?? [],
      graduateVisaLanguage: facts.graduateVisaLanguage ?? null, sponsorPolicy: facts.sponsorPolicy ?? null,
    },
    fitInfo: j<any>(r.fit_json, null),
    applicationStage: r.app_stage ?? null,
    aiRank: j<any>(r.ai_rank_json, null),
    jdMethod: r.jd_method ?? null, market: r.market ?? 'UK',
    targetRole: facts.targetRole ?? null,
    notInterested: !!r.not_interested,
  };
}

const BASE_SELECT = `SELECT j.*, d.reasons_json, d.matrix_json, d.sponsor_match_json, d.fit_json, d.created_at AS decided_at, a.stage AS app_stage,
  (SELECT not_interested FROM user_feedback f WHERE f.job_id = j.id ORDER BY f.id DESC LIMIT 1) AS not_interested,
  (SELECT result_json FROM ai_rankings r WHERE r.job_id = j.id ORDER BY r.id DESC LIMIT 1) AS ai_rank_json,
  (SELECT extraction_method FROM job_description_versions v WHERE v.job_id = j.id AND v.active = 1 LIMIT 1) AS jd_method
  FROM jobs j LEFT JOIN job_decisions d ON d.job_id = j.id AND d.active = 1 LEFT JOIN applications a ON a.job_id = j.id`;

export function listJobs(f: JobListFilter, db: Db = getDb()) {
  const where: string[] = []; const params: any[] = [];
  if (f.statuses?.length) { where.push(`j.current_status IN (${f.statuses.map(() => '?').join(',')})`); params.push(...f.statuses); }
  if (f.verifiedOnly) where.push("j.current_status = 'VERIFIED_COMPATIBLE'");
  if (f.category) { where.push('j.category = ?'); params.push(f.category); }
  if (!f.includeDemo) where.push('j.is_demo = 0');
  if (f.internshipOnly) where.push("j.employment_type IN ('INTERNSHIP','OFF_CYCLE_INTERNSHIP')");
  if (f.offCycleOnly) where.push("j.employment_type = 'OFF_CYCLE_INTERNSHIP'");
  // Your posting-age window applies immediately to every list (except the Rejected/Stale views).
  if (!f.statuses?.includes('STALE')) {
    const cutoff = new Date(Date.now() - getSettings().max_posting_age_days * 86400000).toISOString().slice(0, 10);
    where.push('(j.posted_at IS NULL OR substr(j.posted_at, 1, 10) >= ?)'); params.push(cutoff);
  }
  // UK views never mix with the Gulf tabs.
  where.push('j.market = ?'); params.push(['UAE', 'QATAR', 'SAUDI'].includes(f.market ?? '') ? f.market : 'UK');
  // Sponsor Registry section = employer careers pages (ATS); Job Boards section = everything else.
  if (f.group === 'registry') where.push("j.source_id LIKE 'ats\\_%' ESCAPE '\\'");
  if (f.group === 'boards') where.push("j.source_id NOT LIKE 'ats\\_%' ESCAPE '\\'");
  if (f.graduateOnly) where.push("COALESCE(j.employment_type, 'UNKNOWN') NOT IN ('INTERNSHIP','OFF_CYCLE_INTERNSHIP')");
  if (f.reasonCode) { where.push('d.reasons_json LIKE ?'); params.push(`%"code":"${f.reasonCode.replace(/[^A-Z_]/g, '')}"%`); }
  const order = f.sort === 'ai' ? "COALESCE((SELECT overall FROM ai_rankings r WHERE r.job_id = j.id ORDER BY r.id DESC LIMIT 1), -1) DESC, COALESCE(j.current_fit, -1) DESC" : f.sort === 'recent' ? 'j.first_seen_at DESC' : f.sort === 'deadline' ? 'CASE WHEN j.deadline_at IS NULL THEN 1 ELSE 0 END, j.deadline_at ASC' : 'COALESCE(j.current_fit, -1) DESC, j.first_seen_at DESC';
  let rows = db.all<any>(`${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 3000`, ...params);

  let intent: SearchIntent | null = null;
  if (f.q?.trim() || (f.searchMode && f.searchMode !== 'ALL')) {
    intent = parseNaturalLanguage(f.q ?? '', f.searchMode ?? 'ALL');
    const it = intent;
    rows = rows.filter((r) => {
      if (r.category && r.category !== 'UNKNOWN' && r.category !== 'OTHER' && !it.categories.includes(r.category)) return false;
      if (it.offCycleOnly && r.employment_type !== 'OFF_CYCLE_INTERNSHIP') return false;
      if (it.internshipsOnly && !['INTERNSHIP', 'OFF_CYCLE_INTERNSHIP'].includes(r.employment_type)) return false;
      const facts = j<any>(r.reasons_json, {}).facts ?? {};
      if (it.maxContractMonths != null) { const m = facts.programmeMonths ?? facts.contractMonths; if (m == null || m > it.maxContractMonths) return false; }
      if (it.location === 'LONDON' && !['LONDON', 'UK_REMOTE'].includes(classifyLocation(r.location))) return false;
      if (it.location === 'REMOTE' && !/remote|hybrid/i.test(r.location ?? '')) return false;
      if (it.universitiesOnly && !/universit|college/i.test(r.advertised_employer ?? '')) return false;
      if (it.nonTechnical && r.category === 'SOC_SECURITY') return false;
      const hay = `${r.title} ${r.advertised_employer ?? ''}`.toLowerCase();
      const strong = it.keywords.filter((k) => !['security', 'cyber', 'analyst', 'jobs', 'support', 'coding', 'technical', 'non-technical'].includes(k));
      if (strong.length && !strong.some((k) => hay.includes(k))) {
        // Fall back to JD text for keyword matches.
        const jd = db.get<any>('SELECT text FROM job_description_versions WHERE job_id = ? AND active = 1', r.id)?.text?.toLowerCase() ?? '';
        if (!strong.some((k) => jd.includes(k))) return false;
      }
      return true;
    });
  }
  if (f.location === 'LONDON' && (f.market ?? 'UK') === 'UK') rows = rows.filter((r) => ['LONDON', 'UK_REMOTE'].includes(classifyLocation(r.location)));
  if (f.location === 'REMOTE') rows = rows.filter((r) => /remote|hybrid/i.test(r.location ?? ''));
  const total = rows.length;
  const page = rows.slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 100));
  return { total, jobs: page.map(jobSummaryRow), intent };
}

/** Filter trace over stored data — counts are real, computed from the local database. */
export function filterTrace(db: Db = getDb(), market = 'UK') {
  const c = (sql: string, ...p: any[]) => db.get<any>(sql, ...p)?.n ?? 0;
  const live = `j.is_demo = 0 AND j.market = '${['UAE', 'QATAR', 'SAUDI'].includes(market) ? market : 'UK'}'`;
  return {
    discoveries: c(`SELECT COUNT(*) n FROM jobs j WHERE ${live}`),
    sponsorMatches: c(`SELECT COUNT(*) n FROM jobs j JOIN job_decisions d ON d.job_id = j.id AND d.active = 1 WHERE ${live} AND json_extract(d.sponsor_match_json, '$.status') IN ('VERIFIED_EXACT','VERIFIED_ALIAS')`),
    fullJds: c(`SELECT COUNT(DISTINCT j.id) n FROM jobs j JOIN job_description_versions v ON v.job_id = j.id AND v.active = 1 AND v.complete = 1 WHERE ${live}`),
    hardExclusions: c(`SELECT COUNT(*) n FROM jobs j WHERE ${live} AND current_status = 'EXCLUDED'`),
    review: c(`SELECT COUNT(*) n FROM jobs j WHERE ${live} AND current_status = 'NEEDS_REVIEW'`),
    potential: c(`SELECT COUNT(*) n FROM jobs j WHERE ${live} AND current_status = 'POTENTIAL_NO_STATED_BLOCKER'`),
    verified: c(`SELECT COUNT(*) n FROM jobs j WHERE ${live} AND current_status = 'VERIFIED_COMPATIBLE'`),
    stale: c(`SELECT COUNT(*) n FROM jobs j WHERE ${live} AND current_status = 'STALE'`),
  };
}

export function jobDetail(id: number, db: Db = getDb()) {
  const r = db.get<any>(`${BASE_SELECT} WHERE j.id = ?`, id);
  if (!r) return null;
  const summary = jobSummaryRow(r);
  const reasonsJson = j<any>(r.reasons_json, {});
  const jd = db.get<any>('SELECT id, text, hash, source_url, fetched_at, extraction_method, access_mode, complete FROM job_description_versions WHERE job_id = ? AND active = 1', id);
  const versions = db.all<any>('SELECT id, hash, source_url, fetched_at, extraction_method, complete, active FROM job_description_versions WHERE job_id = ? ORDER BY id DESC', id);
  const sources = db.all<any>('SELECT source_id, source_job_id, board_url, employer_url, query, discovered_at FROM source_jobs WHERE job_id = ? ORDER BY id', id);
  const history = db.all<any>('SELECT id, status, rules_version, profile_version, sponsor_snapshot_id, created_at FROM job_decisions WHERE job_id = ? ORDER BY id DESC LIMIT 20', id);
  const app = db.get<any>('SELECT * FROM applications WHERE job_id = ?', id);
  const events = app ? db.all<any>('SELECT * FROM application_events WHERE application_id = ? ORDER BY id DESC', app.id) : [];
  const feedback = db.all<any>('SELECT * FROM user_feedback WHERE job_id = ? ORDER BY id DESC', id);
  const factsRow = jd ? db.get<any>('SELECT model, prompt_version, ai_error, evidence_validated, created_at FROM job_facts WHERE jd_version_id = ? ORDER BY id DESC LIMIT 1', jd.id) : null;
  return {
    ...summary,
    jd: jd ?? null, jdVersions: versions, sources, decisionHistory: history,
    facts: reasonsJson.facts ?? null, permissionNote: reasonsJson.permissionNote ?? null,
    sponsorMatch: j<any>(r.sponsor_match_json, null), application: app ? { ...app, tags: j(app.tags_json, []) } : null, applicationEvents: events, feedback,
    analysisMeta: factsRow, recruiterQuestions: recruiterQuestions(summary, reasonsJson.reasons ?? []),
    decidedAt: r.decided_at,
  };
}

// ----------------------------------------------------------------------------- recruiter questions
export function recruiterQuestions(job: any, reasons: any[]): string[] {
  const ref = `${job.title}${job.applyUrl ? ` (${job.applyUrl})` : ''}`;
  const qs: string[] = [];
  const codes = new Set(reasons.map((r: any) => r.code));
  if (codes.has('SPONSORSHIP_NOT_CONFIRMED') || job.matrix?.role_accepts_graduate_visa !== 'EXPLICIT_YES') qs.push(`Hello, regarding ${ref}: I would be working on the UK Graduate visa (unsponsored, full-time work permitted). Could you confirm that candidates on a Graduate visa are eligible for this role?`);
  if (codes.has('NO_FUTURE_SPONSORSHIP') || job.matrix?.vacancy_offers_sponsorship !== 'EXPLICIT_YES') qs.push(`For ${ref}: would the team consider Skilled Worker sponsorship in future for a successful hire whose Graduate visa ends during their employment?`);
  if (codes.has('OTHER_MANDATORY_VETTING')) qs.push(`For ${ref}: what level of security vetting is required? Is SC (Security Check) or higher mandatory, or only BPSS/standard pre-employment checks?`);
  if (codes.has('CURRENT_STUDENT_REQUIRED') || codes.has('GRADUATION_COHORT_INELIGIBLE')) qs.push(`For ${ref}: is this opportunity open to recent graduates who have completed their degree, or only to currently enrolled students?`);
  if (codes.has('CONTRACT_DURATION_UNKNOWN') || codes.has('PROGRAMME_EXCEEDS_WORK_PERMISSION')) qs.push(`For ${ref}: what is the contract/programme length and expected start date?`);
  if (codes.has('SPONSOR_AMBIGUOUS') || codes.has('ACTUAL_EMPLOYER_UNKNOWN')) qs.push(`For ${ref}: which legal entity would employ the successful candidate?`);
  return qs;
}

// ----------------------------------------------------------------------------- applications
export function setStage(jobId: number, stage: ApplicationStage, opts: { note?: string | null; userAction?: string; confirmSubmitted?: boolean } = {}, db: Db = getDb()) {
  if (!APPLICATION_STAGES.includes(stage)) throw new Error('Unknown stage');
  if (stage === 'Applied' && !opts.confirmSubmitted) throw new Error('Confirm that you actually submitted the application before marking it Applied.');
  const t = now();
  return db.tx(() => {
    let app = db.get<any>('SELECT * FROM applications WHERE job_id = ?', jobId);
    if (!app) {
      const r = db.run('INSERT INTO applications(job_id, stage, created_at, updated_at, first_shortlisted_at) VALUES (?, ?, ?, ?, ?)', jobId, stage, t, t, ['Shortlisted', 'To Apply'].includes(stage) ? t : null);
      app = db.get<any>('SELECT * FROM applications WHERE id = ?', r.lastInsertRowid);
      db.run('INSERT INTO application_events(application_id, from_stage, to_stage, at, user_action, note) VALUES (?, NULL, ?, ?, ?, ?)', app.id, stage, t, opts.userAction ?? 'stage_change', opts.note ?? null);
    } else if (app.stage !== stage) {
      db.run(`UPDATE applications SET stage = ?, updated_at = ?, applied_at = CASE WHEN ? = 'Applied' AND applied_at IS NULL THEN ? ELSE applied_at END,
                first_shortlisted_at = COALESCE(first_shortlisted_at, CASE WHEN ? IN ('Shortlisted','To Apply') THEN ? END) WHERE id = ?`, stage, t, stage, t, stage, t, app.id);
      db.run('INSERT INTO application_events(application_id, from_stage, to_stage, at, user_action, note) VALUES (?, ?, ?, ?, ?, ?)', app.id, app.stage, stage, t, opts.userAction ?? 'stage_change', opts.note ?? null);
    }
    return db.get<any>('SELECT * FROM applications WHERE job_id = ?', jobId);
  });
}

export function updateApplication(jobId: number, patch: Record<string, any>, db: Db = getDb()) {
  const allowed = ['cv_version', 'cover_letter_version', 'qa_notes', 'followup_at', 'interview_at', 'recruiter', 'notes', 'rating', 'outcome'];
  let app = db.get<any>('SELECT * FROM applications WHERE job_id = ?', jobId);
  if (!app) app = setStage(jobId, 'Shortlisted', { userAction: 'created_by_edit' });
  const sets: string[] = []; const params: any[] = [];
  for (const k of allowed) if (k in patch) { sets.push(`${k} = ?`); params.push(patch[k] === '' ? null : patch[k]); }
  if ('tags' in patch) { sets.push('tags_json = ?'); params.push(JSON.stringify(patch.tags ?? [])); }
  if (!sets.length) return app;
  db.run(`UPDATE applications SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, now(), app.id);
  if ('interview_at' in patch && patch.interview_at) db.run('INSERT INTO alerts(at, kind, job_id, message) VALUES (?, ?, ?, ?)', now(), 'INTERVIEW', jobId, `Interview scheduled ${patch.interview_at}.`);
  return db.get<any>('SELECT * FROM applications WHERE id = ?', app.id);
}

export function listApplications(db: Db = getDb()) {
  return db.all<any>(`SELECT a.*, j.title, j.advertised_employer, j.legal_employer, j.category, j.employment_type, j.location, j.apply_url, j.deadline_at, j.current_status, j.current_fit, j.is_demo
                      FROM applications a JOIN jobs j ON j.id = a.job_id ORDER BY a.updated_at DESC`).map((a) => ({ ...a, tags: j(a.tags_json, []) }));
}

export function feedback(jobId: number, input: { notInterested?: boolean; strongFit?: boolean; rating?: number | null; note?: string | null; reviewVerdict?: 'CONFIRMED_ELIGIBLE' | 'CONFIRMED_INELIGIBLE' | 'UNKNOWN' | null }, db: Db = getDb()) {
  const jd = db.get<any>('SELECT id FROM job_description_versions WHERE job_id = ? AND active = 1', jobId);
  db.run('INSERT INTO user_feedback(job_id, rating, not_interested, strong_fit, override_note, review_verdict, verified_by_user, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    jobId, input.rating ?? null, !!input.notInterested, !!input.strongFit, JSON.stringify({ note: input.note ?? null, jdVersionId: jd?.id ?? null }), input.reviewVerdict ?? null, !!input.reviewVerdict, now());
  if (input.notInterested) db.run('UPDATE jobs SET user_hidden = 1 WHERE id = ?', jobId);
}

// ----------------------------------------------------------------------------- export / import
const CSV_COLS = ['job_id', 'title', 'employer', 'legal_employer', 'category', 'employment_type', 'location', 'stage', 'applied_at', 'apply_url', 'deadline', 'eligibility_status', 'fit', 'cv_version', 'followup_at', 'interview_at', 'recruiter', 'notes', 'tags'];
const csvCell = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function exportApplications(format: 'csv' | 'json') {
  const rows = listApplications().map((a) => ({
    job_id: a.job_id, title: a.title, employer: a.advertised_employer, legal_employer: a.legal_employer, category: a.category, employment_type: a.employment_type,
    location: a.location, stage: a.stage, applied_at: a.applied_at, apply_url: a.apply_url, deadline: a.deadline_at, eligibility_status: a.current_status, fit: a.current_fit,
    cv_version: a.cv_version, followup_at: a.followup_at, interview_at: a.interview_at, recruiter: a.recruiter, notes: a.notes, tags: (a.tags ?? []).join('; '),
  }));
  if (format === 'json') return JSON.stringify(rows, null, 2);
  return [CSV_COLS.join(','), ...rows.map((r: any) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n');
}

function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}

/** Import an existing application log CSV. With commit=false only returns a dedupe preview. */
export function importApplicationsCsv(text: string, commit: boolean, db: Db = getDb()) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('CSV has no data rows.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const ci = { title: col(['title', 'role', 'job title', 'position']), employer: col(['employer', 'company', 'organisation']), url: col(['apply_url', 'url', 'link', 'job url']),
    stage: col(['stage', 'status']), applied: col(['applied_at', 'date applied', 'applied']), notes: col(['notes', 'note']), location: col(['location']) };
  if (ci.title < 0 || ci.employer < 0) throw new Error('CSV needs at least "title" and "employer"/"company" columns.');
  const preview: any[] = [];
  for (const r of rows.slice(1)) {
    const title = collapseWs(r[ci.title] ?? ''); const employer = collapseWs(r[ci.employer] ?? '');
    if (!title) continue;
    const url = ci.url >= 0 ? r[ci.url]?.trim() : '';
    const dup = db.get<any>('SELECT id FROM jobs WHERE (apply_url IS NOT NULL AND apply_url = ?) OR (lower(title) = lower(?) AND lower(COALESCE(advertised_employer, \'\')) = lower(?))', url || '__none__', title, employer);
    const stageRaw = ci.stage >= 0 ? r[ci.stage]?.trim() : '';
    const stage = (APPLICATION_STAGES as readonly string[]).find((s) => s.toLowerCase() === stageRaw?.toLowerCase()) ?? 'Applied';
    preview.push({ title, employer, url, stage, appliedAt: ci.applied >= 0 ? r[ci.applied] : null, notes: ci.notes >= 0 ? r[ci.notes] : null, location: ci.location >= 0 ? r[ci.location] : null, duplicateOfJobId: dup?.id ?? null });
  }
  if (!commit) return { preview, imported: 0 };
  let imported = 0;
  for (const p of preview) {
    let jobId = p.duplicateOfJobId;
    if (!jobId) {
      const t = now();
      jobId = db.run(`INSERT INTO jobs(canonical_key, title, advertised_employer, location, apply_url, apply_url_kind, source_id, first_seen_at, last_seen_at, listing_state, current_status)
                      VALUES (?, ?, ?, ?, ?, 'UNKNOWN', 'csv_import', ?, ?, 'UNKNOWN', 'NEEDS_REVIEW')`, `csv:${exactKey(p.employer)}:${exactKey(p.title)}:${Date.now()}:${imported}`, p.title, p.employer, p.location, p.url || null, t, t).lastInsertRowid;
    }
    const existing = db.get<any>('SELECT id FROM applications WHERE job_id = ?', jobId);
    if (!existing) {
      setStage(jobId, p.stage, { userAction: 'csv_import', confirmSubmitted: true, note: 'Imported from CSV log' });
      if (p.appliedAt) db.run('UPDATE applications SET applied_at = ? WHERE job_id = ?', p.appliedAt, jobId);
      if (p.notes) db.run('UPDATE applications SET notes = ? WHERE job_id = ?', p.notes, jobId);
      imported++;
    }
  }
  return { preview, imported };
}

// ----------------------------------------------------------------------------- backup / restore
export function backupNow(db: Db = getDb()) {
  const dir = path.join(dataDir(), 'backups');
  const file = path.join(dir, `trackr-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  db.backup(file);
  const settingsFile = file.replace(/\.sqlite$/, '.settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ exportedAt: now(), settings: getSettings(), profile: getProfile().profile, note: 'API keys are NOT included.' }, null, 2));
  return { file, settingsFile };
}
export function listBackups() {
  const dir = path.join(dataDir(), 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime.toISOString() })).sort((a, b) => b.at.localeCompare(a.at));
}
