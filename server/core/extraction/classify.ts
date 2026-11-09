import type { Category, EmploymentType } from '../models.js';

const SECURITY_RE = /\b(soc|security operations?|cyber|cyber ?security|information security|infosec|security analyst|security engineer|threat|vulnerabilit(y|ies)|incident response|forensic|blue team|red team|penetration|pen ?test|appsec|application security|detection|dfir|siem|security (intern|graduate|associate|specialist|consultant|monitoring|assurance|operations)|security)\b/i;
const GRC_RE = /\b(grc|governance|technology risk|tech risk|cyber risk|it risk|information risk|operational risk|third[- ]party risk|vendor risk|risk (and|&) controls?|it audit|technology audit|internal audit|security compliance|technology compliance|it compliance|privacy|data protection|assurance|security policy|regulat(ory|ion)|controls? (analyst|tester|testing))\b/i;
const IT_RE = /\b(it support|it service|it operations|it technician|it analyst|it intern|it graduate|it engineer|it apprentice|it associate|it assistant|helpdesk|help desk|service desk|desktop support|end ?user (support|computing|services)|technical support|tech support|support technician|infrastructure|systems? administrator|sysadmin|system engineer|network (engineer|analyst|operations|support|technician)|noc\b|cloud support|cloud operations|data cent(re|er)|endpoint|technology analyst|technical operations|tech ops|it\b|workplace technology|av technician|support engineer)\b/i;
const SWE_RE = /\b(software (engineer|engineering|developer|development)|developer|full[- ]?stack|back[- ]?end|front[- ]?end|mobile engineer|ios|android|web developer|machine learning|ml engineer|data scien|ai engineer|research scientist|data engineer|platform engineer|devops engineer|site reliability|sre)\b/i;
const OTHER_RE = /\b(sales|account (executive|manager)|business development|marketing|recruiter|talent acquisition|people partner|hr\b|human resources|finance|accountant|accounting|payroll|legal counsel|lawyer|solicitor|paralegal|customer success|designer|product manager|product owner|copywriter|operations associate|chef|nurse|teacher|driver|warehouse|credit risk|market risk|actuar|underwrit|financial crime|aml\b|kyc\b|fraud)\b/i;
const PHYSICAL_SECURITY_RE = /\b(security (guard|officer|supervisor)|door supervisor|cctv operator|patrol|concierge|loss prevention|close protection|site security)\b/i;

/** Classify by title first, then by strong JD signals. Pure SWE is OTHER unless clearly security-focused. */
export function classifyCategory(title: string, text = ''): Category {
  const t = title;
  if (PHYSICAL_SECURITY_RE.test(t)) return 'OTHER';
  if (/\b(sales|account (executive|manager|partner|director)|business development|marketing|recruiter|talent acquisition|underwrit\w*|actuar\w*|fp&a|analyst relations|product (manager|analyst|owner|designer)|bi analyst|business intelligence|quant\w*|researcher|data (analyst|scientist)|growth|customer success|legal|lawyer|counsel)\b/i.test(t)) return 'OTHER';
  const grcTitle = GRC_RE.test(t);
  const secTitle = SECURITY_RE.test(t);
  const itTitle = IT_RE.test(t);
  if (grcTitle && /\b(cyber|security|technology|it|information|tech|grc)\b/i.test(t)) return 'GRC_RISK_AUDIT';
  if (/\bgrc\b/i.test(t)) return 'GRC_RISK_AUDIT';
  if (secTitle) return 'SOC_SECURITY';
  if (SWE_RE.test(t)) return 'OTHER';
  if (itTitle) return 'IT_TECHNICAL';
  if (grcTitle) {
    // Plain "Compliance/Audit/Risk" titles count only with strong technology-control signals in the JD.
    const signals = (text.match(/\b(ISO ?27001|NIST|SOC ?2|cyber|information security|IT general controls|ITGC|access management|PCI[- ]DSS|DORA|CIS controls)\b/gi) ?? []).length;
    return signals >= 2 ? 'GRC_RISK_AUDIT' : 'OTHER';
  }
  if (OTHER_RE.test(t)) return 'OTHER';
  if (/\b(intern|internship|graduate|analyst|associate|trainee)\b/i.test(t)) {
    if (/\b(technology|tech)\b/i.test(t)) return 'IT_TECHNICAL';
    return 'UNKNOWN';
  }
  return 'OTHER';
}

