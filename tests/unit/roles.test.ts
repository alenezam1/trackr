import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_FAMILIES, evaluateCustomRules, familyQueries, matchTargetRole } from '../../server/core/discovery/roles.js';

describe('target role families', () => {
  it('match by function with title variants', () => {
    expect(matchTargetRole('Junior SOC Analyst', DEFAULT_ROLE_FAMILIES)?.id).toBe('soc');
    expect(matchTargetRole('Technology Risk Graduate Programme', DEFAULT_ROLE_FAMILIES)?.id).toBe('risk');
    expect(matchTargetRole('IT Service Desk Analyst', DEFAULT_ROLE_FAMILIES)?.id).toBe('support');
    expect(matchTargetRole('Backend Software Engineer', DEFAULT_ROLE_FAMILIES)).toBeNull();
    expect(matchTargetRole('Security Officer (night shift)', DEFAULT_ROLE_FAMILIES)).toBeNull();
  });
  it('switching a family off removes it; custom families win', () => {
    const off = DEFAULT_ROLE_FAMILIES.map((f) => (f.id === 'support' ? { ...f, enabled: false } : f));
    expect(matchTargetRole('IT Support Analyst', off)).toBeNull();
    const custom = [...DEFAULT_ROLE_FAMILIES, { id: 'c1', label: 'Data Analyst', category: 'IT_TECHNICAL' as const, keywords: ['data analyst'], enabled: true, custom: true }];
    expect(matchTargetRole('Graduate Data Analyst', custom)?.id).toBe('c1');
    expect(familyQueries(custom)).toContain('data analyst');
  });
});

describe('custom restrictions', () => {
  const rule = (kind: any, terms: string[]) => ({ id: 'x', label: 'x', enabled: true, kind, terms, action: 'exclude' as const });
  const job = { title: 'IT Support Analyst', employer: 'Acme Ltd', text: 'You will join our on-call rota. A full UK driving licence is required.' };
  it('exclude_text quotes the matching sentence', () => {
    const h = evaluateCustomRules([rule('exclude_text', ['on-call'])], job);
    expect(h[0].quote).toContain('on-call rota');
  });
  it('require_text / exclude_title / exclude_employer', () => {
    expect(evaluateCustomRules([rule('require_text', ['hybrid'])], job)).toHaveLength(1);
    expect(evaluateCustomRules([rule('exclude_title', ['support'])], job)).toHaveLength(1);
    expect(evaluateCustomRules([rule('exclude_employer', ['acme'])], job)).toHaveLength(1);
    expect(evaluateCustomRules([{ ...rule('exclude_employer', ['acme']), enabled: false }], job)).toHaveLength(0);
  });
});
