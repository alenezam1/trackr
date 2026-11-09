// Gulf markets: UAE, Qatar, Saudi Arabia. Different rules from the UK search:
//  - any ENTRY-LEVEL CYBER role (SOC, GRC, security engineering, threat, vulnerability, privacy…)
//  - must NOT be reserved for UAE / Qatari / Saudi (or GCC) nationals
//  - must NOT require more than 1 year of experience
//  - no UK sponsor register / UK visa rules
import type { DecisionReason, Decision, ExtractedJobFacts, VisaMatrix } from '../models.js';
import { RULES_VERSION } from '../models.js';
import { DEFAULT_ROLE_FAMILIES, matchTargetRole, type RoleFamily } from '../discovery/roles.js';
import { splitSentences } from '../util/text.js';
import { NOT_A_VACANCY_TITLE } from '../extraction/classify.js';

export type GulfMarket = 'UAE' | 'QATAR' | 'SAUDI';
export type Market = 'UK' | GulfMarket;
export const GULF_MARKETS: GulfMarket[] = ['UAE', 'QATAR', 'SAUDI'];

export interface MarketDef {
  id: GulfMarket; name: string; flag: string; locRe: RegExp; googleLocations: string[]; joobleLocation: string; searchCountry: string;
  nationalsRe: RegExp; boards: Array<{ name: string; domain: string; url: string }>;
}

const NAT_COMMON = String.raw`(?:\b(?:gcc|gulf|local)\s+(?:nationals?|citizens?)\b[^.]{0,30}\b(?:only|preferred|required|mandatory|priority)\b|\bonly\b[^.]{0,30}\b(?:gcc|gulf|local)\s+(?:nationals?|citizens?)\b|\bnationals only\b|\bcitizens only\b|\bnitaqat[- ]only\b)`;
const LOCALISATION = (w: string) => String.raw`\b${w}\b[^.]{0,40}\b(role|position|vacancy|job|opportunity|programme|program|only)\b|\b(role|position|vacancy|job|opportunity)\b[^.]{0,40}\b${w}\b`;

