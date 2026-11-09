import { describe, expect, it, vi, beforeEach } from 'vitest';

// Simulated HTTP + keys: checks the requests we send to DataForSEO / Jina and how their replies are read.
const sent: Array<{ url: string; o: any }> = [];
let reply: { ok: boolean; status: number; text: string; error?: string } = { ok: true, status: 200, text: '{}' };
vi.mock('../../server/core/sources/http.js', () => ({ politeFetch: vi.fn(async (url: string, o: any) => { sent.push({ url, o }); return { url, contentType: 'application/json', ...reply }; }) }));
vi.mock('../../server/config/secrets.js', () => ({ getSecret: async (n: string) => `secret-${n}`, hasSecret: () => true, redact: (s: string) => s }));
vi.mock('../../server/config/settings.js', () => ({
  getSettings: () => ({ max_posting_age_days: 30, search_providers: ['dataforseo', 'jina'], searxng_url: '' }),
  getProfile: () => ({ profile: { target_roles: [] } }),
}));
vi.mock('../../server/db/db.js', () => ({ getDb: () => ({ all: () => [], get: () => undefined, run: () => ({}) }) }));

describe('DataForSEO search', () => {
  beforeEach(() => { sent.length = 0; });
  it('sends a Google search with site filter, country and past-month filter, and reads organic results', async () => {
    const { runSearchProvider } = await import('../../server/core/sources/websearch.js');
    reply = { ok: true, status: 200, text: JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [
      { type: 'organic', rank_absolute: 1, url: 'https://www.bayt.com/en/uae/jobs/soc-analyst-74590560/', title: 'SOC Analyst - Acme - Dubai', description: '3 days ago — Monitor alerts…' },
      { type: 'people_also_ask', url: 'https://x' },
    ] }] }] }) };
    const r = await runSearchProvider('dataforseo', '"SOC analyst"', ['bayt.com/en/uae/jobs'], { country: 'ae' });
    expect(r.ok).toBe(true);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].date).toBe('3 days ago');
    const body = JSON.parse(sent[0].o.body)[0];
    expect(sent[0].url).toContain('/v3/serp/google/organic/live/advanced');
    expect(sent[0].o.headers.Authorization).toBe(`Basic ${Buffer.from('secret-dataforseo_login:secret-dataforseo_password').toString('base64')}`);
    expect(body).toMatchObject({ keyword: 'site:bayt.com/en/uae/jobs "SOC analyst"', location_name: 'United Arab Emirates', depth: 10, search_param: '&tbs=qdr:m' });
  });
  it('reports "no credit" so the scan switches provider and alerts you', async () => {
    const { runSearchProvider } = await import('../../server/core/sources/websearch.js');
    reply = { ok: true, status: 200, text: JSON.stringify({ status_code: 20000, tasks: [{ status_code: 40200, status_message: 'Payment Required.' }] }) };
    const r = await runSearchProvider('dataforseo', 'x', []);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/credit/);
  });
});

describe('Jina', () => {
  beforeEach(() => { sent.length = 0; });
  it('search: site filter in the query, results without page content (cheapest)', async () => {
    const { runSearchProvider } = await import('../../server/core/sources/websearch.js');
    reply = { ok: true, status: 200, text: JSON.stringify({ code: 200, data: [{ title: 'Junior SOC Analyst', url: 'https://www.linkedin.com/jobs/view/4480160706', description: 'Dubai…' }] }) };
    const r = await runSearchProvider('jina', '"SOC analyst" Dubai', ['linkedin.com/jobs/view'], { country: 'ae' });
    expect(r.ok && r.hits[0].url).toBe('https://www.linkedin.com/jobs/view/4480160706');
    expect(new URL(sent[0].url).searchParams.get('q')).toBe('site:linkedin.com/jobs/view "SOC analyst" Dubai');
    expect(new URL(sent[0].url).searchParams.get('gl')).toBe('ae');
    expect(sent[0].o.headers['X-Respond-With']).toBe('no-content');
  });
  it('reader: live posting is read; a 404 posting counts as closed', async () => {
    const { readBoardPosting } = await import('../../server/core/sources/websearch.js');
    const jd = 'Junior SOC Analyst\nAcme · Dubai · Posted 2 days ago\nResponsibilities: monitor alerts and triage incidents. ' + 'Requirements: 0-1 years experience in security operations. '.repeat(15);
    reply = { ok: true, status: 200, text: JSON.stringify({ code: 200, data: { title: 'Junior SOC Analyst', content: jd, links: { 'Apply on company website': 'https://careers.acme.com/job/123' } } }) };
    const live = await readBoardPosting('https://www.linkedin.com/jobs/view/4480160706');
    expect(live.ok && !live.expired).toBe(true);
    expect(live.postedAt).not.toBeNull();
    expect(live.employerLinks).toContain('https://careers.acme.com/job/123');
    expect(sent[0].url).toBe('https://r.jina.ai/https://www.linkedin.com/jobs/view/4480160706');
    reply = { ok: false, status: 422, text: JSON.stringify({ readableMessage: 'Target URL returned error 404: Not Found' }) };
    const gone = await readBoardPosting('https://www.bayt.com/en/uae/jobs/old-1234567/');
    expect(gone.expired).toBe(true);
  });
});
