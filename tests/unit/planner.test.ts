import { describe, expect, it, vi, beforeEach } from 'vitest';

// Simulated OpenAI: the first call proposes test searches, later calls return a plan that favours what scored well.
const calls: string[] = [];
vi.mock('../../server/core/ai/client.js', () => ({
  chatJson: vi.fn(async (task: string, _sys: string, user: string) => {
    calls.push(`${task}\n${user}`);
    if (task === 'ai_search_propose') {
      return { ok: true, data: { insights: ['Testing boards and careers sites'], queries: [
        { q: '"SOC analyst" Dubai', site: 'linkedin.com/jobs/view', pages: 1, why: 'volume' },
        { q: 'site:bayt.com/en/uae/jobs "cyber security" graduate', site: '', pages: 1, why: 'site in query is moved to site' },
        { q: '"security analyst" junior', site: 'gulftalent.com/uae/jobs', pages: 1, why: 'gulf board' },
        { q: '"cyber security intern" Dubai', site: 'made-up-board.com', pages: 1, why: 'not in catalog → dropped' },
        { q: '"SOC analyst" Dubai', site: 'linkedin.com/jobs/view', pages: 1, why: 'duplicate → dropped' },
        { q: '"cyber security" graduate UAE', site: '', pages: 1, why: 'open web' },
      ] } };
    }
    return { ok: true, data: { insights: ['Bayt is hot, LinkedIn returns closed jobs'], queries: [
      { q: '"SOC analyst" OR "security analyst"', site: 'bayt.com/en/uae/jobs', pages: 2, why: 'winner' },
      { q: '"information security" graduate', site: 'bayt.com/en/uae/jobs', pages: 1, why: 'variant of winner' },
      { q: '"GRC analyst" Dubai', site: 'gulftalent.com/uae/jobs', pages: 1, why: 'exploration' },
    ] } };
  }),
}));
vi.mock('../../server/db/db.js', () => ({ getDb: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0, lastInsertRowid: 0 }) }) }));
vi.mock('../../server/config/settings.js', () => ({
  getSettings: () => ({ ai_search_probe_size: 4, ai_search_replans: 1, max_posting_age_days: 30 }),
  getProfile: () => ({ profile: { target_roles: [{ id: 'soc', label: 'SOC / security operations', enabled: true, keywords: ['soc analyst'] }] } }),
}));

describe('AI-steered search', () => {
  beforeEach(() => { calls.length = 0; });
  it('proposes, probes, then runs a plan built from the scored probe — within budget', async () => {
    const { runAiPlannedSearch } = await import('../../server/core/ai/searchPlanner.js');
    const ran: Array<{ q: string; site: string; page?: number }> = [];
    let used = 0;
    const exec = async (q: string, domains: string[], page?: number) => {
      used++; ran.push({ q, site: domains[0] ?? '', page });
      const hot = (domains[0] ?? '').startsWith('bayt');
      return { q, site: domains[0] ?? 'any site', page: page ?? 1, ok: true, results: hot ? 10 : 2, kept: hot ? 8 : 1, relevant: hot ? 6 : 0, fresh: hot ? 5 : 0, titles: ['SOC Analyst'], dropped: {} };
    };
    const sites = [{ site: 'linkedin.com/jobs/view', note: '' }, { site: 'bayt.com/en/uae/jobs', note: '' }, { site: 'gulftalent.com/uae/jobs', note: '' }, { site: '', note: 'open web' }];
    const log = vi.fn();
    const r = await runAiPlannedSearch({ intent: { market: 'UAE', keywords: [], roleFocus: 'BOTH' } as any, ctx: { runId: 1, shouldStop: () => false, budget: { queriesLeft: 99 }, log }, budget: 10,
      exec, usedSoFar: () => used, fallback: () => [], sites });
    expect(r.ok).toBe(true);
    expect(used).toBeLessThanOrEqual(10);
    // Probe: sanitised (site: moved out of the query, unknown site and duplicate dropped).
    expect(ran.slice(0, 4).map((x) => x.site)).toEqual(['linkedin.com/jobs/view', 'bayt.com/en/uae/jobs', 'gulftalent.com/uae/jobs', '']);
    expect(ran.some((x) => x.site === 'made-up-board.com')).toBe(false);
    // The planning call received the measured probe scores.
    const planCall = calls.find((c) => c.startsWith('ai_search_plan'))!;
    expect(planCall).toMatch(/bayt\.com\/en\/uae\/jobs: \d+ searches → \d+ results, \d+ postings, \d+ on-target/);
    // The winner was searched, including its next page.
    expect(ran.some((x) => x.site === 'bayt.com/en/uae/jobs' && x.page === 2)).toBe(true);
    expect(log.mock.calls.some((c) => c[0] === 'AI' && /Bayt is hot/.test(c[1]))).toBe(true);
  });
  it('reports failure so the scan falls back to the standard plan', async () => {
    const client = await import('../../server/core/ai/client.js');
    (client.chatJson as any).mockResolvedValueOnce({ ok: false, error: 'OpenAI HTTP 401' });
    const { runAiPlannedSearch } = await import('../../server/core/ai/searchPlanner.js');
    const r = await runAiPlannedSearch({ intent: { keywords: [] } as any, ctx: { runId: 1, shouldStop: () => false, budget: { queriesLeft: 9 }, log: () => {} }, budget: 5,
      exec: async () => null, usedSoFar: () => 0, fallback: () => [], sites: [] });
    expect(r).toEqual({ ok: false, error: 'OpenAI HTTP 401' });
  });
});