export const MARKETS: Record<GulfMarket, MarketDef> = {
  UAE: {
    id: 'UAE', name: 'UAE (Dubai, Abu Dhabi…)', flag: '🇦🇪',
    locRe: /\b(dubai|abu dhabi|sharjah|ajman|ras al[- ]khaimah|fujairah|umm al[- ]quwain|al ain|uae|u\.a\.e\.?|united arab emirates|emirates)\b/i,
    googleLocations: ['Dubai, United Arab Emirates', 'Abu Dhabi, United Arab Emirates', 'United Arab Emirates'], joobleLocation: 'United Arab Emirates', searchCountry: 'united arab emirates',
    nationalsRe: new RegExp(String.raw`\b(uae|u\.a\.e|emirati)\s+(nationals?|citizens?)\b[^.]{0,40}\b(only|preferred|required|mandatory|exclusively|priority)\b|\b(only|exclusively)\b[^.]{0,30}\b(uae|emirati)\s+(nationals?|citizens?)\b|\bemiratis?\s+only\b|\bfor\s+uae\s+nationals\b|${LOCALISATION('emirati[sz]ation')}|\bnafis\b|${NAT_COMMON}`, 'i'),
    boards: [
      { name: 'LinkedIn — UAE', domain: 'linkedin.com', url: 'https://www.linkedin.com/jobs/search/?keywords=cyber%20security&location=United%20Arab%20Emirates&f_E=1%2C2' },
      { name: 'Bayt — UAE', domain: 'bayt.com', url: 'https://www.bayt.com/en/uae/jobs/cyber-security-jobs/' },
      { name: 'NaukriGulf — UAE', domain: 'naukrigulf.com', url: 'https://www.naukrigulf.com/cyber-security-jobs-in-uae' },
      { name: 'GulfTalent — UAE', domain: 'gulftalent.com', url: 'https://www.gulftalent.com/uae/jobs/title/cyber-security' },
      { name: 'Indeed UAE', domain: 'ae.indeed.com', url: 'https://ae.indeed.com/jobs?q=cyber+security&l=United+Arab+Emirates' },
      { name: 'Glassdoor UAE', domain: 'glassdoor.com', url: 'https://www.glassdoor.com/Job/united-arab-emirates-cyber-security-jobs-SRCH_IL.0,20_IN6_KO21,35.htm' },
      { name: 'dubizzle jobs', domain: 'dubizzle.com', url: 'https://dubai.dubizzle.com/jobs/?keywords=cyber%20security' },
    ],
  },
  QATAR: {
    id: 'QATAR', name: 'Qatar (Doha…)', flag: '🇶🇦',
    locRe: /\b(qatar|doha|lusail|al rayyan|al wakrah|ras laffan|mesaieed)\b/i,
    googleLocations: ['Doha, Qatar', 'Qatar'], joobleLocation: 'Qatar', searchCountry: 'qatar',
    nationalsRe: new RegExp(String.raw`\bqatari\s+(nationals?|citizens?)\b[^.]{0,40}\b(only|preferred|required|mandatory|exclusively|priority)\b|\b(only|exclusively)\b[^.]{0,30}\bqatari\s+(nationals?|citizens?)\b|\bqataris?\s+only\b|${LOCALISATION('qatari[sz]ation')}|\bfor\s+qatari\s+(nationals|citizens)\b|${NAT_COMMON}`, 'i'),
    boards: [
      { name: 'LinkedIn — Qatar', domain: 'linkedin.com', url: 'https://www.linkedin.com/jobs/search/?keywords=cyber%20security&location=Qatar&f_E=1%2C2' },
      { name: 'Bayt — Qatar', domain: 'bayt.com', url: 'https://www.bayt.com/en/qatar/jobs/cyber-security-jobs/' },
      { name: 'NaukriGulf — Qatar', domain: 'naukrigulf.com', url: 'https://www.naukrigulf.com/cyber-security-jobs-in-qatar' },
      { name: 'GulfTalent — Qatar', domain: 'gulftalent.com', url: 'https://www.gulftalent.com/qatar/jobs/title/cyber-security' },
      { name: 'Indeed Qatar', domain: 'qa.indeed.com', url: 'https://qa.indeed.com/jobs?q=cyber+security' },
    ],
  },
  SAUDI: {
    id: 'SAUDI', name: 'Saudi Arabia (Riyadh, Jeddah…)', flag: '🇸🇦',
    locRe: /\b(saudi arabia|saudi|ksa|riyadh|jeddah|jiddah|dammam|khobar|al khobar|dhahran|mecca|makkah|medina|madinah|neom|jubail|yanbu|tabuk|abha)\b/i,
    googleLocations: ['Riyadh, Saudi Arabia', 'Jeddah, Saudi Arabia', 'Dammam, Saudi Arabia', 'Saudi Arabia'], joobleLocation: 'Saudi Arabia', searchCountry: 'saudi arabia',
    nationalsRe: new RegExp(String.raw`\bsaudi\s+(nationals?|citizens?)\b[^.]{0,40}\b(only|preferred|required|mandatory|exclusively|priority)\b|\b(only|exclusively)\b[^.]{0,30}\bsaudi\s+(nationals?|citizens?)\b|\bsaudis?\s+only\b|${LOCALISATION('saudi[sz]ation')}|\bfor\s+saudi\s+(nationals|citizens)\b|${NAT_COMMON}`, 'i'),
    boards: [
      { name: 'LinkedIn — Saudi', domain: 'linkedin.com', url: 'https://www.linkedin.com/jobs/search/?keywords=cyber%20security&location=Saudi%20Arabia&f_E=1%2C2' },
      { name: 'Bayt — Saudi', domain: 'bayt.com', url: 'https://www.bayt.com/en/saudi-arabia/jobs/cyber-security-jobs/' },
      { name: 'NaukriGulf — Saudi', domain: 'naukrigulf.com', url: 'https://www.naukrigulf.com/cyber-security-jobs-in-saudi-arabia' },
      { name: 'GulfTalent — Saudi', domain: 'gulftalent.com', url: 'https://www.gulftalent.com/saudi-arabia/jobs/title/cyber-security' },
      { name: 'Indeed Saudi', domain: 'sa.indeed.com', url: 'https://sa.indeed.com/jobs?q=cyber+security' },
    ],
  },
};

