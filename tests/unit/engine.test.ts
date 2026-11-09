import { describe, expect, it } from 'vitest';
import { evaluate } from '../../server/core/eligibility/engine.js';
import { extractRuleFacts } from '../../server/core/extraction/rules.js';
import { ProfileSchema, type SponsorMatch } from '../../server/core/models.js';
import { AppSettingsSchema } from '../../server/config/settings.js';
import { graduateVisaMonths, permissionView } from '../../server/core/eligibility/permission.js';
import { parseNaturalLanguage } from '../../server/core/discovery/intent.js';
import { coreKey, exactKey, parseRating, splitTradingAs } from '../../server/core/sponsors/normalize.js';
import { mergeAiFacts } from '../../server/core/ai/openai.js';
import { scoreJob } from '../../server/core/ranking/score.js';

const settings = AppSettingsSchema.parse({});
const TODAY = '2026-10-14';
const verified: SponsorMatch = {
  status: 'VERIFIED_EXACT', method: 'EXACT_REGISTER_NAME', matched: { id: 1, legal_name: 'Example Ltd', town: 'London', county: '', route: 'Skilled Worker', rating: 'A', type_rating: 'Worker (A rating)' },
  candidates: [], snapshotId: 1, snapshotDate: '2026-10-05', snapshotAge: 'CURRENT', evidenceUrl: null, note: '',
};
const run = (text: string, o: { title?: string; sponsor?: Partial<SponsorMatch>; profile?: any; full?: boolean; location?: string } = {}) => {
  const title = o.title ?? 'Junior Security Analyst';
  const padded = text + '\n' + 'Our security team protects customers and colleagues. '.repeat(8);
  const facts = extractRuleFacts({ title, advertisedEmployer: 'Example Ltd', location: o.location ?? 'London', text: padded, sourceUrl: 'https://x.test' });
  return evaluate({
    job: { listingState: 'OPEN', hasFullJd: o.full ?? true, title, location: o.location ?? 'London' },
    facts, sponsor: { ...verified, ...(o.sponsor ?? {}) } as SponsorMatch, profile: ProfileSchema.parse(o.profile ?? {}), settings, today: TODAY,
  });
};
const codes = (d: ReturnType<typeof run>) => d.reasons.filter((r) => r.severity !== 'advisory').map((r) => r.code);

