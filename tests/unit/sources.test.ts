import { describe, expect, it } from 'vitest';
import { parseAtsUrl } from '../../server/core/sources/ats.js';
import { parseGradcrackerListing } from '../../server/core/sources/gradcracker.js';
import { parseResultTitle } from '../../server/core/sources/apis.js';

describe('ATS URL recognition', () => {
  it('recognises all public ATS hosts', () => {
    expect(parseAtsUrl('https://boards.greenhouse.io/monzo/jobs/123')).toEqual({ ats: 'greenhouse', token: 'monzo', jobId: '123' });
    expect(parseAtsUrl('https://jobs.lever.co/zopa/abc-def')).toEqual({ ats: 'lever', token: 'zopa', jobId: 'abc-def' });
    expect(parseAtsUrl('https://jobs.ashbyhq.com/faculty/xyz')).toEqual({ ats: 'ashby', token: 'faculty', jobId: 'xyz' });
    expect(parseAtsUrl('https://bunq.recruitee.com/o/product-owner')).toEqual({ ats: 'recruitee', token: 'bunq', jobId: 'product-owner' });
    expect(parseAtsUrl('https://acme.jobs.personio.de/job/1834171')).toEqual({ ats: 'personio', token: 'acme', jobId: '1834171' });
    expect(parseAtsUrl('https://acme.teamtailor.com/jobs/555-it-support')).toEqual({ ats: 'teamtailor', token: 'acme', jobId: '555-it-support' });
    expect(parseAtsUrl('https://apply.workable.com/acme/j/ABC123/')).toEqual({ ats: 'workable', token: 'acme', jobId: 'ABC123' });
    expect(parseAtsUrl('https://www.linkedin.com/jobs/view/1')).toBeNull();
  });
});

describe('board parsers', () => {
  it('Gradcracker listing keeps only job links', () => {
    const html = `<a href="https://www.gradcracker.com/hub/89/cgi/graduate-job/85474/technical-graduate-cyber-security-2027">Technical Graduate - Cyber</a>
      <a href="https://www.gradcracker.com/hub/89/cgi">CGI</a><a href="/hub/9000001/featured-graduate-employer/graduate-job/1/x">ad</a>`;
    const r = parseGradcrackerListing(html);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Technical Graduate - Cyber');
  });
  it('search result titles', () => {
    expect(parseResultTitle('Acme hiring SOC Analyst in London | LinkedIn', 'linkedin')).toEqual({ employer: 'Acme', title: 'SOC Analyst', location: 'London' });
    expect(parseResultTitle('Cyber Security Analyst - Help AG - Dubai | Bayt.com', 'bayt')).toEqual({ title: 'Cyber Security Analyst', employer: 'Help AG', location: 'Dubai' });
    expect(parseResultTitle('SOC Analyst at CPX | Glassdoor', 'glassdoor')).toEqual({ title: 'SOC Analyst', employer: 'CPX', location: null });
    expect(parseResultTitle('Information Security Analyst | Job in Dubai, UAE by Al Futtaim | GulfTalent', 'gulftalent')).toEqual({ title: 'Information Security Analyst', location: 'Dubai, UAE', employer: 'Al Futtaim' });
  });
  it('Gulf search plan: short site: queries across boards, roles and cities', async () => {
    const { siteQueries } = await import('../../server/core/sources/websearch.js');
    const plan = siteQueries({ market: 'UAE', roleQueries: [], keywords: [], categories: [] } as any);
    expect(plan.length).toBeGreaterThan(100);
    const sited = plan.filter((p) => p.domains.length === 1);
    expect(plan.every((p) => p.q.length < 220)).toBe(true);
    expect(new Set(sited.slice(0, 21).map((p) => p.domains[0])).size).toBe(21); // first round covers every site
    expect(sited.every((p) => /junior OR graduate OR intern/.test(p.q))).toBe(true); // spec: every search has entry-level terms
    expect(plan.some((p) => p.domains.length === 0 && /fresh graduate/.test(p.q))).toBe(true); // open-web template
    expect(plan.some((p) => /Abu Dhabi/.test(p.q))).toBe(true);
    expect(plan.find((p) => p.domains[0].startsWith('bayt.com/en/uae'))!.q).not.toMatch(/Dubai|UAE/); // country-scoped: no city needed
    expect(plan.some((p) => / OR /.test(p.q))).toBe(true); // role groups
  });
});
