// Natural-language query → SearchIntent. The intent can only NARROW results; it can never relax
// protected eligibility policy (sponsor register, visa, clearance, seniority). Spec §12.
import type { SearchIntent } from '../models.js';

export const SEARCH_MODES = {
  ALL: 'All 3 Disciplines',
  SOC: 'SOC / Technical Cyber',
  GRC: 'GRC / Non-Technical Cyber',
  IT: 'IT / Infrastructure',
  INTERNSHIPS: 'Internships Only',
  OFFCYCLE: 'Off-Cycle Internships Only',
  FIXED12: 'Fixed-Term <=12 Months',
  CUSTOM: 'Custom',
} as const;
export type SearchMode = keyof typeof SEARCH_MODES;

const POLICY_BYPASS = [
  { re: /\b(sc|dv|ctc|security cleared|clearance) (jobs|roles)\b|\bshow (sc|dv|ctc)\b|\binclude (sc|dv|ctc|cleared)\b/i, msg: 'clearance-required jobs' },
  { re: /\b(without|no|unlicensed|non[- ]sponsor|not on the) (sponsor|licen[cs]e|register)|\binclude companies without\b|\bignore sponsor/i, msg: 'employers without a Skilled Worker licence' },
  { re: /\b(senior|lead|principal|manager|head of)\b/i, msg: 'senior roles' },
  { re: /\b(british citizens? only|citizens only|unpaid)\b/i, msg: 'roles your protected settings exclude' },
  { re: /\bignore (visa|rules|filters|settings)\b/i, msg: 'visa or eligibility rules' },
];

export function parseNaturalLanguage(raw: string, mode: SearchMode = 'ALL'): SearchIntent {
  const q = raw.trim();
  const l = q.toLowerCase();
  const cats = new Set<SearchIntent['categories'][number]>();
  const keywords: string[] = [];
  const warnings: string[] = [];

  if (/\b(soc|security operations|blue team|threat|incident|forensic|vulnerab|security analyst|cyber ?security|cyber|infosec|information security|security engineer|pen ?test)\b/.test(l)) cats.add('SOC_SECURITY');
  if (/\b(grc|governance|risk|compliance|audit|assurance|controls|policy|regulat|privacy|non[- ]technical|no coding|non[- ]coding)\b/.test(l)) cats.add('GRC_RISK_AUDIT');
  if (/(^|\s)it(\s|$)|\b(it support|helpdesk|help desk|service desk|desktop|infrastructure|noc|network|sysadmin|systems? admin|cloud support|technical support|data cent|endpoint|tech ops|technical operations)\b/.test(l)) cats.add('IT_TECHNICAL');
  // "information security" assurance/compliance in GRC context should not also pull SOC
  if (/\b(non[- ]technical|no coding|non[- ]coding)\b/.test(l)) cats.delete('SOC_SECURITY');
  if (/\bsecurity assurance\b|\bsecurity compliance\b/.test(l) && !/\b(soc|analyst|operations)\b/.test(l)) { cats.delete('SOC_SECURITY'); cats.add('GRC_RISK_AUDIT'); }
  if (/\bsoc\b/.test(l) && !/\b(grc|risk|audit|compliance)\b/.test(l)) cats.delete('GRC_RISK_AUDIT');

  switch (mode) {
    case 'SOC': cats.clear(); cats.add('SOC_SECURITY'); break;
    case 'GRC': cats.clear(); cats.add('GRC_RISK_AUDIT'); break;
    case 'IT': cats.clear(); cats.add('IT_TECHNICAL'); break;
    default: break;
  }
  if (cats.size === 0) { cats.add('SOC_SECURITY'); cats.add('GRC_RISK_AUDIT'); cats.add('IT_TECHNICAL'); }

  const offCycle = /\boff[- ]?cycle\b/.test(l) || mode === 'OFFCYCLE';
  const internships = /\bintern(ship)?s?\b/.test(l) || offCycle || mode === 'INTERNSHIPS';
  const types: SearchIntent['employmentTypes'] = [];
  if (offCycle) types.push('OFF_CYCLE_INTERNSHIP');
  if (internships && !offCycle) types.push('INTERNSHIP', 'OFF_CYCLE_INTERNSHIP');
  if (/\bgraduate (scheme|programme|program)\b/.test(l)) types.push('GRADUATE_PROGRAMME');
  if (/\b(fixed[- ]term|contract|temporary|temp)\b/.test(l) || mode === 'FIXED12') types.push('FIXED_TERM', 'INTERNSHIP', 'OFF_CYCLE_INTERNSHIP');

  let maxMonths: number | null = mode === 'FIXED12' ? 12 : null;
  const mm = l.match(/\b(\d{1,2})[- ]?(month|mo)s?\b/);
  if (mm) maxMonths = Number(mm[1]);

  let location: SearchIntent['location'] = null;
  if (/\blondon\b/.test(l)) location = 'LONDON';
  else if (/\b(anywhere in the uk|anywhere uk|across the uk|uk[- ]wide|anywhere)\b/.test(l)) location = 'UK';
  else if (/\bremote\b/.test(l)) location = 'REMOTE';

  const universities = /\b(universit(y|ies)|college|higher education)\b/.test(l);
  for (const b of POLICY_BYPASS) if (b.re.test(q)) warnings.push(`Your current settings exclude ${b.msg}. Change the protected settings explicitly to alter the policy.`);

  const stop = new Set(['in', 'the', 'uk', 'jobs', 'roles', 'role', 'anywhere', 'london', 'remote', 'and', 'or', 'of', 'for', 'a', 'no', 'month', 'months', 'internship', 'internships', 'intern', 'off', 'cycle', 'off-cycle', 'show', 'me', 'graduate', 'it']);
  for (const w of l.split(/[^a-z0-9+-]+/)) if (w && !stop.has(w) && !/^\d+$/.test(w) && w.length > 2) keywords.push(w);

  return {
    raw: q, categories: [...cats], keywords: [...new Set(keywords)].slice(0, 8), employmentTypes: [...new Set(types)],
    offCycleOnly: offCycle, internshipsOnly: internships && !types.includes('FIXED_TERM'), maxContractMonths: maxMonths, location,
    nonTechnical: /\b(non[- ]technical|no coding|non[- ]coding)\b/.test(l), universitiesOnly: universities, policyWarnings: warnings,
  };
}