export const SENIOR_TITLE_RE = /\b(senior|sr\.?|lead|principal|head of|director|vp|vice president|chief|staff (engineer|analyst|security|sre|software|data|platform|infrastructure|devops|cloud|network)|staff\s*,|architect|manager|mgr|expert|distinguished|partner)\b/i;
/** Talent pools / "register your interest" pages: not a vacancy you can apply to. */
export const NOT_A_VACANCY_TITLE = /\b(register (your )?interest|talent (pool|community|network)|future opportunit(y|ies)|expression of interest|general application|speculative application|join our talent|open application)\b/i;
export function isSeniorTitle(title: string): boolean {
  if (/\b(junior|graduate|intern|trainee|apprentice|entry)\b/i.test(title) && !/\b(head of|director)\b/i.test(title)) return false;
  return SENIOR_TITLE_RE.test(title);
}

export function classifyEmploymentType(title: string, text: string): EmploymentType {
  const both = `${title}\n${text.slice(0, 6000)}`;
  if (/\boff[- ]?cycle\b/i.test(both) && /\bintern/i.test(both)) return 'OFF_CYCLE_INTERNSHIP';
  if (/\b(intern|internship|summer analyst|industrial trainee)\b/i.test(title)) return 'INTERNSHIP';
  if (/\bgraduate (programme|program|scheme|development programme|rotational)\b/i.test(both) || /\bgraduate scheme\b/i.test(title)) return 'GRADUATE_PROGRAMME';
  if (/\b(fixed[- ]term|ftc|temporary|maternity cover|contract role|\d+[- ]month contract)\b/i.test(both)) return 'FIXED_TERM';
  if (/\bintern(ship)?\b/i.test(text.slice(0, 1500))) return 'INTERNSHIP';
  if (/\bpermanent\b/i.test(both)) return 'PERMANENT';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------
const UK_PLACES = [
  'london', 'greater london', 'city of london', 'canary wharf', 'westminster', 'croydon', 'stratford', 'hammersmith', 'kingston',
  'uk', 'u.k.', 'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland', 'gb',
  'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh', 'bristol', 'cardiff', 'belfast', 'liverpool', 'newcastle',
  'sheffield', 'nottingham', 'leicester', 'cambridge', 'oxford', 'reading', 'milton keynes', 'brighton', 'southampton',
  'portsmouth', 'york', 'bath', 'exeter', 'plymouth', 'coventry', 'swansea', 'aberdeen', 'dundee', 'norwich', 'ipswich',
  'guildford', 'woking', 'slough', 'watford', 'luton', 'stevenage', 'cheltenham', 'gloucester', 'swindon', 'derby',
  'stoke', 'wolverhampton', 'lancaster', 'preston', 'chester', 'warrington', 'basingstoke', 'farnborough', 'crawley',
  'maidstone', 'canterbury', 'chelmsford', 'colchester', 'hertfordshire', 'surrey', 'kent', 'essex', 'berkshire', 'hampshire',
];
const LONDON_RE = /\b(london|canary wharf|city of london|westminster|croydon|stratford|hammersmith|greater london)\b/i;
const NON_UK_RE = /\b(united states|usa|u\.s\.|new york|san francisco|seattle|austin|boston|chicago|toronto|canada|india|bangalore|bengaluru|singapore|sydney|australia|germany|berlin|munich|france|paris|spain|madrid|barcelona|netherlands|amsterdam|ireland|dublin|poland|warsaw|portugal|lisbon|lithuania|vilnius|japan|tokyo|brazil|mexico|israel|tel aviv|dubai|uae|south africa|switzerland|zurich|sweden|stockholm|denmark|copenhagen|italy|milan|romania|bucharest|czech|prague|hong kong|china|kuala lumpur|philippines|manila|estonia|tallinn|latvia|riga|greece|athens|finland|helsinki|norway|oslo|belgium|brussels|austria|vienna|hungary|budapest|bulgaria|sofia|serbia|belgrade|ukraine|croatia|ny\b|ca\b|tx\b|wa\b)\b/i;

const US_CITIES = /\b(palo alto|denver|los angeles|mountain view|sunnyvale|san jose|san diego|atlanta|miami|dallas|houston|philadelphia|pittsburgh|portland|salt lake|raleigh|nashville|phoenix|minneapolis|detroit|reston|arlington|mclean|herndon|honolulu|brooklyn|nyc|bay area|silicon valley|vancouver|montreal|calgary|ottawa|sao paulo|bogota|buenos aires|seoul|taipei|jakarta|bangkok|hyderabad|pune|chennai|mumbai|delhi|gurgaon|noida|krakow|wroclaw|cluj|lisboa|porto|valencia|malaga|lyon|hamburg|frankfurt|cologne|stuttgart|berlin|rotterdam|eindhoven|gothenburg|cork|galway|luxembourg|geneva|tel-aviv|herzliya|cairo|lagos|nairobi|riyadh|doha|abu dhabi|kuwait)\b/;

export type LocationScope = 'LONDON' | 'UK' | 'UK_REMOTE' | 'AMBIGUOUS_REMOTE' | 'NON_UK' | 'UNKNOWN';
export function classifyLocation(loc: string | null | undefined): LocationScope {
  if (!loc || !loc.trim()) return 'UNKNOWN';
  const l = loc.toLowerCase();
  const hasUk = UK_PLACES.some((p) => new RegExp(`(^|[^a-z])${p.replace(/\./g, '\\.')}([^a-z]|$)`).test(l));
  const remote = /\b(remote|anywhere|home[- ]based|distributed|work from home|wfh)\b/.test(l);
  if (/\b(ontario|canada)\b/.test(l)) return 'NON_UK';
  if (LONDON_RE.test(l)) return 'LONDON';
  const ukCountry = /\b(uk|u\.k\.|united kingdom|great britain|england|scotland|wales|northern ireland|gb)\b/.test(l);
  if (NON_UK_RE.test(l) && !ukCountry) return 'NON_UK';
  // "City, ST" US state codes, "D.C.", "US"/"Remote - US" style locations.
  if (!ukCountry && !hasUk && (/,\s*[A-Z]{2}\b/.test(loc) || /\b(d\.c|us|united states|americas|latam|apac|north america)\b/.test(l) || US_CITIES.test(l))) return 'NON_UK';
  if (hasUk && remote) return 'UK_REMOTE';
  if (hasUk) return 'UK';
  if (NON_UK_RE.test(l)) return 'NON_UK';
  if (remote || /\b(emea|europe)\b/.test(l)) return 'AMBIGUOUS_REMOTE';
  return 'UNKNOWN';
}

export function remoteFlag(loc: string | null | undefined, text = ''): 'REMOTE' | 'HYBRID' | 'ONSITE' | null {
  const s = `${loc ?? ''} ${text.slice(0, 4000)}`.toLowerCase();
  if (/\bhybrid\b/.test(s)) return 'HYBRID';
  if (/\b(fully remote|remote[- ]first|100% remote|remote)\b/.test(`${loc ?? ''}`.toLowerCase())) return 'REMOTE';
  if (/\b(on[- ]site|in[- ]office|office[- ]based)\b/.test(s)) return 'ONSITE';
  return null;
}