export const GULF_BOARD_DOMAINS = ['bayt.com', 'naukrigulf.com', 'gulftalent.com', 'ae.indeed.com', 'qa.indeed.com', 'sa.indeed.com', 'dubizzle.com', 'linkedin.com/jobs', 'glassdoor.com', 'tanqeeb.com'];

export function marketOfLocation(loc: string | null | undefined): GulfMarket | null {
  if (!loc) return null;
  for (const m of GULF_MARKETS) if (MARKETS[m].locRe.test(loc)) return m;
  return null;
}

/** Cyber role families for the Gulf: every security / GRC family (your custom security roles included), regardless of UK toggles. */
export function gulfFamilies(userFamilies: RoleFamily[]): RoleFamily[] {
  const ids = new Set(['soc', 'seceng', 'threat', 'vuln', 'grc', 'risk', 'privacy']);
  const base = DEFAULT_ROLE_FAMILIES.filter((f) => ids.has(f.id)).map((f) => ({ ...f, enabled: true }));
  const custom = userFamilies.filter((f) => f.custom && f.category !== 'IT_TECHNICAL').map((f) => ({ ...f, enabled: true }));
  return [...custom, ...base];
}
// Broad cyber title test for the Gulf ("SOC L1 Analyst", "Information Security Officer", "Cybersecurity Specialist", "IAM Engineer"…).
const CYBER_TITLE = /\b(cyber\s?security|cyber|infosec|information security|it security|ict security|security (analyst|engineer|specialist|consultant|associate|operations|architect|administrator|auditor|tester|researcher|intern|trainee|graduate|officer|coordinator|executive|monitoring|assurance)|soc\b|s\.o\.c|siem|grc|governance|risk|compliance|audit|privacy|data protection|iam\b|identity (and|&) access|pam\b|vulnerabilit|penetration|pen ?test|red team|blue team|threat|incident response|forensic|dfir|malware|ot security|ics security|scada security|devsecops|appsec|application security|cloud security|network security|endpoint security|isms|iso 27001|nca ecc|nesa)\b/i;
const NOT_CYBER = /\b(security (guard|officer|supervisor|patrol)|guard|bodyguard|cctv operator|loss prevention|food safety|health (and|&) safety|hse|credit risk|market risk|insurance risk|aml|kyc|tax|financial audit|external audit|sales|marketing|recruit)\b/i;
const GRC_TITLE = /\b(grc|governance|risk|compliance|audit|privacy|data protection|isms|iso 27001|assurance|policy)\b/i;

// Never a technical cyber role, whatever else the title says ("Cloud Security Sales Executive").
const NOT_TECH_ROLE = /\b(sales|account (manager|executive|director)|business development|bdm|marketing|recruit(er|ment)?|talent acquisition|pre-?sales|channel partner)\b/i;
// Postings outside the Gulf that search engines still return for Gulf queries (Cairo, Amman, Karachi…).
export const NON_GULF_PLACE = /\b(egypt|cairo|giza|alexandria|jordan|amman|lebanon|beirut|kuwait|bahrain|manama|oman|muscat|morocco|casablanca|tunisia|algeria|turkey|istanbul|pakistan|karachi|lahore|islamabad|india|bangalore|bengaluru|mumbai|hyderabad|pune|chennai|delhi|noida|gurgaon|philippines|manila|united states|usa|canada|united kingdom|london|germany|europe)\b|القاهرة|مصر|الأردن|عمان الأردن/i;
/** "(UAE National)", "UAEN", "Emiratis only", "Saudi Nationals Only" in a TITLE = reserved for nationals. */
export const NATIONALS_TITLE = /\b(uae|emirati|qatari|saudi|gcc|gulf)\s+nationals?\b|\buaen\b|\bemiratis?\s+only\b|\bnationals?\s+only\b|\bcitizens\s+only\b|\bnitaqat\b|\b(emiratisation|emiratization|qatarisation|qatarization|saudisation|saudization)\b/i;
/** Spec §5: titles that are above entry level (beyond senior/lead/manager): L2/L3, Level/Tier 2-3, architect, head, principal. */
export const ABOVE_ENTRY_TITLE = /\b(l[23]|level\s*[23]|tier\s*(2|3|ii|iii)|t[23]\b|architect|principal|head of|director|manager|lead|senior|sr\.?)\b/i;
/** Spec §5: not cyber even if the title says "security" (data entry, helpdesk-only, CCTV, guards). */
const NOT_CYBER_EXTRA = /\b(data entry|help ?desk|service desk|cctv|guard)\b/i;

