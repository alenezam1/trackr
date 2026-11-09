// Per-job pipeline: prefilter → dedupe/upsert → JD versioning → rule facts → (optional AI) →
// sponsor gate → deterministic decision → fit score → persist. Spec §5.4.
import { getDb, j, type Db } from '../../db/db.js';
import { getProfile, getSettings } from '../../config/settings.js';
import type { Decision, ExtractedJobFacts, SearchIntent, SponsorMatch } from '../models.js';
import { PROMPT_VERSION, RULES_VERSION } from '../models.js';
import type { DiscoveredJob } from '../sources/types.js';
import { classifyLocation, classifyEmploymentType, isSeniorTitle, NOT_A_VACANCY_TITLE } from '../extraction/classify.js';
import { matchTargetRole, type RoleFamily } from './roles.js';
import { scamSignals } from '../extraction/posting.js';
import { ABOVE_ENTRY_TITLE, evaluateGulf, GULF_RULES_VERSION, marketOfLocation, matchGulfRole, NATIONALS_TITLE, NON_GULF_PLACE, type GulfMarket } from '../gulf/markets.js';
import { daysBetween, parsePostedDate, todayLondon } from '../util/text.js';
import { extractRuleFacts } from '../extraction/rules.js';
import { aiExtract, mergeAiFacts, type AiFacts } from '../ai/openai.js';
import { matchEmployer } from '../sponsors/match.js';
import { evaluate } from '../eligibility/engine.js';
import { scoreJob } from '../ranking/score.js';
import { sha256, collapseWs } from '../util/text.js';
import { exactKey, coreKey } from '../sponsors/normalize.js';

const now = () => new Date().toISOString();

export type PrefilterResult = { pass: true } | { pass: false; reason: 'OUT_OF_SCOPE' | 'NON_UK' | 'INTENT_MISMATCH' | 'ABOVE_ENTRY' | 'NATIONALS_ONLY' };

