// Date-aware work-permission model (spec §2). Never invents a grant; distinguishes confirmed vs estimated.
import type { Profile } from '../models.js';
import type { AppSettings } from '../../config/settings.js';
import { addMonths, daysBetween, todayLondon } from '../util/text.js';

export interface PermissionView {
  currentRightToWork: 'CONFIRMED' | 'PENDING' | 'UNKNOWN' | 'NOT_AVAILABLE';
  confirmedExpiry: string | null;   // only from a user-confirmed grant
  estimatedExpiry: string | null;   // planning estimate; NEVER treated as confirmed
  estimateBasis: string;
  graduateMonths: number | null;
  rulesStale: boolean;
  rulesNote: string;
}

export function graduateVisaMonths(applicationDate: string, rules: AppSettings['graduate_visa_rules']): number | null {
  for (const p of rules.periods) {
    const okBefore = p.applied_on_or_before ? applicationDate <= p.applied_on_or_before : true;
    const okAfter = p.applied_on_or_after ? applicationDate >= p.applied_on_or_after : true;
    if (okBefore && okAfter) return p.months;
  }
  return null;
}

export function permissionView(profile: Profile, settings: AppSettings, today = todayLondon()): PermissionView {
  const rules = settings.graduate_visa_rules;
  const rulesAge = daysBetween(rules.last_verified_at, today);
  const rulesStale = rulesAge > rules.stale_after_days;
  const rulesNote = `Graduate visa duration rule ${rules.rule_version} (source ${rules.source}, verified ${rules.last_verified_at}${rulesStale ? ' — STALE, re-verify on GOV.UK' : ''}).`;

  let current: PermissionView['currentRightToWork'] = 'UNKNOWN';
  let confirmedExpiry: string | null = null;
  let estimatedExpiry: string | null = null;
  let basis = '';
  let months: number | null = null;

  switch (profile.uk_visa_status) {
    case 'graduate_granted':
    case 'skilled_worker':
      confirmedExpiry = profile.work_permission_evidence_checked ? profile.graduate_visa_expiry_date : null;
      current = profile.work_permission_evidence_checked && profile.graduate_visa_expiry_date ? 'CONFIRMED' : 'UNKNOWN';
      basis = confirmedExpiry ? `Confirmed permission until ${confirmedExpiry}.` : 'Grant recorded but expiry/evidence not confirmed in Settings.';
      if (!confirmedExpiry && profile.graduate_visa_expiry_date) estimatedExpiry = profile.graduate_visa_expiry_date;
      break;
    case 'graduate_applied': {
      current = 'PENDING';
      const appDate = profile.graduate_application_date;
      if (appDate) {
        months = graduateVisaMonths(appDate, rules);
        if (months) { estimatedExpiry = addMonths(today > appDate ? today : appDate, months); basis = `Estimate: ${months} months from approval (applied ${appDate}); approval date unknown, so estimated from today.`; }
      } else basis = 'Graduate application recorded without a date.';
      break;
    }
    case 'graduate_planned': {
      current = 'PENDING';
      months = graduateVisaMonths(today, rules);
      if (months) { estimatedExpiry = addMonths(today, months); basis = `Planning estimate only: a Graduate application made today would give ${months} months from approval. Not a grant.`; }
      break;
    }
    case 'student':
      current = 'UNKNOWN';
      basis = 'Student permission: work hours/start dates are restricted; each role needs review.';
      break;
    default:
      basis = 'Visa status "other": confirm work permission manually.';
  }
  return { currentRightToWork: current, confirmedExpiry, estimatedExpiry, estimateBasis: basis, graduateMonths: months, rulesStale, rulesNote };
}
