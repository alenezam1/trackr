// Fit scoring (spec §13.1). Only computed for jobs that are not EXCLUDED/STALE. Explanations are
// grounded in the JD text and the profile's own listed facts — nothing is invented.
import type { Decision, ExtractedJobFacts, Profile, SponsorMatch } from '../models.js';
import { classifyLocation } from '../extraction/classify.js';
import { daysBetween, todayLondon } from '../util/text.js';

export interface FitResult {
  total: number;
  components: { cv: number; internship: number; visa: number; recency: number; preference: number; evidence: number };
  whyItFits: string[];
  gaps: string[];
}

export function scoreJob(input: {
  facts: ExtractedJobFacts; decision: Decision; sponsor: SponsorMatch; profile: Profile; jdText: string;
  location: string | null; postedAt: string | null; applyUrlKind: string | null; hasFullJd: boolean; feedbackBoost?: number;
}): FitResult | null {
  const { facts: f, decision: d, profile: p } = input;
  if (d.status === 'EXCLUDED' || d.status === 'STALE') return null;
  const jd = input.jdText.toLowerCase();
  const why: string[] = [];
  const gaps: string[] = [];

  // CV / skills / education (30)
  const hits = p.skills.filter((s) => s.length > 2 && new RegExp(`(^|[^a-z0-9])${s.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(jd));
  let cv = Math.min(22, hits.length * 3);
  if (hits.length) why.push(`JD mentions ${hits.slice(0, 5).join(', ')} — listed in your skills profile.`);
  if (/\b(computer science|information security|cyber ?security degree|stem degree|relevant degree|degree in)\b/.test(jd)) { cv += 5; why.push('Degree requirement fits your MSc Information Security / BSc Computer Science.'); }
  if (/\b(ot|operational technology|ics|scada)\b/.test(jd) && p.experience.some((e) => /\bOT\b/.test(e))) { cv += 3; why.push('OT/ICS content matches your EQUATE OT/cyber internship.'); }
  const missingMand = f.mandatorySkills.filter((m) => !p.skills.some((s) => s.toLowerCase() === m.toLowerCase()) && !p.certifications_in_progress.some((c) => c.toLowerCase().includes(m.toLowerCase())));
  if (missingMand.length) gaps.push(`Listed requirements not in your profile: ${missingMand.slice(0, 5).join(', ')}.`);
  const certMention = p.certifications_in_progress.filter((c) => jd.includes(c.split(' ')[1]?.toLowerCase() ?? '@@'));
  if (certMention.length) why.push(`Relevant certification in progress (not yet achieved): ${certMention.join(', ')}.`);
  cv = Math.min(30, cv);

  // Internship / graduate suitability (25)
  const typeScore: Record<string, number> = { OFF_CYCLE_INTERNSHIP: 25, INTERNSHIP: 22, FIXED_TERM: 18, GRADUATE_PROGRAMME: 14, PERMANENT: 11, UNKNOWN: 9 };
  let intern = typeScore[f.employmentType] ?? 9;
  if (f.employmentType === 'FIXED_TERM' && f.contractMonths != null && f.contractMonths > 12) intern -= 4;
  if (/\b(junior|graduate|entry|trainee|associate|intern|level 1)\b/i.test(f.title ?? '')) intern = Math.min(25, intern + 3);
  if (f.requiredExperienceYears != null && f.requiredExperienceYears > 0 && f.experienceRequirement === 'MANDATORY') { intern -= Math.min(6, f.requiredExperienceYears * 2); gaps.push(`Asks for ${f.requiredExperienceYears} year(s) experience — use internship evidence.`); }
  intern = Math.max(0, intern);
  if (f.employmentType === 'OFF_CYCLE_INTERNSHIP') why.push('Off-cycle internship — your top-priority format.');

  // Visa / timeline (20)
  let visa = d.matrix.role_accepts_graduate_visa === 'EXPLICIT_YES' ? 20 : d.matrix.vacancy_offers_sponsorship === 'EXPLICIT_YES' ? 18 : d.matrix.role_accepts_graduate_visa === 'NO_STATED_BLOCKER' ? 10 : 5;
  if (d.matrix.vacancy_offers_sponsorship === 'EXPLICIT_NO') visa = Math.max(3, visa - 5);
  if (d.matrix.duration_feasibility === 'WITHIN_CONFIRMED_PERMISSION') visa = Math.min(20, visa + 3);
  if (f.contractMonths != null && p.prefer_contract_months.includes(Math.round(f.contractMonths))) visa = Math.min(20, visa + 2);

  // Recency + link quality (10)
  let recency = 0;
  if (input.postedAt) {
    const age = daysBetween(input.postedAt.slice(0, 10), todayLondon());
    recency += age <= 7 ? 5 : age <= 30 ? 3 : age <= 60 ? 1 : 0;
  } else recency += 1;
  recency += input.applyUrlKind === 'EMPLOYER_ATS' ? 5 : input.applyUrlKind === 'EMPLOYER_SITE' ? 4 : 2;

  // Preference: category + location (10)
  const loc = classifyLocation(input.location);
  let pref = loc === 'LONDON' ? 5 : loc === 'UK_REMOTE' ? 4 : loc === 'UK' ? 3 : 1;
  pref += f.category === 'SOC_SECURITY' || f.category === 'GRC_RISK_AUDIT' ? 5 : f.category === 'IT_TECHNICAL' ? 4 : 0;
  if (loc === 'LONDON') why.push('London-based.');

  // Evidence quality (5)
  let evq = 0;
  if (input.sponsor.status === 'VERIFIED_EXACT' || input.sponsor.status === 'VERIFIED_ALIAS') evq += 3;
  if (input.hasFullJd) evq += 2;

  const total = Math.max(0, Math.min(100, Math.round(cv + intern + visa + recency + pref + evq + (input.feedbackBoost ?? 0))));
  return { total, components: { cv, internship: intern, visa, recency, preference: pref, evidence: evq }, whyItFits: why, gaps };
}

export function priorityBucket(employmentType: string | null, contractMonths: number | null): number {
  switch (employmentType) {
    case 'OFF_CYCLE_INTERNSHIP': return 0;
    case 'INTERNSHIP': return 1;
    case 'FIXED_TERM': return contractMonths != null && contractMonths <= 12 ? 2 : 3;
    case 'PERMANENT': case 'UNKNOWN': return 3;
    case 'GRADUATE_PROGRAMME': return 4;
    default: return 3;
  }
}