export const ROLE_QUERIES: Record<SearchIntent['categories'][number], string[]> = {
  SOC_SECURITY: ['security analyst', 'SOC analyst', 'cyber security graduate', 'information security analyst', 'security operations', 'cyber security intern'],
  GRC_RISK_AUDIT: ['GRC analyst', 'technology risk', 'cyber risk analyst', 'IT audit', 'security compliance', 'information security governance'],
  IT_TECHNICAL: ['IT support analyst', 'service desk analyst', 'IT graduate', 'infrastructure support', 'junior systems administrator', 'NOC analyst'],
};

/** Role queries for keyword APIs/search providers, internship variants first. */
export function buildRoleQueries(intent: SearchIntent, max: number): string[] {
  const out: string[] = [];
  if (intent.roleQueries?.length) {
    // Your enabled target roles drive the queries; internship/graduate flavour from the role toggle.
    const mod = intent.roleFocus === 'INTERNSHIP' || intent.internshipsOnly ? ' internship' : intent.roleFocus === 'GRADUATE' ? ' graduate' : '';
    const qs = [...(intent.keywords.length ? [intent.keywords.join(' ')] : []), ...intent.roleQueries.map((q) => (/intern|graduate|junior/i.test(q) ? q : q + mod))];
    return [...new Set(qs)].slice(0, max);
  }
  const mods = intent.offCycleOnly ? ['off-cycle internship'] : intent.internshipsOnly ? ['internship', 'graduate'] : ['internship', 'graduate', 'junior'];
  const per = intent.categories.map((c) => ROLE_QUERIES[c]);
  for (let i = 0; i < 6 && out.length < max; i++) {
    for (const list of per) {
      const base = list[i];
      if (!base) continue;
      const mod = mods[i % mods.length];
      const q = /intern|graduate|junior/i.test(base) ? base : `${base} ${mod}`;
      if (!out.includes(q)) out.push(q);
      if (out.length >= max) break;
    }
  }
  if (intent.keywords.length && out.length < max + 1) out.unshift(intent.keywords.join(' '));
  return out.slice(0, max);
}

/** Boolean-like query strings for a licensed search provider or a manual browser search (spec §4.3). */
export function buildBooleanQueries(intent: SearchIntent): string[] {
  const cat: string[] = [];
  if (intent.categories.includes('SOC_SECURITY')) cat.push('"cyber security"', '"information security"', 'SOC', '"security analyst"');
  if (intent.categories.includes('GRC_RISK_AUDIT')) cat.push('"technology risk"', 'GRC', '"IT audit"', '"cyber risk"');
  if (intent.categories.includes('IT_TECHNICAL')) cat.push('"IT support"', '"service desk"', '"infrastructure"');
  const lvl = intent.offCycleOnly ? '("off-cycle" OR "off cycle")' : '("off-cycle" OR "graduate internship" OR internship OR graduate OR junior)';
  const loc = intent.location === 'LONDON' ? '("London" OR "Greater London")' : '("United Kingdom" OR UK)';
  const roles = `(${cat.join(' OR ')})`;
  return [
    `${lvl} ${roles} ${loc}`,
    `site:boards.greenhouse.io ${roles} ${intent.offCycleOnly ? 'off-cycle' : '(internship OR graduate OR junior)'} London`,
    `site:jobs.lever.co ${roles} (internship OR graduate OR junior) London`,
    `site:jobs.ashbyhq.com ${roles} (internship OR graduate OR junior) London`,
  ];
}
