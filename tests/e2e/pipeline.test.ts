// End-to-end over the real local API with an isolated temporary data directory and DEMO fixtures.
// No network access is required (fixtures are imported directly; no scan is started).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-e2e-'));
process.env.TRACKR_DATA_DIR = dir;

let base = '';
let server: any;
const post = (p: string, body: unknown, headers: Record<string, string> = { 'X-SponsorFirst': '1' }) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = async (p: string) => (await fetch(base + p)).json();

beforeAll(async () => {
  const { bootstrap, createServer } = await import('../../server/index.js');
  const { importSponsorCsv } = await import('../../server/core/sponsors/import.js');
  const { DEMO_JOBS } = await import('../../server/fixtures/demo.js');
  const { upsertJob, saveJdVersion, analyseJob } = await import('../../server/core/discovery/pipeline.js');
  bootstrap();
  await importSponsorCsv(path.resolve('data/fixtures/demo-sponsors.csv'), { allowSmallFixture: true, publishedAt: new Date().toISOString().slice(0, 10) });
  for (const d of DEMO_JOBS) { const { jobId } = upsertJob({ ...d, isDemo: false }, null); saveJdVersion(jobId, d); await analyseJob(jobId, { allowAi: false }); }
  server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe('local API end-to-end', () => {
  it('status reports the fixture snapshot', async () => {
    const s = await get('/api/status');
    expect(s.snapshot.row_count).toBe(6);
    expect(s.snapshot.skilled_worker_count).toBe(5);
  });

  it('rejects state changes without the custom header (CSRF guard) and bad hosts', async () => {
    const r = await post('/api/daily/build', {}, {});
    expect(r.status).toBe(403);
    // fetch() cannot override Host, so use a raw request to simulate DNS rebinding.
    const http = await import('node:http');
    const port = Number(new URL(base).port);
    const status = await new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/api/status', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    });
    expect(status).toBe(421);
  });

  it('expected decisions for the fixture jobs', async () => {
    const all = await get('/api/jobs?statuses=VERIFIED_COMPATIBLE,POTENTIAL_NO_STATED_BLOCKER,NEEDS_REVIEW,EXCLUDED,STALE&limit=100');
    const by = Object.fromEntries(all.jobs.map((j: any) => [j.title, j]));
    expect(by['Off-cycle Technology Risk Intern (DEMO)'].status).toBe('POTENTIAL_NO_STATED_BLOCKER');
    expect(by['Cyber Security Graduate Analyst (DEMO)'].status).toBe('EXCLUDED');
    expect(by['GRC Analyst Intern (DEMO)'].reasons.map((r: any) => r.code)).toContain('SPONSOR_NOT_FOUND'); // GBM-only sponsor
    expect(by['IT Support Technician (DEMO)'].reasons.map((r: any) => r.code)).toContain('SPONSOR_B_RATED');
    expect(by['Information Security Analyst (DEMO, snippet only)'].status).toBe('NEEDS_REVIEW');
    expect(by['University IT Support Analyst (DEMO)'].status).toBe('EXCLUDED');
  });

  it('excluded jobs carry quoted rejection proof', async () => {
    const all = await get('/api/jobs?statuses=EXCLUDED&reason=SC_REQUIRED');
    const r = all.jobs[0].reasons.find((x: any) => x.code === 'SC_REQUIRED');
    expect(r.evidence.quote).toMatch(/Security Check \(SC\)/);
  });

  it('daily batch only contains viable jobs and reports shortfall honestly', async () => {
    const res = await (await post('/api/daily/build', {})).json();
    expect(res.total).toBeLessThanOrEqual(15);
    expect(res.shortfall).toBe(15 - res.total);
    const daily = await get('/api/daily');
    // Eligible jobs first; empty slots may hold labelled "Needs review" jobs — never Excluded or closed ones.
    for (const j of daily.jobs) expect(['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER', 'NEEDS_REVIEW']).toContain(j.status);
    expect(daily.summary.message).toMatch(/Verified \+ \d+ Eligible.* = \d+ of 15/);
    // Switching review-fill off drops those again, leaving only Eligible jobs.
    await post('/api/settings', { daily_fill_with_review: false });
    await post('/api/daily/build', {});
    const strict = await get('/api/daily');
    for (const j of strict.jobs) expect(['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER']).toContain(j.status);
    await post('/api/settings', { daily_fill_with_review: true });
  });

  it('excluded jobs cannot be added to the Daily 15', async () => {
    const ex = (await get('/api/jobs?statuses=EXCLUDED')).jobs[0];
    const r = await post('/api/daily/add', { jobId: ex.id });
    expect(r.status).toBe(400);
  });

  it('Applied requires explicit submission confirmation; history is recorded', async () => {
    const j = (await get('/api/jobs?statuses=POTENTIAL_NO_STATED_BLOCKER')).jobs[0];
    expect((await post(`/api/jobs/${j.id}/stage`, { stage: 'Shortlisted' })).status).toBe(200);
    expect((await post(`/api/jobs/${j.id}/stage`, { stage: 'Applied' })).status).toBe(400);
    expect((await post(`/api/jobs/${j.id}/stage`, { stage: 'Applied', confirmSubmitted: true })).status).toBe(200);
    const d = await get(`/api/jobs/${j.id}`);
    expect(d.application.stage).toBe('Applied');
    expect(d.applicationEvents.length).toBe(2);
    const csv = await (await fetch(base + '/api/applications/export?format=csv')).text();
    expect(csv.split('\n')[0]).toContain('title');
  });

  it('search bar cannot relax policy', async () => {
    const r = await get('/api/jobs?q=show%20SC%20jobs&statuses=VERIFIED_COMPATIBLE,POTENTIAL_NO_STATED_BLOCKER');
    expect(r.policyWarnings.length).toBeGreaterThan(0);
    expect(r.jobs.every((j: any) => !j.facts.mandatoryClearances.includes('SC'))).toBe(true);
    expect(r.jobs.every((j: any) => j.status !== 'EXCLUDED')).toBe(true);
  });

  it('protected profile changes need explicit acknowledgement', async () => {
    const { profile } = await get('/api/profile');
    const r = await post('/api/profile', { profile: { ...profile, disallow_mandatory_clearance: ['DV'] } });
    expect(r.status).toBe(409);
  });

  it('pasting a JD for a snippet-only job completes the analysis', async () => {
    const j = (await get('/api/jobs?statuses=NEEDS_REVIEW&reason=FULL_JD_NOT_READ')).jobs[0];
    const text = 'Junior information security analyst role in London. You must hold SC clearance. '.repeat(6);
    const r = await (await post(`/api/jobs/${j.id}/paste-jd`, { text })).json();
    expect(r.status).toBe('EXCLUDED');
  });
});