/** Cheap title/location/intent prefilter — no network, no AI. */
export function prefilter(d: DiscoveredJob, intent: SearchIntent | null, families: RoleFamily[] = getProfile().profile.target_roles): PrefilterResult {
  // Talent pools / "register your interest" pages are not vacancies.
  if (NOT_A_VACANCY_TITLE.test(d.title)) return { pass: false, reason: 'OUT_OF_SCOPE' };
  // Gulf postings (UAE / Qatar / Saudi) follow the Gulf rules: any cyber role, routed to that country's tab.
  const gulf = marketOfLocation(d.location) ?? (intent?.scope === 'GULF' && !d.location ? intent.market ?? null : null);
  if (gulf) {
    if (!matchGulfRole(d.title, families)) return { pass: false, reason: 'OUT_OF_SCOPE' };
    if (!marketOfLocation(d.location) && NON_GULF_PLACE.test(`${d.title} ${d.location ?? ''}`)) return { pass: false, reason: 'NON_UK' };
    // Spec §5: decided from the title alone, before any page is opened.
    if (ABOVE_ENTRY_TITLE.test(d.title) && !/\b(junior|graduate|intern|trainee|entry)\b/i.test(d.title)) return { pass: false, reason: 'ABOVE_ENTRY' };
    if (NATIONALS_TITLE.test(d.title)) return { pass: false, reason: 'NATIONALS_ONLY' };
    d.market = gulf;
    return { pass: true };
  }
  if (intent?.scope === 'GULF') return { pass: false, reason: 'NON_UK' };
  // Your target roles decide scope (My Search page): the title must match an enabled role family.
  // Fallback: any clearly cyber/GRC title ("Security Consultant", "Cybersecurity", "InfoSec Analyst"), also checking the
  // company field when a board split the title ("Technical Graduate – Cyber Security 2027").
  const cyberFallback = () => {
    const f = matchGulfRole(d.title, families) ?? (d.employer && /\b(cyber|security|infosec|grc|soc)\b/i.test(d.employer) ? matchGulfRole(`${d.title} ${d.employer}`, families) : null);
    return f && f.enabled !== false && families.some((x) => x.enabled && x.category === f.category) ? f : null;
  };
  const fam = matchTargetRole(d.title, families) ?? cyberFallback();
  if (!fam) return { pass: false, reason: 'OUT_OF_SCOPE' };
  const cat = fam.category;
  const loc = classifyLocation(d.location);
  if (loc === 'NON_UK') return { pass: false, reason: 'NON_UK' };
  if (intent) {
    if (!intent.categories.includes(cat)) return { pass: false, reason: 'INTENT_MISMATCH' };
    if (intent.location === 'LONDON' && !['LONDON', 'UK_REMOTE', 'AMBIGUOUS_REMOTE', 'UNKNOWN'].includes(loc)) return { pass: false, reason: 'INTENT_MISMATCH' };
    if (intent.location === 'REMOTE' && !['UK_REMOTE', 'AMBIGUOUS_REMOTE'].includes(loc) && !/remote|hybrid/i.test(d.location ?? '')) return { pass: false, reason: 'INTENT_MISMATCH' };
    if (intent.internshipsOnly || intent.offCycleOnly || intent.employmentTypes.length) {
      const et = classifyEmploymentType(d.title, d.descriptionText ?? '');
      if (intent.offCycleOnly && et !== 'OFF_CYCLE_INTERNSHIP') return { pass: false, reason: 'INTENT_MISMATCH' };
      if (intent.internshipsOnly && !['INTERNSHIP', 'OFF_CYCLE_INTERNSHIP'].includes(et)) return { pass: false, reason: 'INTENT_MISMATCH' };
      if (intent.employmentTypes.length && !intent.employmentTypes.includes(et) && !(et === 'UNKNOWN')) return { pass: false, reason: 'INTENT_MISMATCH' };
    }
    if (intent.roleFocus && intent.roleFocus !== 'BOTH') {
      const et = classifyEmploymentType(d.title, d.descriptionText ?? '');
      const isIntern = et === 'INTERNSHIP' || et === 'OFF_CYCLE_INTERNSHIP';
      if (intent.roleFocus === 'INTERNSHIP' && !isIntern) return { pass: false, reason: 'INTENT_MISMATCH' };
      if (intent.roleFocus === 'GRADUATE' && isIntern) return { pass: false, reason: 'INTENT_MISMATCH' };
    }
    if (intent.universitiesOnly && !/universit|college/i.test(d.employer ?? '')) return { pass: false, reason: 'INTENT_MISMATCH' };
  }
  return { pass: true };
}

function canonicalKey(d: DiscoveredJob): string {
  if (d.accessMode === 'PUBLIC_ATS' && d.sourceJobId) return `ats:${d.sourceId}:${d.sourceJobId}`;
  if (d.sourceJobId) return `src:${d.sourceId}:${d.sourceJobId}`;
  return `h:${sha256(`${exactKey(d.employer ?? '')}|${collapseWs(d.title).toLowerCase()}|${(d.location ?? '').toLowerCase()}`).slice(0, 32)}`;
}

// ------------------------------------------------------------------ removed jobs
const titleEmployerKey = (title: string, employer: string | null | undefined) => `${coreKey(employer ?? '')}|${collapseWs(title).toLowerCase()}`;

/** True when you removed this job (same posting, same link, or same title at the same employer on another board). */
export function isDismissed(d: DiscoveredJob, db: Db = getDb()): boolean {
  const keys: Array<[string, string]> = [['key', canonicalKey(d)]];
  for (const u of [d.applyUrl, d.boardUrl, d.employerUrl]) if (u) keys.push(['url', u]);
  if (d.employer && d.title) keys.push(['title_employer', titleEmployerKey(d.title, d.employer)]);
  return keys.some(([k, v]) => !!db.get('SELECT 1 FROM dismissed_jobs WHERE kind = ? AND value = ?', k, v));
}