export function matchGulfRole(title: string, userFamilies: RoleFamily[]): RoleFamily | null {
  if (NOT_TECH_ROLE.test(title)) return null;
  if (NOT_CYBER_EXTRA.test(title) && !/\b(soc|security|cyber)\b/i.test(title)) return null;
  const fam = matchTargetRole(title, gulfFamilies(userFamilies));
  if (fam) return fam;
  if (!CYBER_TITLE.test(title)) return null;
  // Physical security / non-cyber risk & audit are excluded unless the title clearly says cyber / IT / information.
  if (NOT_CYBER.test(title) && !/\b(cyber|information|it|ict|data|cloud|soc)\b/i.test(title)) return null;
  if (/\b(risk|compliance|audit|governance)\b/i.test(title) && !/\b(cyber|information|it|ict|technology|tech|security|grc|data|isms)\b/i.test(title)) return null;
  return GRC_TITLE.test(title)
    ? { id: 'gulf-grc', label: 'Cyber GRC (Gulf)', category: 'GRC_RISK_AUDIT', keywords: [], enabled: true }
    : { id: 'gulf-cyber', label: 'Cyber security (Gulf)', category: 'SOC_SECURITY', keywords: [], enabled: true };
}

// Broad first (Google Jobs ranks by relevance), then entry-level-specific phrasings used in the Gulf.
export const GULF_QUERIES = [
  'cyber security', 'information security', 'SOC analyst', 'GRC analyst cyber', 'cyber security fresh graduate',
  'cyber security intern', 'security analyst junior', 'cybersecurity trainee', 'IT security specialist', 'graduate programme cyber security',
];

/** Find "nationals only" wording with the exact sentence. */
export function nationalsOnly(text: string, market: GulfMarket): { quote: string; strict: boolean } | null {
  const re = MARKETS[market].nationalsRe;
  for (const s of splitSentences(text)) {
    if (re.test(s.text) && !/\b(all nationalities|any nationality|expats? welcome|open to all)\b/i.test(s.text)) {
      // "preferred / priority / encouraged" is not an exclusive rule → review; "only / required / localisation role" → exclude.
      const strict = !/\b(preferred|priority|encouraged|advantage|desirable)\b/i.test(s.text);
      return { quote: s.text.slice(0, 300), strict };
    }
  }
  return null;
}

export const GULF_RULES_VERSION = `${RULES_VERSION}+gulf4`;
export const GULF_MAX_EXPERIENCE_YEARS = 2;

// Spec §1 role phrases (an exact title match earns +5).
const ROLE_PHRASES = ['soc analyst', 'soc analyst tier 1', 'security operations analyst', 'security analyst', 'cyber security graduate', 'cyber security intern',
  'information security analyst', 'it security analyst', 'grc analyst', 'it audit assistant', 'cyber security trainee', 'security monitoring analyst',
  'junior penetration tester', 'vulnerability analyst', 'siem analyst'];