describe('eligibility engine', () => {
  it('silence about visas → POTENTIAL, never VERIFIED', () => {
    const d = run('Permanent role. All applicants must have the right to work in the UK.');
    expect(d.status).toBe('POTENTIAL_NO_STATED_BLOCKER');
    expect(d.matrix.role_accepts_graduate_visa).toBe('NO_STATED_BLOCKER');
  });
  it('explicit graduate-visa acceptance still needs CONFIRMED permission for VERIFIED', () => {
    const txt = '6-month internship. Graduate visa holders are welcome to apply.';
    expect(run(txt).status).toBe('POTENTIAL_NO_STATED_BLOCKER');
    const d = run(txt, { profile: { uk_visa_status: 'graduate_granted', graduate_visa_expiry_date: '2028-09-30', work_permission_evidence_checked: true } });
    expect(d.status).toBe('VERIFIED_COMPATIBLE');
    expect(d.matrix.duration_feasibility).toBe('WITHIN_CONFIRMED_PERMISSION');
  });
  it('sponsor NOT_FOUND is a hard fail even with a perfect JD', () => {
    const d = run('Graduate visa holders are welcome to apply.', { sponsor: { status: 'NOT_FOUND', matched: null } });
    expect(d.status).toBe('EXCLUDED');
    expect(codes(d)).toContain('SPONSOR_NOT_FOUND');
  });
  it('proposed/ambiguous sponsor → review, B rating → review', () => {
    expect(run('x', { sponsor: { status: 'PROPOSED', matched: null } }).status).toBe('NEEDS_REVIEW');
    expect(codes(run('x', { sponsor: { matched: { ...verified.matched!, rating: 'B', type_rating: 'Worker (B rating)' } } }))).toContain('SPONSOR_B_RATED');
  });
  it('B-rated sponsors are excluded by default', () => {
    const d = run('x', { sponsor: { matched: { ...verified.matched!, rating: 'B', type_rating: 'Worker (B rating)' } } });
    expect(d.status).toBe('EXCLUDED');
  });
  it('auto-matched sponsor can be Potential but never Verified', () => {
    const d = run('6-month internship. Graduate visa holders are welcome to apply.', { sponsor: { status: 'VERIFIED_ALIAS', method: 'AUTO_STRONG_MATCH' }, profile: { uk_visa_status: 'graduate_granted', graduate_visa_expiry_date: '2028-09-30', work_permission_evidence_checked: true } });
    expect(d.status).toBe('POTENTIAL_NO_STATED_BLOCKER');
  });
  it('rule switches turn hard fails into information', () => {
    expect(run('British nationality is mandatory.', { profile: { exclude_citizenship_restricted: false } }).status).toBe('POTENTIAL_NO_STATED_BLOCKER');
    expect(run('x', { sponsor: { status: 'NOT_FOUND', matched: null }, profile: { requires_sponsor_licensed_employer: false } }).status).toBe('POTENTIAL_NO_STATED_BLOCKER');
    expect(run('x', { title: 'Senior SOC Analyst', profile: { exclude_senior_roles: false } }).status).not.toBe('EXCLUDED');
  });
  it('stale register blocks verification', () => {
    expect(codes(run('x', { sponsor: { snapshotAge: 'STALE' } }))).toContain('SPONSOR_DATA_STALE');
  });
  it('mandatory SC / eligible for SC → excluded; SC desirable → not', () => {
    expect(codes(run('You must be eligible for SC clearance.'))).toContain('SC_REQUIRED');
    expect(run('SC clearance is desirable.').status).not.toBe('EXCLUDED');
  });
  it('clearance policy is the user setting', () => {
    const d = run('You must hold DV clearance.', { profile: { disallow_mandatory_clearance: ['SC', 'CTC'] } });
    expect(codes(d)).toContain('OTHER_MANDATORY_VETTING');
    expect(d.status).toBe('NEEDS_REVIEW');
  });
  it('3-year programme without transition → excluded; with stated sponsorship → review', () => {
    expect(codes(run('Join our 3-year graduate programme.'))).toContain('PROGRAMME_EXCEEDS_WORK_PERMISSION');
    expect(run('Join our 3-year graduate programme.').status).toBe('EXCLUDED');
    const d = run('Join our 3-year graduate programme. Visa sponsorship is available for this programme.');
    expect(d.status).toBe('NEEDS_REVIEW');
  });
  it('18-month fixed term beyond CONFIRMED expiry → excluded; beyond estimate only → review', () => {
    const txt = 'This is an 18-month fixed-term contract.';
    const granted = { uk_visa_status: 'graduate_granted', graduate_visa_expiry_date: '2027-06-30', work_permission_evidence_checked: true };
    expect(run(txt, { profile: granted }).status).toBe('EXCLUDED');
    expect(run('This is a 30-month fixed-term contract.').status).toBe('NEEDS_REVIEW');
  });
  it('"Visa sponsorship is not offered" on a 6-month internship is advisory, not a blocker', () => {
    const d = run('6-month internship. Visa sponsorship is not offered.', { title: 'Security Intern' });
    expect(d.status).toBe('POTENTIAL_NO_STATED_BLOCKER');
    expect(d.reasons.find((r) => r.code === 'NO_FUTURE_SPONSORSHIP')?.severity).toBe('advisory');
  });
  it('strict no-sponsorship-now-or-future → excluded when transition needed', () => {
    expect(run('Applicants must not require sponsorship now or in the future.').status).toBe('EXCLUDED');
  });
  it('student-only, unpaid, citizenship, senior, non-UK, out-of-scope', () => {
    expect(codes(run('Placement for second-year students returning to university.'))).toContain('CURRENT_STUDENT_REQUIRED');
    expect(codes(run('This is an unpaid internship.'))).toContain('UNPAID_ROLE');
    expect(codes(run('British nationality is mandatory.'))).toContain('REQUIRES_BRITISH_CITIZENSHIP');
    expect(codes(run('x', { title: 'Senior SOC Analyst' }))).toContain('SENIOR_JOB');
    expect(codes(run('x', { location: 'New York, NY' }))).toContain('LOCATION_OUT_OF_SCOPE');
    expect(codes(run('x', { title: 'Backend Software Engineer' }))).toContain('OUT_OF_SCOPE_ROLE');
  });
  it('missing full JD → review FULL_JD_NOT_READ', () => {
    expect(codes(run('', { full: false }))).toContain('FULL_JD_NOT_READ');
  });
  it('hard fail overrides any fit score (no score computed)', () => {
    const facts = extractRuleFacts({ title: 'Junior SOC Analyst', advertisedEmployer: 'X', location: 'London', text: 'Must hold SC clearance. Python Linux SIEM.', sourceUrl: '' });
    const d = run('Must hold SC clearance. Python Linux SIEM.');
    expect(scoreJob({ facts, decision: d, sponsor: verified, profile: ProfileSchema.parse({}), jdText: 'python', location: 'London', postedAt: null, applyUrlKind: 'EMPLOYER_ATS', hasFullJd: true })).toBeNull();
  });
});