/** Remove a job for good: delete it (and its JD, decisions, ranking, tracker entry) and remember it so scans skip it. */
export function dismissJob(jobId: number, db: Db = getDb()): { removed: boolean; title?: string } {
  const job = db.get<any>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) return { removed: false };
  const t = now();
  const add = (kind: string, value: string | null | undefined) => value && db.run('INSERT OR IGNORE INTO dismissed_jobs(kind, value, title, employer, dismissed_at) VALUES (?, ?, ?, ?, ?)', kind, value, job.title, job.advertised_employer, t);
  db.tx(() => {
    add('key', job.canonical_key);
    add('url', job.apply_url);
    if (job.advertised_employer) add('title_employer', titleEmployerKey(job.title, job.advertised_employer));
    for (const s of db.all<any>('SELECT source_id, source_job_id, board_url, employer_url FROM source_jobs WHERE job_id = ?', jobId)) {
      add('key', `src:${s.source_id}:${s.source_job_id}`); add('key', `ats:${s.source_id}:${s.source_job_id}`);
      add('url', s.board_url); add('url', s.employer_url);
    }
    db.run('DELETE FROM search_run_candidates WHERE job_id = ?', jobId);
    db.run('DELETE FROM alerts WHERE job_id = ?', jobId);
    db.run('DELETE FROM jobs WHERE id = ?', jobId);
  });
  return { removed: true, title: job.title };
}

/** Insert or update a job + provenance row. Cross-source duplicates collapse onto one canonical record. */
export function upsertJob(d: DiscoveredJob, runId: number | null, db: Db = getDb()): { jobId: number; isNew: boolean } {
  const key = canonicalKey(d);
  let row = db.get<any>('SELECT * FROM jobs WHERE canonical_key = ?', key);
  if (!row) {
    const prov = d.sourceJobId ? db.get<any>('SELECT job_id FROM source_jobs WHERE source_id = ? AND source_job_id = ?', d.sourceId, d.sourceJobId) : null;
    if (prov) row = db.get<any>('SELECT * FROM jobs WHERE id = ?', prov.job_id);
  }
  if (!row && d.employer) {
    // Same employer + same cleaned title + same city within 60 days = same opening.
    const cands = db.all<any>("SELECT * FROM jobs WHERE lower(title) = ? AND first_seen_at >= datetime('now', '-60 days')", collapseWs(d.title).toLowerCase());
    row = cands.find((c) => coreKey(c.advertised_employer ?? '') === coreKey(d.employer!) && (classifyLocation(c.location) === classifyLocation(d.location)));
  }
  const t = now();
  let jobId: number; let isNew = false;
  if (row) {
    jobId = row.id;
    const betterApply = (d.applyUrlKind === 'EMPLOYER_ATS' || d.applyUrlKind === 'EMPLOYER_SITE') && row.apply_url_kind === 'BOARD';
    db.run(`UPDATE jobs SET last_seen_at = ?, listing_state = ?, title = COALESCE(?, title), location = COALESCE(?, location), deadline_at = COALESCE(?, deadline_at),
              salary_text = COALESCE(?, salary_text), apply_url = CASE WHEN ? THEN ? ELSE COALESCE(apply_url, ?) END,
              apply_url_kind = CASE WHEN ? THEN ? ELSE COALESCE(apply_url_kind, ?) END, employer_id = COALESCE(employer_id, ?), advertised_employer = COALESCE(advertised_employer, ?)
            WHERE id = ?`,
      t, d.listingState ?? 'OPEN', d.title !== 'Imported job' ? d.title : null, d.location, d.deadline, d.salaryText,
      betterApply, d.applyUrl, d.applyUrl, betterApply, d.applyUrlKind, d.applyUrlKind, d.employerId ?? null, d.employer, jobId);
  } else {
    const r = db.run(`INSERT INTO jobs(canonical_key, title, advertised_employer, employer_id, location, salary_text, posted_at, deadline_at, listing_state, apply_url, apply_url_kind,
                        source_id, source_job_id, first_seen_at, last_seen_at, is_demo, market)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      key, d.title, d.employer, d.employerId ?? null, d.location, d.salaryText, d.postedAt, d.deadline, d.listingState ?? 'OPEN', d.applyUrl, d.applyUrlKind,
      d.sourceId, d.sourceJobId, t, t, d.isDemo ?? false, d.market ?? marketOfLocation(d.location) ?? 'UK');
    jobId = r.lastInsertRowid; isNew = true;
  }
  if (d.sourceJobId) {
    db.run(`INSERT INTO source_jobs(job_id, source_id, source_job_id, board_url, employer_url, query, run_id, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, source_job_id) DO UPDATE SET board_url = COALESCE(excluded.board_url, board_url), employer_url = COALESCE(excluded.employer_url, employer_url)`,
      jobId, d.sourceId, d.sourceJobId, d.boardUrl, d.employerUrl, d.query ?? null, runId, t);
  }
  return { jobId, isNew };
}

/** Store a new immutable JD version if the text changed. Returns the active version id. */
export function saveJdVersion(jobId: number, d: DiscoveredJob, db: Db = getDb()): { versionId: number | null; changed: boolean; previousId: number | null } {
  const text = d.descriptionText?.trim();
  const active = db.get<any>('SELECT id, hash, complete FROM job_description_versions WHERE job_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', jobId);
  if (!text) return { versionId: active?.id ?? null, changed: false, previousId: null };
  const hash = sha256(collapseWs(text).toLowerCase());
  if (active && active.hash === hash) return { versionId: active.id, changed: false, previousId: null };
  // Never replace a complete JD with an incomplete snippet.
  if (active && active.complete && !d.descriptionComplete) return { versionId: active.id, changed: false, previousId: null };
  return db.tx(() => {
    db.run('UPDATE job_description_versions SET active = 0 WHERE job_id = ?', jobId);
    const r = db.run(`INSERT INTO job_description_versions(job_id, text, hash, source_url, fetched_at, extraction_method, access_mode, complete, active, metadata_json)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      jobId, text, hash, d.employerUrl ?? d.boardUrl ?? d.applyUrl, now(), d.extractionMethod, d.accessMode, d.descriptionComplete,
      JSON.stringify({ legalEmployerHint: d.legalEmployerHint ?? null, salaryText: d.salaryText }));
    return { versionId: r.lastInsertRowid, changed: !!active, previousId: active?.id ?? null };
  });
}

