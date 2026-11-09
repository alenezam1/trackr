// DETERMINISTIC eligibility policy engine (spec §7). AI output never decides a hard rule by itself:
// it arrives here only as schema- and evidence-validated facts. Hard failures always win over fit scores.
import type { Decision, DecisionReason, ExtractedJobFacts, Profile, ReasonCode, Severity, SponsorMatch, VisaMatrix } from '../models.js';
import { RULES_VERSION } from '../models.js';
import type { AppSettings } from '../../config/settings.js';
import { permissionView } from './permission.js';
import { classifyLocation, NOT_A_VACANCY_TITLE } from '../extraction/classify.js';
import { addMonths, todayLondon } from '../util/text.js';
import { evaluateCustomRules } from '../discovery/roles.js';

export interface EvalInput {
  job: { listingState: 'OPEN' | 'CLOSED' | 'UNKNOWN'; hasFullJd: boolean; title: string; location: string | null; applyLinkBroken?: boolean; deadline?: string | null; employer?: string | null; text?: string };
  facts: ExtractedJobFacts;
  sponsor: SponsorMatch;
  profile: Profile;
  settings: AppSettings;
  ai?: { used: boolean; failed: boolean; unverifiedClaims: string[] };
  today?: string;
}

export function evaluate(inp: EvalInput): Decision {
  const { facts: f, profile: p, sponsor: sm, job } = inp;
  const today = inp.today ?? todayLondon();
  const reasons: DecisionReason[] = [];
  const add = (code: ReasonCode, severity: Severity, message: string, evField?: string | string[], profileSetting?: string) => {
    const fields = Array.isArray(evField) ? evField : evField ? [evField] : [];
    const e = f.evidence.find((x) => fields.some((fl) => x.field === fl || x.field.startsWith(fl)));
    reasons.push({ code, severity, message, evidence: e ? { quote: e.quote, sourceUrl: e.sourceUrl, origin: e.origin } : null, profileSetting });
  };
  const perm = permissionView(p, inp.settings, today);

  // ---- listing state
  const deadline = f.closingDate ?? job.deadline ?? null;
  const closed = job.listingState === 'CLOSED' || (deadline != null && deadline < today);
  if (closed) add('VACANCY_CLOSED', 'hard_fail', deadline && deadline < today ? `Closing date ${deadline} has passed.` : 'The listing is closed or no longer reachable.', 'closing_date');
  if (job.applyLinkBroken) add('APPLICATION_LINK_BROKEN', 'uncertain', 'The application link did not load when last checked.');

  // ---- full JD
  if (!job.hasFullJd) add('FULL_JD_NOT_READ', 'uncertain', 'Only a title/snippet is available. Eligibility cannot be assessed without the full job description.');

  // ---- sponsor gate (strict, even when the vacancy says it does not sponsor)
  const rating = sm.matched?.rating ?? null;
  if (sm.snapshotAge === 'NONE') add('SPONSOR_DATA_STALE', 'uncertain', 'No sponsor register snapshot is loaded.');
  else if (sm.snapshotAge === 'STALE') add('SPONSOR_DATA_STALE', 'uncertain', `Sponsor register snapshot ${sm.snapshotDate} is stale; refresh before relying on it.`);
  else if (sm.snapshotAge === 'AGING') add('SPONSOR_DATA_STALE', 'advisory', `Sponsor register snapshot ${sm.snapshotDate} is ageing.`);
  if (sm.status === 'NOT_FOUND') add('SPONSOR_NOT_FOUND', 'hard_fail', sm.note);
  else if (sm.status === 'PROPOSED' || sm.status === 'AMBIGUOUS') add('SPONSOR_AMBIGUOUS', 'uncertain', sm.note);
  else if (sm.status === 'EMPLOYER_UNKNOWN') add('ACTUAL_EMPLOYER_UNKNOWN', 'uncertain', sm.note);
  else if (sm.method === 'AUTO_STRONG_MATCH') add('SPONSOR_AMBIGUOUS', 'advisory', `${sm.note} Confirm on the Sponsors page before relying on it.`);
  if ((sm.status === 'VERIFIED_EXACT' || sm.status === 'VERIFIED_ALIAS') && rating && rating !== 'A') add('SPONSOR_B_RATED', inp.settings.exclude_b_rated_sponsors && rating === 'B' ? 'hard_fail' : 'uncertain', `Register rating is "${sm.matched?.type_rating}". B-rated sponsors cannot normally assign new Certificates of Sponsorship.`);

  // ---- scope
  if (f.category === 'OTHER') add('OUT_OF_SCOPE_ROLE', 'hard_fail', f.targetRole === null
    ? `"${job.title}" doesn't match any of your enabled target roles (edit them on My Search).`
    : `"${job.title}" is outside Security/SOC, GRC/Risk/Audit and IT/Infrastructure.`);
  else if (f.category === 'UNKNOWN') add('OUT_OF_SCOPE_ROLE', 'uncertain', 'Role category could not be determined from the title/JD.');
  else if (!p.enabled_categories.includes(f.category)) add('OUT_OF_SCOPE_ROLE', 'hard_fail', `Category ${f.category} is disabled in your profile.`, undefined, 'enabled_categories');
  const loc = classifyLocation(job.location ?? f.location);
  if (loc === 'NON_UK') add('LOCATION_OUT_OF_SCOPE', 'hard_fail', `Location "${job.location}" is outside the UK.`);
  else if (loc === 'AMBIGUOUS_REMOTE' || loc === 'UNKNOWN') add('LOCATION_OUT_OF_SCOPE', 'uncertain', `Location "${job.location ?? 'not stated'}" — confirm the role can be done from the UK.`);
  if (f.isSeniorTitle) add('SENIOR_JOB', 'hard_fail', `Title "${job.title}" indicates a senior/managerial role.`);
  else if (f.aiSeniority === 'SENIOR') add('SENIOR_JOB', 'hard_fail', 'AI read the full job description as a senior role.', 'seniority');
  else if (f.aiSeniority === 'MID') add('EXPERIENCE_EXCEEDS_ENTRY_LEVEL', 'uncertain', 'AI read the full job description as mid-level, not entry-level.', 'seniority');

  // ---- posting quality: must be one real vacancy, not a listing page or a scam
  if (f.postingType === 'JOB_LISTING_PAGE' || f.postingType === 'NOT_A_JOB') add('NOT_A_JOB_POSTING', 'hard_fail', f.postingType === 'JOB_LISTING_PAGE' ? 'This page is a list of jobs, not one job posting.' : 'This page is not a job posting.');
  else if (NOT_A_VACANCY_TITLE.test(job.title)) add('NOT_A_JOB_POSTING', 'hard_fail', 'Talent pool / "register your interest" page — not a vacancy you can apply to.');
  if (f.scamSignals?.length) add('SUSPECTED_SCAM', 'hard_fail', `Possible scam: ${[...new Set(f.scamSignals)].join('; ')}.`, 'scam_signal');

  // ---- nationality / residency
  if (f.BritishCitizenshipMandatory) add('REQUIRES_BRITISH_CITIZENSHIP', 'hard_fail', 'The JD makes British/UK citizenship mandatory.', 'british_citizenship_mandatory', 'nationality');
  for (const r of f.otherNationalityRestrictions) {
    if (!r.toLowerCase().includes(p.nationality.toLowerCase())) add('OTHER_NATIONALITY_RESTRICTION', 'hard_fail', `Nationality restriction "${r}" does not include your nationality.`, 'other_nationality_restriction', 'nationality');
  }
  if (f.ukResidencyRequirementYears != null) {
    if (p.uk_residency_years == null) add('RESIDENCY_REQUIREMENT_UNMET', 'uncertain', `Requires ${f.ukResidencyRequirementYears} years' UK residency; your residency is not set in Settings.`, 'uk_residency_years', 'uk_residency_years');
    else if (p.uk_residency_years < f.ukResidencyRequirementYears) add('RESIDENCY_REQUIREMENT_UNMET', 'hard_fail', `Requires ${f.ukResidencyRequirementYears} years' UK residency; profile has ${p.uk_residency_years}.`, 'uk_residency_years', 'uk_residency_years');
  }

  // ---- clearance (personal policy: user excludes these levels)
  const disallow = new Set(p.disallow_mandatory_clearance.map((x) => x.toUpperCase()));
  for (const c of f.mandatoryClearances) {
    const code: ReasonCode = c === 'SC' ? 'SC_REQUIRED' : c === 'DV' ? 'DV_REQUIRED' : c === 'CTC' ? 'CTC_REQUIRED' : 'OTHER_MANDATORY_VETTING';
    if (disallow.has(c)) add(code, 'hard_fail', `Mandatory ${c} clearance (including "eligible for/obtain" wording) is excluded by your settings.`, `clearance_mandatory_${c}`, 'disallow_mandatory_clearance');
    else add('OTHER_MANDATORY_VETTING', 'uncertain', `Mandatory vetting (${c}) — check whether you can meet it.`, `clearance_mandatory_${c}`);
  }
  if (f.ambiguousVetting) add('OTHER_MANDATORY_VETTING', 'uncertain', 'Security vetting is mentioned without a clear level or requirement. BPSS/DBS alone are not SC.', 'clearance_ambiguous');

  // ---- work authorisation language
  if (f.graduateVisaLanguage === 'EXPLICIT_DISALLOWED') add('GRADUATE_VISA_EXPLICITLY_DISALLOWED', 'hard_fail', 'The JD explicitly does not accept time-limited/Graduate visas.', 'graduate_visa_disallowed', 'uk_visa_status');
  if (f.permanentRightToWorkRequired) add('PERMANENT_WORK_AUTHORISATION_REQUIRED', 'hard_fail', 'The JD requires permanent/unrestricted/settled right to work.', 'permanent_right_to_work_required', 'uk_visa_status');
  if (f.noFutureSponsorshipStrict) {
    add('NO_FUTURE_SPONSORSHIP', p.needs_eventual_skilled_worker_transition ? 'hard_fail' : 'advisory',
      'The JD requires that you never need sponsorship (now or in the future).', 'no_sponsorship_now_or_future', 'needs_eventual_skilled_worker_transition');
  }
  if (f.graduateVisaLanguage === 'AMBIGUOUS' || f.sponsorPolicy === 'AMBIGUOUS') add('SPONSORSHIP_NOT_CONFIRMED', 'uncertain', 'Visa/sponsorship wording is ambiguous or contradictory.', ['no_sponsorship', 'sponsorship_offered']);

  // ---- student / cohort
  if (f.currentStudentRequired && !p.currently_enrolled && !p.allow_student_only_placements) add('CURRENT_STUDENT_REQUIRED', 'hard_fail', 'Restricted to currently enrolled students / placement-year students.', 'current_student_required', 'currently_enrolled');
  if (f.permittedGraduationYears?.length) {
    if (p.graduation_year == null) add('GRADUATION_COHORT_INELIGIBLE', 'uncertain', `Restricted to graduation years ${f.permittedGraduationYears.join(', ')}; set your graduation year in Settings.`, 'permitted_graduation_years', 'graduation_year');
    else if (!f.permittedGraduationYears.includes(p.graduation_year)) add('GRADUATION_COHORT_INELIGIBLE', 'hard_fail', `Restricted to graduation years ${f.permittedGraduationYears.join(', ')}; you graduated in ${p.graduation_year}.`, 'permitted_graduation_years', 'graduation_year');
  }

  // ---- experience
  if (f.requiredExperienceYears != null && f.requiredExperienceYears > p.max_required_relevant_experience_years) {
    if (f.experienceRequirement === 'MANDATORY') add('EXPERIENCE_EXCEEDS_ENTRY_LEVEL', 'hard_fail', `Requires ${f.requiredExperienceYears}+ years' experience (your limit: ${p.max_required_relevant_experience_years}).`, 'experience_required', 'max_required_relevant_experience_years');
    else if (f.experienceRequirement === 'PREFERRED') add('EXPERIENCE_EXCEEDS_ENTRY_LEVEL', 'advisory', `${f.requiredExperienceYears} years' experience is preferred, not mandatory.`, 'experience_preferred');
  }

  // ---- pay
  if (f.isPaid === false && p.accept_only_paid_roles) add('UNPAID_ROLE', 'hard_fail', 'The role is unpaid/voluntary.', 'unpaid', 'accept_only_paid_roles');

  // ---- duration vs permission
  const limit = perm.confirmedExpiry ?? perm.estimatedExpiry;
  const limitKind = perm.confirmedExpiry ? 'confirmed' : 'estimated';
  const transition = f.sponsorPolicy === 'OFFERS_SPONSORSHIP';
  const months = f.programmeMonths ?? f.contractMonths;
  let feasibility: VisaMatrix['duration_feasibility'] = 'UNKNOWN';
  const start = f.startDate ?? (p.earliest_available_start_date && p.earliest_available_start_date > today ? p.earliest_available_start_date : today);
  if (months != null) {
    const end = addMonths(start, months);
    const isProgramme = f.programmeMonths != null || f.employmentType === 'GRADUATE_PROGRAMME';
    if (isProgramme && months >= 36) {
      if (!transition) { feasibility = 'EXPLICITLY_INCOMPATIBLE'; add('PROGRAMME_EXCEEDS_WORK_PERMISSION', 'hard_fail', `${months / 12}-year programme with no evidenced sponsorship/transition before Graduate permission ends.`, 'programme_length'); }
      else { feasibility = 'NEEDS_FUTURE_TRANSITION'; add('PROGRAMME_EXCEEDS_WORK_PERMISSION', 'uncertain', `${months / 12}-year programme states sponsorship may be offered — review credibility and individual eligibility${p.allow_long_programme_exception ? ' (long-programme exception enabled)' : ''}.`, ['programme_length', 'sponsorship_offered']); }
    } else if (limit && end > limit) {
      feasibility = transition ? 'NEEDS_FUTURE_TRANSITION' : 'EXPLICITLY_INCOMPATIBLE';
      const sev: Severity = perm.confirmedExpiry && !transition ? 'hard_fail' : 'uncertain';
      add('PROGRAMME_EXCEEDS_WORK_PERMISSION', sev, `Expected end ${end} (start ${start} + ${months} months) is after your ${limitKind} permission end ${limit}.`, ['programme_length', 'contract_length']);
    } else if (perm.confirmedExpiry) feasibility = 'WITHIN_CONFIRMED_PERMISSION';
    else feasibility = 'UNKNOWN';
  } else if (f.employmentType === 'PERMANENT' || f.employmentType === 'UNKNOWN') {
    feasibility = p.needs_eventual_skilled_worker_transition ? 'NEEDS_FUTURE_TRANSITION' : 'UNKNOWN';
  } else if (f.employmentType === 'FIXED_TERM') {
    add('CONTRACT_DURATION_UNKNOWN', 'advisory', 'Fixed-term role without a stated duration — no restriction stated; check the length before accepting an offer.');
  } else if (f.employmentType === 'GRADUATE_PROGRAMME') {
    add('CONTRACT_DURATION_UNKNOWN', 'advisory', 'Graduate programme length is not stated — no restriction stated; check it fits your visa before accepting an offer.');
  }

  // ---- start date
  if (f.startDate && p.earliest_available_start_date && f.startDate < p.earliest_available_start_date) add('VISA_START_DATE_INCOMPATIBLE', 'uncertain', `Start date ${f.startDate} is before your earliest available start ${p.earliest_available_start_date}.`, 'start_date', 'earliest_available_start_date');
  if (f.startDate && limit && f.startDate > limit) add('VISA_START_DATE_INCOMPATIBLE', perm.confirmedExpiry ? 'hard_fail' : 'uncertain', `Start date ${f.startDate} is after your ${limitKind} permission end ${limit}.`, 'start_date');
  if (p.uk_visa_status === 'student') add('VISA_START_DATE_INCOMPATIBLE', 'uncertain', 'You are on Student permission: check permitted hours and that the start date is after your course end.', undefined, 'uk_visa_status');

  // ---- future sponsorship (non-strict "no sponsorship")
  if (f.sponsorPolicy === 'NO_SPONSORSHIP' && !f.noFutureSponsorshipStrict) {
    const needsFuture = feasibility === 'NEEDS_FUTURE_TRANSITION' || feasibility === 'EXPLICITLY_INCOMPATIBLE';
    add('NO_FUTURE_SPONSORSHIP', needsFuture && p.needs_eventual_skilled_worker_transition ? 'uncertain' : 'advisory',
      'The vacancy says it does not offer sponsorship. You may work while your Graduate visa is valid, but there is no stated route beyond it.', 'no_sponsorship');
  }
  if (p.require_explicit_role_sponsorship && f.sponsorPolicy !== 'OFFERS_SPONSORSHIP') add('SPONSORSHIP_NOT_CONFIRMED', 'uncertain', 'Strict mode: this vacancy does not explicitly offer sponsorship.', undefined, 'require_explicit_role_sponsorship');
  if (inp.ai?.unverifiedClaims?.length) add('AI_EVIDENCE_UNVERIFIED', 'uncertain', `AI claims could not be found in the JD text: ${inp.ai.unverifiedClaims.slice(0, 3).join('; ')}`);

  // ---- your own custom restrictions (My Rules page)
  for (const h of evaluateCustomRules(p.custom_restrictions ?? [], { title: job.title, employer: job.employer ?? null, text: job.text ?? '' })) {
    const what = h.rule.kind === 'require_text' ? `doesn't mention any of: ${h.rule.terms.join(', ')}` : `matches: ${h.rule.terms.join(', ')}`;
    reasons.push({ code: 'CUSTOM_RESTRICTION', severity: h.rule.action === 'exclude' ? 'hard_fail' : 'uncertain', message: `Your rule "${h.rule.label}" — ${what}.`, evidence: h.quote ? { quote: h.quote, origin: 'RULES' } : null, profileSetting: 'custom_restrictions' });
  }

  // ---- your rule switches (My Rules page): a switched-off rule is still shown, but only as information.
  const off = new Set<string>();
  if (!p.requires_sponsor_licensed_employer) ['SPONSOR_NOT_FOUND', 'SPONSOR_AMBIGUOUS', 'ACTUAL_EMPLOYER_UNKNOWN', 'SPONSOR_B_RATED', 'SPONSOR_DATA_STALE'].forEach((c) => off.add(c));
  if (!p.exclude_citizenship_restricted) ['REQUIRES_BRITISH_CITIZENSHIP', 'OTHER_NATIONALITY_RESTRICTION', 'RESIDENCY_REQUIREMENT_UNMET'].forEach((c) => off.add(c));
  if (!p.exclude_permanent_rtw_required) off.add('PERMANENT_WORK_AUTHORISATION_REQUIRED');
  if (!p.exclude_graduate_visa_bans) off.add('GRADUATE_VISA_EXPLICITLY_DISALLOWED');
  if (!p.exclude_senior_roles) off.add('SENIOR_JOB');
  for (const r of reasons) {
    if (r.severity === 'advisory') continue;
    const softVetting = !p.review_ambiguous_vetting && r.code === 'OTHER_MANDATORY_VETTING' && r.severity === 'uncertain';
    const softLocation = !p.review_unclear_location && r.code === 'LOCATION_OUT_OF_SCOPE' && r.severity === 'uncertain';
    if (off.has(r.code) || softVetting || softLocation) { r.severity = 'advisory'; r.message = `[Rule switched off] ${r.message}`; }
  }

  // ---- matrix
  const hasHard = reasons.some((r) => r.severity === 'hard_fail');
  const hasUncertain = reasons.some((r) => r.severity === 'uncertain');
  const gv: VisaMatrix['role_accepts_graduate_visa'] = !job.hasFullJd ? 'UNKNOWN'
    : f.graduateVisaLanguage === 'EXPLICIT_DISALLOWED' || f.permanentRightToWorkRequired ? 'EXPLICIT_NO'
      : f.graduateVisaLanguage === 'EXPLICIT_ALLOWED' ? 'EXPLICIT_YES'
        : f.graduateVisaLanguage === 'AMBIGUOUS' ? 'UNKNOWN' : 'NO_STATED_BLOCKER';
  const matrix: VisaMatrix = {
    current_right_to_work: perm.currentRightToWork,
    role_accepts_graduate_visa: gv,
    vacancy_offers_sponsorship: f.sponsorPolicy === 'OFFERS_SPONSORSHIP' ? 'EXPLICIT_YES' : f.sponsorPolicy === 'NO_SPONSORSHIP' ? 'EXPLICIT_NO' : 'UNKNOWN',
    employer_has_skilled_worker_licence: sm.snapshotAge === 'STALE' || sm.snapshotAge === 'NONE' ? 'STALE'
      : sm.status === 'NOT_FOUND' ? 'NOT_FOUND'
        : sm.status === 'VERIFIED_EXACT' || sm.status === 'VERIFIED_ALIAS' ? (rating === 'A' ? 'VERIFIED_A' : 'VERIFIED_B') : 'AMBIGUOUS',
    duration_feasibility: feasibility,
    overall_immigration_assessment: 'NO_STATED_BLOCKER_UNCONFIRMED',
  };
  const evidencedPath = sm.method !== 'AUTO_STRONG_MATCH' && (gv === 'EXPLICIT_YES' || matrix.vacancy_offers_sponsorship === 'EXPLICIT_YES')
    && matrix.current_right_to_work === 'CONFIRMED' && feasibility !== 'EXPLICITLY_INCOMPATIBLE';
  matrix.overall_immigration_assessment = hasHard ? 'EXCLUDED' : hasUncertain ? 'NEEDS_REVIEW' : evidencedPath ? 'EVIDENCED_PATH' : 'NO_STATED_BLOCKER_UNCONFIRMED';

  let status: Decision['status'];
  if (closed) status = 'STALE';
  else if (hasHard) status = 'EXCLUDED';
  else if (hasUncertain) status = 'NEEDS_REVIEW';
  else if (evidencedPath) status = 'VERIFIED_COMPATIBLE';
  else {
    status = 'POTENTIAL_NO_STATED_BLOCKER';
    const why = matrix.current_right_to_work !== 'CONFIRMED'
      ? 'Your work permission is not confirmed in Settings, and/or the JD does not explicitly accept Graduate visas.'
      : 'The JD does not explicitly accept Graduate visas or offer sponsorship. Silence is not confirmation.';
    add('SPONSORSHIP_NOT_CONFIRMED', 'advisory', why);
  }

  return {
    status,
    reasons: reasons.sort((a, b) => sevRank(a.severity) - sevRank(b.severity)),
    matrix,
    rulesVersion: RULES_VERSION,
    permissionNote: `${perm.estimateBasis} ${perm.rulesNote}`.trim(),
  };
}

function sevRank(s: Severity) { return s === 'hard_fail' ? 0 : s === 'uncertain' ? 1 : 2; }