describe('permission model', () => {
  it('graduate visa duration by application date', () => {
    expect(graduateVisaMonths('2026-12-31', settings.graduate_visa_rules)).toBe(24);
    expect(graduateVisaMonths('2027-01-01', settings.graduate_visa_rules)).toBe(18);
  });
  it('planned visa is never treated as confirmed', () => {
    const v = permissionView(ProfileSchema.parse({}), settings, TODAY);
    expect(v.confirmedExpiry).toBeNull();
    expect(v.currentRightToWork).toBe('PENDING');
  });
});

describe('search intent', () => {
  it('IT broadens to IT categories only', () => {
    expect(parseNaturalLanguage('IT').categories).toEqual(['IT_TECHNICAL']);
  });
  it('SOC does not pull GRC', () => {
    expect(parseNaturalLanguage('SOC analyst').categories).toEqual(['SOC_SECURITY']);
  });
  it('GRC no coding → GRC only, non-technical', () => {
    const i = parseNaturalLanguage('GRC no coding');
    expect(i.categories).toEqual(['GRC_RISK_AUDIT']);
    expect(i.nonTechnical).toBe(true);
  });
  it('off-cycle London + months', () => {
    const i = parseNaturalLanguage('6-month GRC off-cycle internships in London');
    expect(i.offCycleOnly).toBe(true); expect(i.location).toBe('LONDON'); expect(i.maxContractMonths).toBe(6);
  });
  it('cannot bypass policy', () => {
    expect(parseNaturalLanguage('show SC jobs').policyWarnings.length).toBeGreaterThan(0);
    expect(parseNaturalLanguage('include companies without licences').policyWarnings.length).toBeGreaterThan(0);
  });
});

describe('sponsor name normalisation', () => {
  it('Ltd == Limited, trading names, ratings', () => {
    expect(exactKey('Monzo Bank Ltd')).toBe(exactKey('MONZO BANK LIMITED'));
    expect(splitTradingAs('Roofoods Ltd t/a Deliveroo')).toEqual({ legal: 'Roofoods Ltd', trading: 'Deliveroo' });
    expect(coreKey('Oaknorth (UK) Limited')).toBe('oaknorth');
    expect(parseRating('Worker (A rating)')).toBe('A');
    expect(parseRating('Worker (B rating)')).toBe('B');
  });
});

describe('AI merge safety', () => {
  const base = extractRuleFacts({ title: 'Junior SOC Analyst', advertisedEmployer: 'X', location: 'London', text: 'You will monitor alerts. BPSS checks apply.', sourceUrl: 'u' });
  const ai = { legalEmployer: null, category: 'SOC_SECURITY', employmentType: 'PERMANENT', isPaid: null, requiredExperienceYears: null, experienceRequirement: 'UNSPECIFIED', currentStudentRequired: null, permittedGraduationYears: null, contractMonths: null, programmeMonths: null, startDate: null, closingDate: null, graduateVisaLanguage: 'EXPLICIT_ALLOWED', sponsorPolicy: 'SILENT', noFutureSponsorshipStrict: null, permanentRightToWorkRequired: null, BritishCitizenshipMandatory: null, otherNationalityRestrictions: [], ukResidencyRequirementYears: null, mandatoryClearances: ['SC'], optionalClearances: [], mandatorySkills: [], desirableSkills: [], fitNotes: [], evidence: [{ field: 'clearance', quote: 'Must hold SC clearance', confidence: 'HIGH' }], missingOrAmbiguousFacts: [] } as any;
  it('ungrounded AI claims are not applied and are reported', () => {
    const r = mergeAiFacts(base, ai, 'You will monitor alerts. BPSS checks apply.', 'u');
    expect(r.facts.mandatoryClearances).toEqual([]);
    expect(r.facts.graduateVisaLanguage).toBe('NO_STATED_BLOCKER');
    expect(r.unverified.length).toBeGreaterThan(0);
  });
  it('AI cannot remove a rule-detected restriction', () => {
    const withSc = extractRuleFacts({ title: 'Junior SOC Analyst', advertisedEmployer: 'X', location: 'London', text: 'Must hold SC clearance.', sourceUrl: 'u' });
    const r = mergeAiFacts(withSc, { ...ai, mandatoryClearances: [], evidence: [] }, 'Must hold SC clearance.', 'u');
    expect(r.facts.mandatoryClearances).toContain('SC');
  });
});