export interface AnalyseOptions { allowAi: boolean; runId?: number | null; intent?: SearchIntent | null }
export interface AnalyseResult { status: Decision['status']; reasons: string[]; aiUsed: boolean; aiError?: string | null; fit: number | null }

/** Run (or re-run) the full analysis for a stored job using its active JD version. */
export async function analyseJob(jobId: number, opts: AnalyseOptions, db: Db = getDb()): Promise<AnalyseResult> {
  const job = db.get<any>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const jd = db.get<any>('SELECT * FROM job_description_versions WHERE job_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', jobId);
  const { version: profileVersion, profile } = getProfile();
  const settings = getSettings();
  const text: string = jd?.text ?? '';
  const sourceUrl: string = jd?.source_url ?? job.apply_url ?? '';
  const meta = j<any>(jd?.metadata_json, {});

  let facts: ExtractedJobFacts = extractRuleFacts({
    title: job.title, advertisedEmployer: job.advertised_employer, location: job.location, text, sourceUrl,
    applyUrl: job.apply_url, salaryText: job.salary_text, closingDate: job.deadline_at, legalEmployerHint: meta.legalEmployerHint ?? null,
  });
  const hasFullJd = !!jd?.complete;
  const market = (job.market ?? 'UK') as 'UK' | GulfMarket;
  const isGulf = market !== 'UK';
  // Scope comes from your target role families (My Search); Gulf tabs use every cyber family.
  const family = isGulf ? matchGulfRole(job.title, profile.target_roles) : matchTargetRole(job.title, profile.target_roles);
  facts.category = family ? family.category : 'OTHER';
  facts.targetRole = family?.label ?? null;
  // Deterministic scam red flags (AI may add more with verified quotes).
  for (const sc of scamSignals(text)) {
    facts.scamSignals = [...(facts.scamSignals ?? []), sc.signal];
    const at = text.indexOf(sc.quote);
    facts.evidence.push({ field: 'scam_signal', quote: sc.quote, startOffset: at >= 0 ? at : undefined, endOffset: at >= 0 ? at + sc.quote.length : undefined, sourceUrl, confidence: 'MEDIUM', origin: 'RULES', validated: at >= 0 });
  }

  // The UK sponsor register only applies to UK jobs.
  const sponsor: SponsorMatch = isGulf
    ? { status: 'EMPLOYER_UNKNOWN', method: 'NOT_APPLICABLE_GULF', matched: null, candidates: [], snapshotId: null, snapshotDate: null, snapshotAge: 'NONE', evidenceUrl: null, note: 'UK sponsor register does not apply to Gulf jobs.' }
    : matchEmployer({ employerId: job.employer_id, advertisedEmployer: job.advertised_employer, legalEmployer: facts.legalEmployer, evidenceUrl: sourceUrl || null }, db);

  // ---- optional AI extraction (only after cheap gates; cached by JD hash + model + prompt + rules + profile)
  let aiUsed = false; let aiError: string | null = null; let ai: AiFacts | null = null; let unverified: string[] = [];
  const cheapHardFail = (!isGulf && sponsor.status === 'NOT_FOUND') || facts.category === 'OTHER' || isSeniorTitle(job.title) || !hasFullJd;
  if (jd && settings.ai_enabled && !cheapHardFail) {
    const cacheKey = sha256(`${jd.hash}|${settings.openai_model}|${PROMPT_VERSION}|${RULES_VERSION}|${profileVersion}`);
    const cached = db.get<any>('SELECT ai_json FROM job_facts WHERE cache_key = ? AND ai_json IS NOT NULL ORDER BY id DESC LIMIT 1', cacheKey);
    if (cached) { ai = j<AiFacts | null>(cached.ai_json, null); aiUsed = !!ai; }
    else if (opts.allowAi) {
      const res = await aiExtract({ title: job.title, employer: job.advertised_employer, location: job.location, text, profile, runId: opts.runId ?? null });
      if (res.ok && res.facts) { ai = res.facts; aiUsed = true; } else aiError = res.error ?? 'AI failed';
    }
    if (ai) { const merged = mergeAiFacts(facts, ai, text, sourceUrl); facts = merged.facts; unverified = merged.unverified; }
    db.run(`INSERT INTO job_facts(jd_version_id, extraction_json, rule_facts_json, ai_json, evidence_validated, model, prompt_version, profile_version, cache_key, ai_error, created_at)
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`, jd.id, JSON.stringify(facts), ai ? JSON.stringify(ai) : null, unverified.length === 0, ai ? settings.openai_model : null, PROMPT_VERSION, profileVersion, cacheKey, aiError, now());
  } else if (jd && db.get<any>('SELECT extraction_json FROM job_facts WHERE jd_version_id = ? ORDER BY id DESC LIMIT 1', jd.id)?.extraction_json !== JSON.stringify(facts)) {
    db.run(`INSERT INTO job_facts(jd_version_id, extraction_json, evidence_validated, prompt_version, profile_version, created_at) VALUES (?, ?, 1, ?, ?, ?)`,
      jd.id, JSON.stringify(facts), PROMPT_VERSION, profileVersion, now());
  }

  const decision = isGulf
    ? evaluateGulf({ market: market as GulfMarket, title: job.title, location: job.location, text, hasFullJd, listingState: job.listing_state, deadline: job.deadline_at ?? facts.closingDate, facts, family, today: todayLondon(),
        postedAt: job.posted_at, applyKind: job.apply_url_kind, minScoreEligible: settings.gulf_eligible_min_score })
    : evaluate({
      job: { listingState: job.listing_state, hasFullJd, title: job.title, location: job.location, deadline: job.deadline_at, employer: job.advertised_employer, text },
      facts, sponsor, profile, settings,
      ai: { used: aiUsed, failed: !!aiError, unverifiedClaims: unverified },
    });
  // If AI was requested but failed, the job may not be presented as VERIFIED on rules alone.
  if (aiError && opts.allowAi && settings.ai_enabled && decision.status === 'VERIFIED_COMPATIBLE') {
    decision.status = 'NEEDS_REVIEW';
    decision.reasons.push({ code: 'AI_EVIDENCE_UNVERIFIED', severity: 'uncertain', message: `AI analysis failed (${aiError}); re-analyse before treating as verified.` });
  }
  // Manual review verdicts (spec §14.1 #9) apply to the JD version they were made on; hard fails can't be overridden.
  const verdict = db.get<any>('SELECT review_verdict, override_note, at FROM user_feedback WHERE job_id = ? AND review_verdict IS NOT NULL ORDER BY id DESC LIMIT 1', jobId);
  if (verdict && j<any>(verdict.override_note, {}).jdVersionId === (jd?.id ?? null) && decision.status !== 'STALE') {
    const hard = decision.reasons.some((r) => r.severity === 'hard_fail');
    if (verdict.review_verdict === 'CONFIRMED_INELIGIBLE') {
      const first = decision.reasons.find((r) => r.severity === 'uncertain');
      decision.status = 'EXCLUDED';
      decision.reasons.unshift({ code: first?.code ?? 'SPONSORSHIP_NOT_CONFIRMED', severity: 'hard_fail', message: `You confirmed this job is not eligible (${String(verdict.at).slice(0, 10)}).`, evidence: null, profileSetting: 'verified_by_user' });
    } else if (verdict.review_verdict === 'CONFIRMED_ELIGIBLE' && !hard && decision.status === 'NEEDS_REVIEW') {
      decision.status = 'POTENTIAL_NO_STATED_BLOCKER';
      for (const r of decision.reasons) if (r.severity === 'uncertain') { r.severity = 'advisory'; r.message = `[Resolved by you] ${r.message}`; }
      decision.reasons.unshift({ code: 'SPONSORSHIP_NOT_CONFIRMED', severity: 'advisory', message: `Uncertain items marked "Confirmed eligible" by you on ${String(verdict.at).slice(0, 10)} (verified_by_user). Not an employer confirmation.`, evidence: null });
    }
  }
  // Posting-age window (editable): older postings are treated as stale and never shown as eligible.
  const postedIso = parsePostedDate(job.posted_at);
  if (postedIso && decision.status !== 'STALE' && decision.status !== 'EXCLUDED' && daysBetween(postedIso, todayLondon()) > settings.max_posting_age_days) {
    decision.status = 'STALE';
    decision.reasons.unshift({ code: 'VACANCY_CLOSED', severity: 'hard_fail', message: `Posted ${postedIso} — older than your ${settings.max_posting_age_days}-day window.`, evidence: null, profileSetting: 'max_posting_age_days' });
  }
  if (!postedIso && decision.status !== 'EXCLUDED') decision.reasons.push({ code: 'VACANCY_CLOSED', severity: 'advisory', message: 'Posting date not given by the source — it was live when last checked.', evidence: null });
  if (/^ai_web_read/.test(jd?.extraction_method ?? '')) decision.reasons.push({ code: 'AI_EVIDENCE_UNVERIFIED', severity: 'advisory', message: 'The app could not open this page itself; the posting was read by OpenAI web search and its key sentences were quoted back. Open the link to double-check.', evidence: null });
  const feedback = db.get<any>('SELECT strong_fit, not_interested FROM user_feedback WHERE job_id = ? ORDER BY id DESC LIMIT 1', jobId);
  // Visa-friendly employer signal: other adverts from the same employer/legal entity explicitly offered sponsorship or accepted Graduate visas.
  const legal = sponsor.matched?.legal_name ?? null;
  const friendly = (job.employer_id || legal) ? db.get<any>(`SELECT COUNT(*) n FROM job_decisions d JOIN jobs j2 ON j2.id = d.job_id
      WHERE d.active = 1 AND j2.id != ? AND ((? IS NOT NULL AND j2.employer_id = ?) OR (? IS NOT NULL AND j2.legal_employer = ?))
        AND (json_extract(d.matrix_json, '$.vacancy_offers_sponsorship') = 'EXPLICIT_YES' OR json_extract(d.matrix_json, '$.role_accepts_graduate_visa') = 'EXPLICIT_YES')`,
    jobId, job.employer_id, job.employer_id, legal, legal)?.n ?? 0 : 0;
  const fit = scoreJob({ facts, decision, sponsor, profile, jdText: text, location: job.location, postedAt: job.posted_at, applyUrlKind: job.apply_url_kind, hasFullJd,
    feedbackBoost: (feedback?.strong_fit ? 5 : 0) + (friendly > 0 ? settings.visa_friendly_boost : 0) });
  if (fit && friendly > 0) {
    fit.whyItFits.unshift(`Visa-friendly employer: ${friendly} other advert(s) from ${legal ?? job.advertised_employer} explicitly offered sponsorship or accepted Graduate visas.`);
    (fit as any).visaFriendly = friendly;
  }

  const prev = db.get<any>('SELECT status, reasons_json FROM job_decisions WHERE job_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', jobId);
  db.tx(() => {
    db.run('UPDATE job_decisions SET active = 0 WHERE job_id = ?', jobId);
    db.run(`INSERT INTO job_decisions(job_id, jd_version_id, sponsor_snapshot_id, profile_version, rules_version, status, reasons_json, matrix_json, sponsor_match_json, fit_score, fit_json, created_at, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      jobId, jd?.id ?? null, sponsor.snapshotId, profileVersion, decision.rulesVersion, decision.status, JSON.stringify({ reasons: decision.reasons, permissionNote: decision.permissionNote, facts }),
      JSON.stringify(decision.matrix), JSON.stringify(sponsor), fit?.total ?? null, fit ? JSON.stringify(fit) : null, now());
    db.run(`UPDATE jobs SET current_status = ?, current_fit = ?, category = ?, employment_type = ?, legal_employer = ?, deadline_at = COALESCE(deadline_at, ?), last_checked_at = ? WHERE id = ?`,
      decision.status, fit?.total ?? null, facts.category, facts.employmentType, sponsor.matched?.legal_name ?? facts.legalEmployer, facts.closingDate, now(), jobId);
    // Change alerts for tracked jobs (applied/saved) when eligibility changes.
    if (prev && prev.status !== decision.status) {
      const app = db.get<any>('SELECT stage FROM applications WHERE job_id = ?', jobId);
      const prevCodes = new Set((j<any>(prev.reasons_json, {}).reasons ?? []).map((r: any) => r.code));
      const newHard = decision.reasons.filter((r) => r.severity === 'hard_fail' && !prevCodes.has(r.code)).map((r) => r.code);
      if (app || newHard.length) {
        db.run('INSERT INTO alerts(at, kind, job_id, message) VALUES (?, ?, ?, ?)', now(), 'ELIGIBILITY_CHANGED', jobId,
          `"${job.title}" (${job.advertised_employer ?? 'employer'}) changed from ${prev.status} to ${decision.status}${newHard.length ? ` — new: ${newHard.join(', ')}` : ''}.`);
      }
    }
  });
  return { status: decision.status, reasons: decision.reasons.filter((r) => r.severity !== 'advisory').map((r) => r.code), aiUsed, aiError, fit: fit?.total ?? null };
}

/** Re-evaluate every stored job (after profile, sponsor-mapping or snapshot changes). No network/AI calls. */
export async function reevaluateAll(filter: { employerId?: number; gulfOnly?: boolean; outdatedOnly?: boolean } = {}, db: Db = getDb()): Promise<number> {
  const ids = filter.employerId
    ? db.all<{ id: number }>('SELECT id FROM jobs WHERE employer_id = ?', filter.employerId)
    : filter.outdatedOnly
      // Jobs graded under older rules (after an update) — re-graded with the current rules, no AI calls.
      ? db.all<{ id: number }>(`SELECT j.id FROM jobs j JOIN job_decisions d ON d.job_id = j.id AND d.active = 1
          WHERE j.listing_state = 'OPEN' AND d.rules_version NOT IN (?, ?)`, RULES_VERSION, GULF_RULES_VERSION)
      : filter.gulfOnly
        ? db.all<{ id: number }>("SELECT id FROM jobs WHERE market != 'UK' AND listing_state = 'OPEN'")
        : db.all<{ id: number }>('SELECT id FROM jobs');
  for (const { id } of ids) await analyseJob(id, { allowAi: false }, db);
  return ids.length;
}