/** Spec §9 score (0–100) for jobs that pass every gate. Eligible needs ≥ the threshold (default 60); 40–59 or lower → review. */
export function gulfEntryScore(inp: { title: string; text: string; facts: ExtractedJobFacts; postedAt?: string | null; applyKind?: string | null; today: string }) {
  const t = `${inp.title} ${inp.text.slice(0, 4000)}`;
  const parts: string[] = [];
  let score = 0;
  const lvl = /\b(intern(ship)?|graduate|fresh grad)/i.test(inp.title) || /\b(internship|graduate programme|graduate program|fresh graduates?)\b/i.test(t) ? ['intern/graduate', 25]
    : /\b(entry[- ]level|no experience (required|needed))\b/i.test(t) ? ['entry level', 20]
    : /\b(junior|trainee|associate|tier 1|l1|level 1)\b/i.test(inp.title) ? ['junior', 15] : null;
  if (lvl) { score += lvl[1] as number; parts.push(`${lvl[0]} +${lvl[1]}`); }
  const y = inp.facts.requiredExperienceYears;
  if (y != null && y <= 1) { score += 15; parts.push(`${y} yr experience +15`); }
  else if (y === 2) { score += 5; parts.push('2 yrs experience +5'); }
  else if (y == null && lvl) { score += 15; parts.push('no experience asked +15'); }
  if (inp.applyKind === 'EMPLOYER_ATS' || inp.applyKind === 'EMPLOYER_SITE') { score += 10; parts.push('apply on careers site +10'); }
  const posted = inp.postedAt ? inp.postedAt.slice(0, 10) : null;
  if (posted) {
    const age = Math.round((Date.parse(inp.today) - Date.parse(posted)) / 86400000);
    if (age <= 7) { score += 10; parts.push('posted ≤7 days +10'); } else if (age <= 14) { score += 5; parts.push('posted ≤14 days +5'); }
  }
  const tl = inp.title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  if (ROLE_PHRASES.some((p) => tl.includes(p))) { score += 5; parts.push('target role title +5'); }
  return { score, parts };
}

