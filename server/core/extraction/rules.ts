// Deterministic, evidence-grounded pre-analysis of a full job description (spec §11.1 step 4, §11.3).
// Every positive finding carries the exact sentence it came from (with offsets into the JD text).
import type { Evidence, ExtractedJobFacts } from '../models.js';
import { splitSentences, NUM_WORD_RE, parseNum, type Sentence } from '../util/text.js';
import { classifyCategory, classifyEmploymentType, isSeniorTitle } from './classify.js';
import { coreKey } from '../sponsors/normalize.js';

export interface RuleInput {
  title: string;
  advertisedEmployer: string | null;
  location: string | null;
  text: string;
  sourceUrl: string;
  applyUrl?: string | null;
  salaryText?: string | null;
  closingDate?: string | null;
  legalEmployerHint?: string | null;
}

const OPTIONAL_CUE = /\b(desirable|desired|advantageous|advantage|preferred|preferable|preferably|ideally|nice[- ]to[- ]have|a plus|bonus|beneficial|would be (great|good|helpful|useful)|not essential|optional|is a plus|helpful but)\b/i;
const MANDATORY_CUE = /\b(must|required|requirement|requires|essential|mandatory|need to|needs to|necessary|will need|you will be required|only|minimum|at least|eligible|eligibility|ability to (obtain|gain|achieve|attain)|able to (obtain|gain|achieve|attain)|willing(ness)? to (undergo|obtain)|subject to|condition of|be cleared|already hold|hold a current|hold an active|you('| a)?re required)\b/i;
const HEDGE_CUE = /\b(may|might|could|possibly|potentially)\b/i;
const NEG_RE = /\b(not|no|never|don'?t|do not|doesn'?t|does not|cannot|can'?t|unable|without|won'?t|will not|isn'?t|aren'?t|are not|is not)\b/i;
const NOT_NEEDED_RE = /\b(not (required|needed|necessary|essential|a requirement)|no need|don'?t need|do not need|doesn'?t need|does not need|isn'?t required|is not required|no (prior )?clearance (is )?(required|needed))\b/i;
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';

type SectionKind = 'REQUIRED' | 'DESIRABLE' | 'OTHER';
interface Heading { start: number; kind: SectionKind; text: string }

function findHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  let off = 0;
  for (const line of text.split('\n')) {
    const t = line.trim().replace(/^[•\-*]\s*/, '');
    const words = t.split(/\s+/).length;
    const isHeading = t.length > 0 && t.length <= 80 && (/:$/.test(t) || (words <= 8 && !/[.!?;,]$/.test(t) && /^[A-Z]/.test(t) && !line.trim().startsWith('•')));
    if (isHeading) {
      const kind: SectionKind = /desir|nice to have|bonus|preferred|plus|advantag|great if|extra credit|good to have/i.test(t)
        ? 'DESIRABLE'
        : /requir|essential|must|need|qualif|looking for|about you|you have|you will have|you'll have|skills|experience|criteria|eligib|who you are|you bring|what we('| a)?re looking/i.test(t)
          ? 'REQUIRED' : 'OTHER';
      out.push({ start: off, kind, text: t });
    }
    off += line.length + 1;
  }
  return out;
}
function sectionOf(headings: Heading[], pos: number): Heading | null {
  let h: Heading | null = null;
  for (const x of headings) { if (x.start <= pos) h = x; else break; }
  return h;
}

export function extractRuleFacts(inp: RuleInput): ExtractedJobFacts {
  const text = inp.text ?? '';
  const sents = splitSentences(text);
  const headings = findHeadings(text);
  const evidence: Evidence[] = [];
  const missing: string[] = [];
  const ev = (field: string, s: Sentence, confidence: Evidence['confidence'] = 'HIGH') => {
    const quote = s.text.length > 400 ? s.text.slice(0, 400) : s.text;
    const h = sectionOf(headings, s.start);
    evidence.push({ field, quote, section: h?.text, startOffset: s.start, endOffset: s.start + quote.length, sourceUrl: inp.sourceUrl, confidence, origin: 'RULES', validated: true });
  };
  const requirementLevel = (s: Sentence): 'MANDATORY' | 'OPTIONAL' | 'HEDGED' | 'UNSTATED' => {
    if (OPTIONAL_CUE.test(s.text)) return 'OPTIONAL';
    const sec = sectionOf(headings, s.start);
    if (sec?.kind === 'DESIRABLE') return 'OPTIONAL';
    if (MANDATORY_CUE.test(s.text)) return 'MANDATORY';
    if (HEDGE_CUE.test(s.text)) return 'HEDGED';
    if (sec?.kind === 'REQUIRED') return 'MANDATORY';
    return 'UNSTATED';
  };

  // ---------------------------------------------------------------- clearance / vetting
  const mandatoryClearances = new Set<string>();
  const optionalClearances = new Set<string>();
  const backgroundChecks = new Set<string>();
  let ambiguousVetting = false;
  for (const s of sents) {
    const t = s.text;
    const ctx = /\b(clear(ance|ed)?|vett(ing|ed)|level|security check|check)\b/i.test(t);
    const levels: string[] = [];
    if ((/\bSC\b/.test(t) && ctx) || /\bsecurity check(ed)?\b(?![- ]?(ups?|in))/i.test(t) && /\b(clearance|cleared|vetting|level)\b/i.test(t)) levels.push('SC');
    if (/\bSecurity Check\b/.test(t) && !levels.includes('SC')) levels.push('SC');
    if ((/\b(e?DV)\b/.test(t) && ctx) || /\bdeveloped vetting\b/i.test(t)) levels.push('DV');
    if ((/\bCTC\b/.test(t) && ctx) || /\bcounter[- ]terror(ist|ism)? check\b/i.test(t)) levels.push('CTC');
    if (/\b(NPPV\d?|national security vetting|NSV)\b/i.test(t)) levels.push('OTHER_VETTING');
    if (/\bBPSS\b|baseline personnel security/i.test(t)) backgroundChecks.add('BPSS');
    if (/\bDBS\b|disclosure and barring/i.test(t)) backgroundChecks.add('DBS');
    if (/\b(background|pre[- ]employment|credit|criminal record|reference) (check|screening|verification)s?\b/i.test(t)) backgroundChecks.add('Pre-employment checks');

    if (NOT_NEEDED_RE.test(t) && (levels.length || /clearance|vetting/i.test(t))) { ev('clearance_not_required', s, 'MEDIUM'); continue; }
    if (levels.length) {
      const lvl = requirementLevel(s);
      for (const l of levels) {
        if (lvl === 'MANDATORY') { mandatoryClearances.add(l); ev(`clearance_mandatory_${l}`, s); }
        else if (lvl === 'OPTIONAL') { optionalClearances.add(l); ev(`clearance_optional_${l}`, s); }
        else { ambiguousVetting = true; ev(`clearance_ambiguous_${l}`, s, 'MEDIUM'); }
      }
    } else if (/\b(security clearance|security vetting|government clearance|vetting process|security screening)\b/i.test(t) && !/\bBPSS\b/.test(t)) {
      const lvl = requirementLevel(s);
      if (lvl === 'OPTIONAL') { optionalClearances.add('UNSPECIFIED'); ev('clearance_optional_UNSPECIFIED', s, 'MEDIUM'); }
      else { ambiguousVetting = true; ev('clearance_ambiguous_UNSPECIFIED', s, 'MEDIUM'); }
    }
  }
  if (ambiguousVetting) missing.push('Security vetting level/requirement is ambiguous — check whether SC/DV/CTC is mandatory.');

  // ---------------------------------------------------------------- nationality / residency
  let britishMandatory: boolean | null = null;
  const otherNat: string[] = [];
  let residencyYears: number | null = null;
  for (const s of sents) {
    const t = s.text;
    if (/\b(british|uk|u\.k\.|united kingdom) (citizen|citizens|citizenship|national|nationals|nationality)\b|\bbritish nationality\b|\bsole (british|uk) national/i.test(t)) {
      const hasAlternative = /\bor\b[^.]{0,80}\b(right to work|visa|leave to remain|work permit|eligible to work|settled|pre-settled|eu settlement)\b/i.test(t);
      if (NOT_NEEDED_RE.test(t) || /\b(not|no) (need|requirement) to be\b/i.test(t)) { ev('nationality_not_required', s, 'MEDIUM'); continue; }
      if (!hasAlternative && (MANDATORY_CUE.test(t) || /\b(only|reserved for|restricted to)\b/i.test(t))) {
        britishMandatory = true; ev('british_citizenship_mandatory', s);
      } else if (hasAlternative) {
        ev('nationality_with_alternatives', s, 'MEDIUM');
      }
    }
    const m = t.match(/\b(EU|EEA|Commonwealth|US|American|Irish|Swiss) (citizen|citizens|nationals?|citizenship)\b/i);
    if (m && MANDATORY_CUE.test(t) && !/\bor\b[^.]{0,60}\b(right to work|visa)\b/i.test(t)) { otherNat.push(m[0]); ev('other_nationality_restriction', s); }
    const r = t.match(new RegExp(`\\b(resident|residency|lived|living|residence)\\b[^.]{0,60}\\b(uk|united kingdom|britain)\\b[^.]{0,40}?\\b(${NUM_WORD_RE})\\s*(\\+\\s*)?years?`, 'i'))
      ?? t.match(new RegExp(`\\b(${NUM_WORD_RE})\\s*(\\+\\s*)?years?['’]?\\s*(of\\s+)?(continuous\\s+)?(uk\\s+)?residen(cy|ce|t)\\b`, 'i'));
    if (r) {
      const n = parseNum(r[3] ?? r[1]);
      if (n != null) { residencyYears = n; ev('uk_residency_years', s); }
    }
  }

  // ---------------------------------------------------------------- work authorisation / visa / sponsorship
  let permanentRTW: boolean | null = null;
  let gvLang: ExtractedJobFacts['graduateVisaLanguage'] = 'NO_STATED_BLOCKER';
  let sponsor: ExtractedJobFacts['sponsorPolicy'] = 'SILENT';
  let strictFuture: boolean | null = null;
  const sponsorSignals = new Set<'YES' | 'NO'>();
  for (const s of sents) {
    const t = s.text;
    // Permanent / unrestricted / settled requirement
    if (/\b(permanent|unrestricted|indefinite|unlimited|settled)\b[^.]{0,35}\b(right to (work|live and work|remain)|work authori[sz]ation|leave to remain|status|residency)\b/i.test(t)
      || /\b(ILR|indefinite leave to remain)\b/i.test(t) && MANDATORY_CUE.test(t)) {
      if (!NOT_NEEDED_RE.test(t) && (MANDATORY_CUE.test(t) || /\b(only|require)\b/i.test(t))) { permanentRTW = true; ev('permanent_right_to_work_required', s); }
    }
    // Time-limited / graduate visa bans
    if (/\b(cannot|can'?t|unable to|not able to|do not|don'?t|will not|won'?t|are not able to|is not able to|not in a position to)\b[^.]{0,30}\b(accept|consider|support|employ|take)\b[^.]{0,60}\b(time[- ]limited|temporary|limited|graduate|post[- ]study|psw)\b[^.]{0,20}\b(visas?|leave|right to work|permission|route)\b/i.test(t)
      || /\b(time[- ]limited|temporary) (visas?|leave|permission)\b[^.]{0,40}\b(not (be )?(accepted|eligible|considered)|ineligible)\b/i.test(t)
      || /\bgraduate (route |visa |route visa )?(holders? |applicants? )?(are |is |will )?(not|ineligible|cannot be)\b[^.]{0,20}\b(accepted|eligible|considered|supported|apply)\b/i.test(t)) {
      gvLang = 'EXPLICIT_DISALLOWED'; ev('graduate_visa_disallowed', s);
    } else if (/\bgraduate (route|visa)\b/i.test(t) && /\b(welcome|accept(ed)?|eligible|consider(ed)?|can apply|able to apply|encourage)\b/i.test(t) && !NEG_RE.test(t)) {
      if (gvLang !== 'EXPLICIT_DISALLOWED') { gvLang = 'EXPLICIT_ALLOWED'; ev('graduate_visa_allowed', s); }
    }
    // Sponsorship statements
    if (/\bsponsor(ship|ed|ing)?\b/i.test(t) && (/\b(visas?|work permits?|skilled worker|immigration|certificate of sponsorship|right to work|tier ?2|work authori[sz]ation|eligible to work|employment sponsorship)\b/i.test(t) || /\bsponsorship\b/i.test(t))
      && !/\b(export|event|conference|sports?|charity|corporate sponsorship|sponsorship (deck|deal|package|sales|partnership))\b/i.test(t)) {
      if (/\bsponsor(s|ed)? (licen[cs]e|register)\b/i.test(t) && !/\b(offer|provide|available|can|will|unable|not)\b/i.test(t)) continue;
      if (/\b(now or in the future|current(ly)? or (in the )?future|at any (point|time)|now or at any|in the future|future sponsorship)\b/i.test(t) && NEG_RE.test(t)) {
        strictFuture = true; sponsorSignals.add('NO'); ev('no_sponsorship_now_or_future', s);
      } else if (NEG_RE.test(t) || /\bunfortunately\b/i.test(t)) {
        sponsorSignals.add('NO'); ev('no_sponsorship', s);
      } else if (/\b(available|offer(ed|s)?|provide[ds]?|can sponsor|will sponsor|able to sponsor|support(ed)?|requiring sponsorship|welcome)\b/i.test(t)) {
        sponsorSignals.add('YES'); ev('sponsorship_offered', s);
      }
    }
    if (/\bright to (work|live and work) in the (uk|united kingdom)\b/i.test(t) && !/permanent|unrestricted|indefinite/i.test(t)) ev('right_to_work_generic', s, 'MEDIUM');
  }
  if (sponsorSignals.size === 2) { sponsor = 'AMBIGUOUS'; missing.push('Contradictory sponsorship statements.'); }
  else if (sponsorSignals.has('YES')) sponsor = 'OFFERS_SPONSORSHIP';
  else if (sponsorSignals.has('NO')) sponsor = 'NO_SPONSORSHIP';

  // ---------------------------------------------------------------- student-only / cohort
  let currentStudentRequired: boolean | null = null;
  const gradYears = new Set<number>();
  const graduatesWelcome = /\b(recent graduates?|graduates? (are )?(also )?welcome|graduated (with|in)|graduate internship|or (a )?graduates?|and graduates|graduates (of|from) any|have (recently )?graduated|post[- ]graduation|graduates? (are )?(also )?eligible)\b/i.test(text);
  const STUDENT_RE = /\b(currently (enrolled|studying|pursuing|undertaking|completing)|current(ly)? (an? )?(undergraduate|university|full[- ]time|degree) students?|must be (a |an )?(current |enrolled )?(university |undergraduate )?students?|penultimate[- ]year|returning to (university|your studies|study|full[- ]time education|your degree)|placement year|year[- ]in[- ]industry|industrial placement year|sandwich (year|placement|course)|second[- ]year (undergraduate )?students?|in (your|their) (second|penultimate) year|still (at|in) (university|education)|enrolled (on|in|at) (a|an) (degree|undergraduate|university|bachelor'?s?|master'?s?)( course| programme)?)\b/i;
  for (const s of sents) {
    const t = s.text;
    if (STUDENT_RE.test(t)) {
      const altInSentence = /\b(or|and) (recent )?graduates?\b|\bgraduates? (are )?welcome\b|\bhave graduated\b/i.test(t);
      if (!altInSentence && !NOT_NEEDED_RE.test(t)) {
        if (graduatesWelcome && !/\bmust\b/i.test(t)) { missing.push('Mixed student/graduate eligibility — check whether graduates may apply.'); ev('student_status_ambiguous', s, 'MEDIUM'); }
        else { currentStudentRequired = true; ev('current_student_required', s); }
      } else ev('students_or_graduates', s, 'MEDIUM');
    }
    const g = t.match(/\b(graduat(e|ing|ion)|complet(e|ing) (your|their|a) (degree|studies)|class of|degree (in|by))\b[^.]{0,50}?\b(20[2-3]\d)\b(?:\s*(?:,|or|and|-|–|to|\/)\s*(20[2-3]\d))?/i);
    if (g && /\b(between|in|by|from|of|during|class)\b/i.test(t) && !/\bfounded|since|established\b/i.test(t)) {
      const a = Number(g[7]); const b = g[8] ? Number(g[8]) : null;
      if (b && b >= a) for (let y = a; y <= b; y++) gradYears.add(y); else gradYears.add(a);
      ev('permitted_graduation_years', s);
    }
  }
  if (gradYears.size && currentStudentRequired == null && /\b(graduating|expected to graduate|due to graduate|final year)\b/i.test(text)) {
    // "graduating in 2027" style language implies current students
    currentStudentRequired = null;
    missing.push('Graduation cohort stated — compare with your graduation year.');
  }
  if (currentStudentRequired == null && graduatesWelcome) currentStudentRequired = false;

  // ---------------------------------------------------------------- experience
  let reqYears: number | null = null;
  let expReq: ExtractedJobFacts['experienceRequirement'] = 'UNSPECIFIED';
  const expRe = new RegExp(`\\b(${NUM_WORD_RE})\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*(${NUM_WORD_RE})\\s*)?\\+?\\s*years?['’]?\\s*(?:of\\s+)?(?:[a-z/&-]+\\s+){0,4}?experience`, 'i');
  const expRe2 = new RegExp(`\\bexperience\\b[^.]{0,30}?\\b(?:of|for)\\s+(?:at least\\s+|a minimum of\\s+)?(${NUM_WORD_RE})\\s*\\+?\\s*years?`, 'i');
  let bestMandatory = -1; let bestPreferred = -1;
  for (const s of sents) {
    const m = s.text.match(expRe) ?? s.text.match(expRe2);
    if (!m) continue;
    const n = parseNum(m[1]);
    if (n == null || n > 25) continue;
    const lvl = requirementLevel(s);
    if (lvl === 'OPTIONAL') { if (n > bestPreferred) { bestPreferred = n; ev('experience_preferred', s); } }
    else if (lvl === 'MANDATORY' || lvl === 'UNSTATED') { if (n > bestMandatory) { bestMandatory = n; ev('experience_required', s, lvl === 'MANDATORY' ? 'HIGH' : 'MEDIUM'); } }
  }
  if (bestMandatory >= 0) { reqYears = bestMandatory; expReq = 'MANDATORY'; }
  else if (bestPreferred >= 0) { reqYears = bestPreferred; expReq = 'PREFERRED'; }

  // ---------------------------------------------------------------- pay
  let isPaid: boolean | null = null;
  let salary: { min?: number; max?: number } | null = null;
  for (const s of sents) {
    if (/\b(unpaid|voluntary role|volunteer(ing)? (role|position)|expenses only|no salary|not paid)\b/i.test(s.text) && !/\bnot unpaid\b/i.test(s.text)) { isPaid = false; ev('unpaid', s); break; }
  }
  const salSrc = `${inp.salaryText ?? ''}\n${text}`;
  const amounts = [...salSrc.matchAll(/£\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?\b/g)].map((m) => {
    let v = Number(m[1].replace(/,/g, ''));
    if (m[2]) v *= 1000;
    return v;
  }).filter((v) => v >= 10000 && v <= 300000);
  if (amounts.length) {
    salary = { min: Math.min(...amounts.slice(0, 2)), max: Math.max(...amounts.slice(0, 2)) };
    if (isPaid !== false) isPaid = true;
    const s = sents.find((x) => /£\s?\d/.test(x.text));
    if (s) ev('salary', s);
  } else if (isPaid == null) {
    const s = sents.find((x) => /\b(competitive (salary|pay)|paid (internship|role|position)|salary|£\s?\d+(\.\d+)? ?(per|an|\/) ?hour|london living wage|stipend)\b/i.test(x.text));
    if (s) { isPaid = true; ev('paid_indicator', s, 'MEDIUM'); }
  }

  // ---------------------------------------------------------------- duration
  let programmeMonths: number | null = null;
  let contractMonths: number | null = null;
  for (const s of sents) {
    const t = s.text;
    const p = t.match(new RegExp(`\\b(${NUM_WORD_RE})[- ](year|month)s?[- ](?:long\\s+)?(?:[a-z-]+\\s+){0,3}?(programme|program|scheme|rotation(al)?)\\b`, 'i'))
      ?? t.match(new RegExp(`\\b(programme|program|scheme)\\b[^.]{0,40}\\b(lasts?|runs?|spans?|over|duration of|is)\\b[^.]{0,15}?\\b(${NUM_WORD_RE})[- ](year|month)s?`, 'i'));
    if (p && !/\bexperience\b/i.test(t.slice(Math.max(0, (p.index ?? 0) - 5), (p.index ?? 0) + p[0].length + 15))) {
      const numStr = /^(programme|program|scheme)$/i.test(p[1]) ? p[3] : p[1];
      const unit = /^(programme|program|scheme)$/i.test(p[1]) ? p[4] : p[2];
      const n = parseNum(numStr);
      if (n != null) {
        const months = /year/i.test(unit) ? n * 12 : n;
        if (programmeMonths == null || months > programmeMonths) { programmeMonths = months; ev('programme_length', s); }
      }
    }
    const c = t.match(new RegExp(`\\b(${NUM_WORD_RE})[- ]?(month|week)s?['’]?\\s*(?:[a-z-]+\\s+){0,3}?(internship|placement|contract|fixed[- ]term|ftc|assignment|role|position|secondment|off[- ]cycle|temporary)\\b`, 'i'))
      ?? t.match(new RegExp(`\\b(internship|placement|contract|fixed[- ]term|ftc|assignment|role|position)\\b[^.]{0,40}?\\b(?:of|for|lasting|lasts|duration)\\s+(?:approximately\\s+|around\\s+|up to\\s+)?(${NUM_WORD_RE})[- ]?(month|week)s?\\b`, 'i'));
    if (c) {
      const first = /^\d|^[a-z]+$/i.test(c[1]) && parseNum(c[1]) != null;
      const n = first ? parseNum(c[1]) : parseNum(c[2]);
      const unit = first ? c[2] : c[3];
      if (n != null) {
        const months = /week/i.test(unit) ? Math.round((n / 4.345) * 10) / 10 : n;
        if (months <= 48 && (contractMonths == null || months > contractMonths)) { contractMonths = months; ev('contract_length', s); }
      }
    }
  }

  // ---------------------------------------------------------------- dates
  let startDate: string | null = null;
  for (const s of sents) {
    if (!/\b(start(ing|s)?|commenc(e|ing|es))\b/i.test(s.text)) continue;
    const m = s.text.match(new RegExp(`\\b(\\d{1,2})?(?:st|nd|rd|th)?\\s*(${MONTHS})\\.?\\s+(20[2-3]\\d)\\b`, 'i'));
    if (m) { startDate = toIso(m[1], m[2], m[3]); ev('start_date', s); break; }
    if (/\b(asap|immediate(ly)?|as soon as possible)\b/i.test(s.text)) { ev('start_date_asap', s, 'MEDIUM'); }
  }
  let closingDate = inp.closingDate ?? null;
  if (!closingDate) {
    for (const s of sents) {
      if (!/\b(closing date|deadline|applications? close|close on|closes on|apply by)\b/i.test(s.text)) continue;
      const m = s.text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTHS})\\.?,?\\s+(20[2-3]\\d)\\b`, 'i'));
      if (m) { closingDate = toIso(m[1], m[2], m[3]); ev('closing_date', s); break; }
    }
  }

  // ---------------------------------------------------------------- legal employer hint (only if consistent with brand)
  let legalEmployer: string | null = inp.legalEmployerHint ?? null;
  if (!legalEmployer && inp.advertisedEmployer) {
    const brandTok = coreKey(inp.advertisedEmployer).split(' ')[0];
    const m = [...text.matchAll(/\b([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z(][A-Za-z0-9&.'’()-]*){0,5}\s+(?:Limited|Ltd\.?|PLC|plc|LLP))\b/g)];
    for (const x of m) {
      if (brandTok && coreKey(x[1]).startsWith(brandTok)) {
        legalEmployer = x[1].replace(/\.$/, '');
        const s = sents.find((q) => q.start <= (x.index ?? 0) && q.end >= (x.index ?? 0));
        if (s) ev('legal_employer', s, 'MEDIUM');
        break;
      }
    }
  }

  // ---------------------------------------------------------------- skills
  const { mandatorySkills, desirableSkills } = extractSkills(sents, headings);

  const category = classifyCategory(inp.title, text);
  const employmentType = classifyEmploymentType(inp.title, text);
  if (employmentType === 'FIXED_TERM' && contractMonths == null && programmeMonths == null) missing.push('Fixed-term role without a stated duration.');
  if (gvLang === 'NO_STATED_BLOCKER' && sponsor === 'SILENT') missing.push('The JD does not mention visas or sponsorship.');

  return {
    title: inp.title,
    advertisedEmployer: inp.advertisedEmployer,
    legalEmployer,
    location: inp.location,
    category,
    employmentType,
    isPaid,
    salaryGbp: salary,
    requiredExperienceYears: reqYears,
    experienceRequirement: expReq,
    currentStudentRequired,
    permittedGraduationYears: gradYears.size ? [...gradYears].sort() : null,
    contractMonths,
    programmeMonths,
    startDate,
    closingDate,
    graduateVisaLanguage: gvLang,
    sponsorPolicy: sponsor,
    noFutureSponsorshipStrict: strictFuture,
    permanentRightToWorkRequired: permanentRTW,
    BritishCitizenshipMandatory: britishMandatory,
    otherNationalityRestrictions: otherNat,
    ukResidencyRequirementYears: residencyYears,
    mandatoryClearances: [...mandatoryClearances],
    optionalClearances: [...optionalClearances],
    ambiguousVetting,
    backgroundChecks: [...backgroundChecks],
    isSeniorTitle: isSeniorTitle(inp.title),
    mandatorySkills,
    desirableSkills,
    applicationUrl: inp.applyUrl ?? null,
    evidence,
    missingOrAmbiguousFacts: [...new Set(missing)],
  };
}

function toIso(day: string | undefined, month: string, year: string): string {
  const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(month.slice(0, 3).toLowerCase());
  const d = day ? Number(day) : 1;
  return `${year}-${String(idx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const SKILL_LEXICON = [
  'SIEM', 'Splunk', 'Microsoft Sentinel', 'Sentinel', 'QRadar', 'Elastic', 'EDR', 'CrowdStrike', 'Defender', 'ISO 27001', 'ISO 27002',
  'NIST', 'SOC 2', 'PCI DSS', 'GDPR', 'DORA', 'Cyber Essentials', 'CIS Controls', 'Python', 'PowerShell', 'Bash', 'Linux', 'Windows',
  'Active Directory', 'Entra ID', 'Azure', 'AWS', 'GCP', 'Office 365', 'Microsoft 365', 'Intune', 'Jamf', 'ServiceNow', 'Jira', 'ITIL',
  'TCP/IP', 'DNS', 'firewalls', 'networking', 'VPN', 'incident response', 'threat intelligence', 'vulnerability management',
  'penetration testing', 'risk assessment', 'risk management', 'internal audit', 'IT audit', 'controls testing', 'third-party risk',
  'SQL', 'Excel', 'CompTIA', 'Security+', 'CISSP', 'CISM', 'CISA', 'CCNA', 'OSCP', 'MITRE ATT&CK', 'IAM', 'identity and access',
  'cloud security', 'OT security', 'ICS', 'forensics', 'malware analysis', 'troubleshooting', 'hardware', 'customer service',
];
function extractSkills(sents: Sentence[], headings: Heading[]) {
  const mand = new Set<string>(); const des = new Set<string>();
  for (const s of sents) {
    const sec = sectionOf(headings, s.start);
    const optional = OPTIONAL_CUE.test(s.text) || sec?.kind === 'DESIRABLE';
    for (const k of SKILL_LEXICON) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${k.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
      if (re.test(s.text)) (optional ? des : mand).add(k);
    }
  }
  for (const d of des) mand.delete(d);
  return { mandatorySkills: [...mand].slice(0, 25), desirableSkills: [...des].slice(0, 25) };
}
