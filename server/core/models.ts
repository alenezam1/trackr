import { z } from 'zod';
import { DEFAULT_ROLE_FAMILIES } from './discovery/roles.js';

// ---------------------------------------------------------------------------
// Versions. Bump when logic changes so cached decisions are re-evaluated.
// ---------------------------------------------------------------------------
export const RULES_VERSION = 'rules-2026.10.24-1';
export const PROMPT_VERSION = 'prompt-2026.10.14-1';
export const PARSER_VERSION = 'sponsor-csv-1';

// ---------------------------------------------------------------------------
// Enumerations (spec §2.4, §7.1, §7.2, §9.1)
// ---------------------------------------------------------------------------
export const JOB_STATUSES = ['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER', 'NEEDS_REVIEW', 'EXCLUDED', 'STALE'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const REASON_CODES = [
  'SPONSOR_NOT_FOUND', 'SPONSOR_AMBIGUOUS', 'SPONSOR_DATA_STALE', 'SPONSOR_B_RATED', 'ACTUAL_EMPLOYER_UNKNOWN',
  'REQUIRES_BRITISH_CITIZENSHIP', 'OTHER_NATIONALITY_RESTRICTION', 'RESIDENCY_REQUIREMENT_UNMET',
  'SC_REQUIRED', 'DV_REQUIRED', 'CTC_REQUIRED', 'OTHER_MANDATORY_VETTING',
  'PERMANENT_WORK_AUTHORISATION_REQUIRED', 'GRADUATE_VISA_EXPLICITLY_DISALLOWED', 'VISA_START_DATE_INCOMPATIBLE',
  'PROGRAMME_EXCEEDS_WORK_PERMISSION', 'NO_FUTURE_SPONSORSHIP', 'CURRENT_STUDENT_REQUIRED', 'GRADUATION_COHORT_INELIGIBLE',
  'EXPERIENCE_EXCEEDS_ENTRY_LEVEL', 'SENIOR_JOB', 'OUT_OF_SCOPE_ROLE', 'UNPAID_ROLE', 'LOCATION_OUT_OF_SCOPE',
  'FULL_JD_NOT_READ', 'VACANCY_CLOSED', 'APPLICATION_LINK_BROKEN', 'SPONSORSHIP_NOT_CONFIRMED',
  'CONTRACT_DURATION_UNKNOWN', 'AI_EVIDENCE_UNVERIFIED', 'CUSTOM_RESTRICTION', 'SUSPECTED_SCAM', 'NOT_A_JOB_POSTING',
  'POSTED_DATE_UNKNOWN', 'EXPERIENCE_NOT_STATED', 'LOW_ENTRY_LEVEL_SCORE',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type Severity = 'hard_fail' | 'uncertain' | 'advisory';

export const CATEGORIES = ['SOC_SECURITY', 'GRC_RISK_AUDIT', 'IT_TECHNICAL', 'OTHER', 'UNKNOWN'] as const;
export type Category = (typeof CATEGORIES)[number];

export const EMPLOYMENT_TYPES = ['INTERNSHIP', 'OFF_CYCLE_INTERNSHIP', 'FIXED_TERM', 'PERMANENT', 'GRADUATE_PROGRAMME', 'UNKNOWN'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type ProviderMode =
  | 'OFFICIAL_API' | 'AUTHORISED_FEED' | 'PERMITTED_PUBLIC_HTML'
  | 'PUBLIC_ATS' | 'SEARCH_INDEX_DISCOVERY'
  | 'USER_SHARED_LINK' | 'MANUAL_IMPORT' | 'UNAVAILABLE';

export type ConnectionStatus =
  | 'CONNECTED' | 'LIMITED' | 'AUTH_REQUIRED' | 'LOGIN_REQUIRED'
  | 'PERMISSION_REQUIRED' | 'BLOCKED' | 'ERROR' | 'NOT_CONFIGURED';

export const APPLICATION_STAGES = [
  'Discovered', 'Needs Review', 'Shortlisted', 'To Apply', 'In Progress', 'Applied', 'Assessment',
  'Recruiter Screen', 'Interview', 'Offer', 'Rejected', 'Withdrawn', 'Closed / Expired', 'Archived',
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

// ---------------------------------------------------------------------------
// Candidate profile (spec §2.2). Personal search filters, not legal statements.
// ---------------------------------------------------------------------------
export const ProfileSchema = z.object({
  name: z.string().default(''),
  nationality: z.string().default('Kuwaiti'),
  uk_visa_status: z.enum(['student', 'graduate_planned', 'graduate_applied', 'graduate_granted', 'skilled_worker', 'other']).default('graduate_planned'),
  graduate_application_date: z.string().nullable().default(null),
  graduate_visa_grant_date: z.string().nullable().default(null),
  graduate_visa_expiry_date: z.string().nullable().default(null),
  work_permission_evidence_checked: z.boolean().default(false),
  earliest_available_start_date: z.string().nullable().default(null),
  currently_enrolled: z.boolean().default(false),
  graduation_year: z.number().int().nullable().default(null),
  uk_residency_years: z.number().nullable().default(null),
  requires_sponsor_licensed_employer: z.boolean().default(true),
  exclude_citizenship_restricted: z.boolean().default(true),
  exclude_permanent_rtw_required: z.boolean().default(true),
  exclude_graduate_visa_bans: z.boolean().default(true),
  exclude_senior_roles: z.boolean().default(true),
  review_ambiguous_vetting: z.boolean().default(true),
  review_unclear_location: z.boolean().default(true),
  needs_eventual_skilled_worker_transition: z.boolean().default(true),
  require_explicit_role_sponsorship: z.boolean().default(false),
  allow_long_programme_exception: z.boolean().default(false),
  disallow_mandatory_clearance: z.array(z.string()).default(['SC', 'DV', 'CTC']),
  accept_only_paid_roles: z.boolean().default(true),
  allow_student_only_placements: z.boolean().default(false),
  max_required_relevant_experience_years: z.number().default(2),
  location_priority: z.array(z.string()).default(['London', 'Greater_London', 'UK_Remote', 'Other_UK']),
  prefer_contract_months: z.array(z.number()).default([3, 6, 9, 12]),
  daily_quota: z.object({ cyber_grc: z.number().int().min(0).max(30), it_technical: z.number().int().min(0).max(30) }).default({ cyber_grc: 10, it_technical: 5 }),
  enabled_categories: z.array(z.enum(['SOC_SECURITY', 'GRC_RISK_AUDIT', 'IT_TECHNICAL'])).default(['SOC_SECURITY', 'GRC_RISK_AUDIT', 'IT_TECHNICAL']),
  target_roles: z.array(z.object({
    id: z.string(), label: z.string().min(1).max(80), category: z.enum(['SOC_SECURITY', 'GRC_RISK_AUDIT', 'IT_TECHNICAL']),
    keywords: z.array(z.string().max(60)).max(60), enabled: z.boolean(), custom: z.boolean().optional(),
  })).default(DEFAULT_ROLE_FAMILIES),
  custom_restrictions: z.array(z.object({
    id: z.string(), label: z.string().min(1).max(120), enabled: z.boolean(),
    kind: z.enum(['exclude_title', 'exclude_text', 'require_text', 'exclude_employer']),
    terms: z.array(z.string().max(80)).max(40), action: z.enum(['exclude', 'review']),
  })).default([]),
  // Minimal, non-identifying CV facts used for fit scoring and (optionally) sent to OpenAI.
  education: z.array(z.string()).default([
    'MSc Information Security, University College London (UCL)',
    'BSc Computer Science (First Class), Lancaster University',
  ]),
  experience: z.array(z.string()).default([
    'EQUATE — OT / cyber security internship',
    'Zain — software internship',
  ]),
  skills: z.array(z.string()).default([
    'information security', 'risk assessment', 'network security', 'incident response', 'vulnerability',
    'ISO 27001', 'NIST', 'OT security', 'Linux', 'Python', 'SIEM', 'threat', 'access control', 'cryptography',
    'cloud', 'Windows', 'networking', 'troubleshooting', 'governance', 'compliance', 'audit', 'controls',
  ]),
  certifications_in_progress: z.array(z.string()).default(['CompTIA Security+ (in progress)', 'Google Cybersecurity Certificate (in progress)']),
});
export type Profile = z.infer<typeof ProfileSchema>;

// ---------------------------------------------------------------------------
// Extraction contract (spec §11.2)
// ---------------------------------------------------------------------------
export const EvidenceSchema = z.object({
  field: z.string(),
  quote: z.string(),
  section: z.string().optional(),
  startOffset: z.number().optional(),
  endOffset: z.number().optional(),
  sourceUrl: z.string(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  origin: z.enum(['RULES', 'AI', 'SOURCE_METADATA', 'USER']).default('RULES'),
  validated: z.boolean().default(false),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ExtractedJobFactsSchema = z.object({
  title: z.string().nullable(),
  advertisedEmployer: z.string().nullable(),
  legalEmployer: z.string().nullable(),
  location: z.string().nullable(),
  category: z.enum(CATEGORIES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  isPaid: z.boolean().nullable(),
  salaryGbp: z.object({ min: z.number().optional(), max: z.number().optional() }).nullable(),
  requiredExperienceYears: z.number().nullable(),
  experienceRequirement: z.enum(['MANDATORY', 'PREFERRED', 'UNSPECIFIED']),
  currentStudentRequired: z.boolean().nullable(),
  permittedGraduationYears: z.array(z.number()).nullable().optional(),
  contractMonths: z.number().nullable(),
  programmeMonths: z.number().nullable(),
  startDate: z.string().nullable(),
  closingDate: z.string().nullable(),
  graduateVisaLanguage: z.enum(['EXPLICIT_ALLOWED', 'EXPLICIT_DISALLOWED', 'NO_STATED_BLOCKER', 'AMBIGUOUS']),
  sponsorPolicy: z.enum(['OFFERS_SPONSORSHIP', 'NO_SPONSORSHIP', 'SILENT', 'AMBIGUOUS']),
  noFutureSponsorshipStrict: z.boolean().nullable().default(null), // "must not require sponsorship now or in the future"
  permanentRightToWorkRequired: z.boolean().nullable(),
  BritishCitizenshipMandatory: z.boolean().nullable(),
  otherNationalityRestrictions: z.array(z.string()),
  ukResidencyRequirementYears: z.number().nullable(),
  mandatoryClearances: z.array(z.string()),
  optionalClearances: z.array(z.string()),
  ambiguousVetting: z.boolean().default(false),
  backgroundChecks: z.array(z.string()).default([]),
  isSeniorTitle: z.boolean().default(false),
  targetRole: z.string().nullable().optional(),
  aiSeniority: z.enum(['INTERN', 'GRADUATE', 'ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'UNKNOWN']).nullable().optional(),
  postingType: z.enum(['SINGLE_JOB_POSTING', 'JOB_LISTING_PAGE', 'NOT_A_JOB', 'UNKNOWN']).nullable().optional(),
  scamSignals: z.array(z.string()).optional(),
  mandatorySkills: z.array(z.string()),
  desirableSkills: z.array(z.string()),
  applicationUrl: z.string().nullable(),
  evidence: z.array(EvidenceSchema),
  missingOrAmbiguousFacts: z.array(z.string()),
});
export type ExtractedJobFacts = z.infer<typeof ExtractedJobFactsSchema>;

// ---------------------------------------------------------------------------
// Sponsor match + decisions
// ---------------------------------------------------------------------------
export type SponsorMatchStatus = 'VERIFIED_EXACT' | 'VERIFIED_ALIAS' | 'PROPOSED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'EMPLOYER_UNKNOWN';
export interface SponsorCandidate {
  id: number;
  legal_name: string;
  town: string;
  county: string;
  route: string;
  rating: string; // 'A' | 'B' | other text
  type_rating: string;
}
export interface SponsorMatch {
  status: SponsorMatchStatus;
  method: string;
  matched: SponsorCandidate | null;
  candidates: SponsorCandidate[];
  snapshotId: number | null;
  snapshotDate: string | null;
  snapshotAge: 'CURRENT' | 'AGING' | 'STALE' | 'NONE';
  evidenceUrl: string | null;
  note: string;
}

export interface DecisionReason {
  code: ReasonCode;
  severity: Severity;
  message: string;
  evidence?: { quote: string; sourceUrl?: string; origin?: string } | null;
  profileSetting?: string;
}

export interface VisaMatrix {
  current_right_to_work: 'CONFIRMED' | 'PENDING' | 'UNKNOWN' | 'NOT_AVAILABLE';
  role_accepts_graduate_visa: 'EXPLICIT_YES' | 'NO_STATED_BLOCKER' | 'EXPLICIT_NO' | 'UNKNOWN';
  vacancy_offers_sponsorship: 'EXPLICIT_YES' | 'EXPLICIT_NO' | 'UNKNOWN';
  employer_has_skilled_worker_licence: 'VERIFIED_A' | 'VERIFIED_B' | 'NOT_FOUND' | 'AMBIGUOUS' | 'STALE';
  duration_feasibility: 'WITHIN_CONFIRMED_PERMISSION' | 'NEEDS_FUTURE_TRANSITION' | 'EXPLICITLY_INCOMPATIBLE' | 'UNKNOWN';
  overall_immigration_assessment: 'EVIDENCED_PATH' | 'NO_STATED_BLOCKER_UNCONFIRMED' | 'NEEDS_REVIEW' | 'EXCLUDED';
}

export interface Decision {
  status: JobStatus;
  reasons: DecisionReason[];
  matrix: VisaMatrix;
  rulesVersion: string;
  permissionNote: string;
}

// ---------------------------------------------------------------------------
// Search intent (spec §12)
// ---------------------------------------------------------------------------
export interface SearchIntent {
  raw: string;
  categories: Array<'SOC_SECURITY' | 'GRC_RISK_AUDIT' | 'IT_TECHNICAL'>;
  keywords: string[];
  employmentTypes: EmploymentType[];
  offCycleOnly: boolean;
  internshipsOnly: boolean;
  maxContractMonths: number | null;
  location: 'LONDON' | 'UK' | 'REMOTE' | null;
  nonTechnical: boolean;
  universitiesOnly: boolean;
  policyWarnings: string[];
  roleFocus?: 'BOTH' | 'INTERNSHIP' | 'GRADUATE';
  /** Search phrases from your enabled target roles (filled in by the scan). */
  roleQueries?: string[];
  /** Which part of the app started the search. */
  scope?: 'REGISTRY' | 'BOARDS' | 'ALL' | 'GULF';
  /** Gulf scans: which country. */
  market?: 'UAE' | 'QATAR' | 'SAUDI';
}