/** Deterministic Gulf decision: cyber role, in-country, entry level (≤2 years), not nationals-only, live dated posting, no scam. */
export function evaluateGulf(inp: {
  market: GulfMarket; title: string; location: string | null; text: string; hasFullJd: boolean; listingState: string; deadline: string | null;
  facts: ExtractedJobFacts; family: RoleFamily | null; today: string; postedAt?: string | null; applyKind?: string | null; minScoreEligible?: number;
}): Decision {
  const { facts: f } = inp;
  const reasons: DecisionReason[] = [];
  const ev = (field: string) => { const e = f.evidence.find((x) => x.field === field || x.field.startsWith(field)); return e ? { quote: e.quote, sourceUrl: e.sourceUrl, origin: e.origin } : null; };
  const add = (r: DecisionReason) => reasons.push(r);
  const closed = inp.listingState === 'CLOSED' || (inp.deadline != null && inp.deadline < inp.today);
  if (closed) add({ code: 'VACANCY_CLOSED', severity: 'hard_fail', message: 'The listing is closed or past its deadline.' });
  if (!inp.hasFullJd) add({ code: 'FULL_JD_NOT_READ', severity: 'uncertain', message: 'Only a snippet was available — the full posting was not read.' });
  if (!inp.family) add({ code: 'OUT_OF_SCOPE_ROLE', severity: 'hard_fail', message: `"${inp.title}" is not a cyber security / GRC role.` });
  const where = marketOfLocation(inp.location) ?? marketOfLocation(inp.title) ?? marketOfLocation(inp.text.slice(0, 1500));
  const elsewhere = NON_GULF_PLACE.test(`${inp.location ?? ''} ${inp.title}`) || (!where && NON_GULF_PLACE.test(inp.text.slice(0, 800)));
  if (where !== inp.market || (elsewhere && !marketOfLocation(inp.location))) {
    add({ code: 'LOCATION_OUT_OF_SCOPE', severity: where && where !== inp.market || elsewhere ? 'hard_fail' : 'uncertain', message: `Location "${inp.location ?? 'not stated'}" is not in ${MARKETS[inp.market].name}.` });
  }
  const titleNat = NATIONALS_TITLE.exec(inp.title);
  const nat = titleNat ? { quote: inp.title, strict: true } : nationalsOnly(inp.text, inp.market);
  const natName = inp.market === 'UAE' ? 'UAE' : inp.market === 'QATAR' ? 'Qatari' : 'Saudi';
  if (nat) add({ code: 'OTHER_NATIONALITY_RESTRICTION', severity: nat.strict ? 'hard_fail' : 'uncertain', message: nat.strict ? `Reserved for ${natName} / local nationals.` : `${natName} nationals are preferred — check whether expats are considered.`, evidence: { quote: nat.quote, origin: 'RULES' } });
  if (f.isSeniorTitle) add({ code: 'SENIOR_JOB', severity: 'hard_fail', message: `Title "${inp.title}" is a senior / lead / manager role.` });
  else if (f.aiSeniority === 'SENIOR' || f.aiSeniority === 'MID') add({ code: 'SENIOR_JOB', severity: 'hard_fail', message: `AI read the full posting as ${f.aiSeniority.toLowerCase()}-level, not entry level.`, evidence: ev('seniority') });
  if (!f.isSeniorTitle && ABOVE_ENTRY_TITLE.test(inp.title) && !/\b(junior|graduate|intern|trainee|entry)\b/i.test(inp.title)) add({ code: 'SENIOR_JOB', severity: 'hard_fail', message: `Title "${inp.title}" is above entry level (L2/L3, tier 2-3, architect…).` });
  if (f.requiredExperienceYears != null && f.requiredExperienceYears > GULF_MAX_EXPERIENCE_YEARS) {
    add({ code: 'EXPERIENCE_EXCEEDS_ENTRY_LEVEL', severity: f.experienceRequirement === 'PREFERRED' ? 'uncertain' : 'hard_fail',
      message: `Asks for ${f.requiredExperienceYears}+ years' experience (Gulf limit: ${GULF_MAX_EXPERIENCE_YEARS} years)${f.experienceRequirement === 'PREFERRED' ? ' — stated as preferred' : ''}.`, evidence: ev('experience') });
  }
  // Spec §11: never Eligible without a readable posted date.
  if (!inp.postedAt) add({ code: 'POSTED_DATE_UNKNOWN', severity: 'uncertain', message: 'No posting date could be read — check the job is current.' });
  if (f.postingType === 'JOB_LISTING_PAGE' || f.postingType === 'NOT_A_JOB') add({ code: 'NOT_A_JOB_POSTING', severity: 'hard_fail', message: 'Not a single job posting.' });
  else if (NOT_A_VACANCY_TITLE.test(inp.title)) add({ code: 'NOT_A_JOB_POSTING', severity: 'hard_fail', message: 'Talent pool / "register your interest" page — not a vacancy.' });
  if (f.scamSignals?.length) add({ code: 'SUSPECTED_SCAM', severity: 'hard_fail', message: `Possible scam: ${[...new Set(f.scamSignals)].join('; ')}.`, evidence: ev('scam_signal') });
  if (f.mandatoryClearances.length) add({ code: 'OTHER_MANDATORY_VETTING', severity: 'uncertain', message: `Mandatory clearance mentioned (${f.mandatoryClearances.join(', ')}) — usually local-national only.`, evidence: ev('clearance_mandatory') });
  // Spec §6: experience not stated and the title has no level word → review (not excluded).
  if (f.requiredExperienceYears == null && !/\b(graduate|intern|junior|entry|trainee|fresh)\b/i.test(inp.title) && !['ENTRY', 'INTERN', 'GRADUATE', 'JUNIOR'].includes(f.aiSeniority ?? '')) {
    add({ code: 'EXPERIENCE_NOT_STATED', severity: 'uncertain', message: 'Experience level not stated and the title gives no level — check it is entry level.' });
  }
  // Spec §9: entry-level score; Eligible needs ≥ threshold.
  const sc = gulfEntryScore({ title: inp.title, text: inp.text, facts: f, postedAt: inp.postedAt, applyKind: inp.applyKind, today: inp.today });
  const hard0 = reasons.some((r) => r.severity === 'hard_fail');
  if (!hard0 && sc.score < (inp.minScoreEligible ?? 60)) {
    add({ code: 'LOW_ENTRY_LEVEL_SCORE', severity: 'uncertain', message: `Entry-level score ${sc.score}/100 (needs ${inp.minScoreEligible ?? 60} for Eligible): ${sc.parts.join(', ') || 'no entry-level signals'}.` });
  } else if (!hard0) add({ code: 'LOW_ENTRY_LEVEL_SCORE', severity: 'advisory', message: `Entry-level score ${sc.score}/100: ${sc.parts.join(', ')}.` });
  const hard = reasons.some((r) => r.severity === 'hard_fail');
  const unc = reasons.some((r) => r.severity === 'uncertain');
  const matrix: VisaMatrix = { current_right_to_work: 'UNKNOWN', role_accepts_graduate_visa: 'UNKNOWN', vacancy_offers_sponsorship: f.sponsorPolicy === 'OFFERS_SPONSORSHIP' ? 'EXPLICIT_YES' : f.sponsorPolicy === 'NO_SPONSORSHIP' ? 'EXPLICIT_NO' : 'UNKNOWN', employer_has_skilled_worker_licence: 'AMBIGUOUS', duration_feasibility: 'UNKNOWN', overall_immigration_assessment: hard ? 'EXCLUDED' : unc ? 'NEEDS_REVIEW' : 'NO_STATED_BLOCKER_UNCONFIRMED' };
  if (!hard && !unc) add({ code: 'SPONSORSHIP_NOT_CONFIRMED', severity: 'advisory', message: 'Open to all nationalities as far as the posting says — confirm the employer provides a work visa.' });
  return { status: closed ? 'STALE' : hard ? 'EXCLUDED' : unc ? 'NEEDS_REVIEW' : 'POTENTIAL_NO_STATED_BLOCKER', reasons, matrix, rulesVersion: GULF_RULES_VERSION, permissionNote: `${MARKETS[inp.market].name}: entry-level cyber roles, max ${GULF_MAX_EXPERIENCE_YEARS} years' experience, not nationals-only.` };
}

