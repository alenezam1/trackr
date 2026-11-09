import { describe, expect, it } from 'vitest';
import { evaluateGulf, marketOfLocation, matchGulfRole, nationalsOnly } from '../../server/core/gulf/markets.js';
import { extractRuleFacts } from '../../server/core/extraction/rules.js';
import { DEFAULT_ROLE_FAMILIES } from '../../server/core/discovery/roles.js';

const pad = ' Our security team protects customers across the region with modern tooling and training. '.repeat(6);
const run = (title: string, text: string, location = 'Dubai, United Arab Emirates', market: any = 'UAE', extra: any = {}) => {
  const t = text + pad;
  const facts = extractRuleFacts({ title, advertisedEmployer: 'Acme', location, text: t, sourceUrl: 'u' });
  return evaluateGulf({ market, title, location, text: t, hasFullJd: true, listingState: 'OPEN', deadline: null, facts, family: matchGulfRole(title, DEFAULT_ROLE_FAMILIES), today: '2026-10-15',
    postedAt: '2026-10-12', applyKind: 'EMPLOYER_SITE', ...extra });
};
const codes = (d: any) => d.reasons.filter((r: any) => r.severity !== 'advisory').map((r: any) => r.code);

describe('Gulf cyber titles & dates', () => {
  it('matches Gulf cyber titles broadly, not physical security or finance risk', () => {
    for (const t of ['SOC L1 Analyst', 'Information Security Officer', 'Cybersecurity Specialist', 'IAM Engineer', 'Junior Penetration Tester', 'GRC Specialist - ISO 27001', 'IT Security Graduate Trainee'])
      expect(matchGulfRole(t, DEFAULT_ROLE_FAMILIES), t).not.toBeNull();
    for (const t of ['Security Guard', 'Security Officer', 'Credit Risk Analyst', 'Sales Executive', 'Internal Auditor (Finance)'])
      expect(matchGulfRole(t, DEFAULT_ROLE_FAMILIES), t).toBeNull();
  });
  it('parses posting dates', async () => {
    const { parsePostedDate } = await import('../../server/core/util/text.js');
    const now = new Date('2026-10-16T12:00:00Z');
    expect(parsePostedDate('3 days ago', now)).toBe('2026-10-13');
    expect(parsePostedDate('a month ago', now)).toBe('2026-09-16');
    expect(parsePostedDate('30+ days ago', now)).toBe('2026-09-16');
    expect(parsePostedDate('2026-10-01T09:00:00Z', now)).toBe('2026-10-01');
    expect(parsePostedDate('Just posted', now)).toBe('2026-10-16');
  });
});

describe('Gulf markets', () => {
  it('detects countries from locations', () => {
    expect(marketOfLocation('Dubai - United Arab Emirates')).toBe('UAE');
    expect(marketOfLocation('Doha, Qatar')).toBe('QATAR');
    expect(marketOfLocation('Riyadh, KSA')).toBe('SAUDI');
    expect(marketOfLocation('London, UK')).toBeNull();
  });
  it('nationals-only vs preferred vs encouraged', () => {
    expect(nationalsOnly('This role is open to UAE Nationals only.', 'UAE')?.strict).toBe(true);
    expect(nationalsOnly('This is an Emiratisation role.', 'UAE')?.strict).toBe(true);
    expect(nationalsOnly('UAE nationals are preferred.', 'UAE')?.strict).toBe(false);
    expect(nationalsOnly('We follow National Cyber Security standards as required by law.', 'UAE')).toBeNull();
    expect(nationalsOnly('Saudisation role for Saudi nationals only.', 'SAUDI')?.strict).toBe(true);
    expect(nationalsOnly('Qatari nationals only.', 'QATAR')?.strict).toBe(true);
  });
  it('spec scoring: graduate SOC role, 0-1 yrs, careers site, posted this week → eligible (score ≥ 60)', () => {
    expect(run('SOC Analyst - Graduate', 'Fresh graduates welcome. 0-1 years of experience in security monitoring.').status).toBe('POTENTIAL_NO_STATED_BLOCKER');
  });
  it('spec scoring: lower scores and missing dates go to review, not eligible', () => {
    expect(run('Junior SOC Analyst', '0-1 years of experience in security monitoring.', undefined, undefined, { applyKind: 'BOARD', postedAt: '2026-09-25' }).status).toBe('NEEDS_REVIEW');
    expect(codes(run('SOC Analyst - Graduate', 'Fresh graduates welcome.', undefined, undefined, { postedAt: null }))).toContain('POSTED_DATE_UNKNOWN');
    expect(codes(run('Security Analyst', 'Monitor alerts.'))).toContain('EXPERIENCE_NOT_STATED');
  });
  it('excludes nationals-only, >1 year experience, senior, non-cyber, wrong country', () => {
    expect(codes(run('SOC Analyst', 'This position is for UAE Nationals only.'))).toContain('OTHER_NATIONALITY_RESTRICTION');
    expect(codes(run('GRC Analyst', 'Minimum 3 years of experience in GRC is required.'))).toContain('EXPERIENCE_EXCEEDS_ENTRY_LEVEL');
    expect(run('GRC Analyst', 'Minimum 3 years of experience in GRC is required.').status).toBe('EXCLUDED');
    expect(run('SOC Analyst L2', 'Entry level.').status).toBe('EXCLUDED');
    expect(run('Security Analyst - Qatari National', 'Entry level.', 'Doha, Qatar', 'QATAR').status).toBe('EXCLUDED');
    expect(codes(run('Senior Security Engineer', 'Lead our team.'))).toContain('SENIOR_JOB');
    expect(codes(run('Sales Executive', 'Sell our products.'))).toContain('OUT_OF_SCOPE_ROLE');
    expect(codes(run('SOC Analyst', 'Entry level.', 'Doha, Qatar', 'UAE'))).toContain('LOCATION_OUT_OF_SCOPE');
  });
  it('title says nationals only / other country / sales → excluded', () => {
    expect(run('Information Security Analyst (UAE National)', 'Graduates welcome.').status).toBe('EXCLUDED');
    expect(run('Senior Analyst - OT Cybersecurity (UAEN)', 'Entry level.').status).toBe('EXCLUDED');
    expect(run('SOC Analyst L1 - Cairo, Egypt', 'Entry level.', null as any).status).toBe('EXCLUDED');
    expect(matchGulfRole('Cloud & Cloud Security Sales Executive (B2B)', DEFAULT_ROLE_FAMILIES)).toBeNull();
    expect(matchGulfRole('Cybersecurity Presales Engineer', DEFAULT_ROLE_FAMILIES)).toBeNull();
  });
});