/** Gulf employers to probe for public careers boards (candidate list; verified at runtime). */
export const GULF_COMPANIES = [
  'Careem', 'Tabby', 'Tamara', 'Kitopi', 'Talabat', 'noon', 'Property Finder', 'dubizzle', 'Bayut', 'Anghami', 'Lean Technologies', 'Sary',
  'Salla', 'Foodics', 'Unifonic', 'Zid', 'Rewaa', 'Ninja', 'Jahez', 'HungerStation', 'Mrsool', 'Nana', 'Lucidya', 'Tabby', 'Mamo', 'Ziina',
  'Huspy', 'Stake', 'Sarwa', 'Baraka', 'YAP', 'Wio Bank', 'Liv', 'Mashreq', 'Emirates NBD', 'FAB', 'ADCB', 'Network International', 'Telr',
  'Checkout.com', 'Stripe', 'Visa', 'Mastercard', 'Cloudflare', 'Okta', 'Datadog', 'Elastic', 'MongoDB', 'Snowflake', 'Palo Alto Networks',
  'CrowdStrike', 'SentinelOne', 'Kaspersky', 'Trend Micro', 'Group-IB', 'Help AG', 'CPX', 'Spire Solutions', 'Paladion', 'Kroll', 'Deloitte',
  'PwC', 'EY', 'KPMG', 'Accenture', 'IBM', 'Microsoft', 'Oracle', 'Cisco', 'Ooredoo', 'Vodafone Qatar', 'stc', 'Mobily', 'Zain', 'du', 'e&',
  'Etisalat', 'G42', 'Presight', 'Core42', 'Bayanat', 'Beyon', 'Majid Al Futtaim', 'Chalhoub', 'Emaar', 'Aramco Digital', 'Elm', 'Thiqah',
  'Lucid', 'Tarabut', 'Sumsub', 'Fresha', 'Yalla', 'Kitopi', 'Swvl', 'Pure Harvest', 'Vezeeta', 'Fetchr', 'Instabug',
];
