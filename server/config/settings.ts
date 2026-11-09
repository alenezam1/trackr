import { z } from 'zod';
import { getDb, j } from '../db/db.js';
import { ProfileSchema, type Profile } from '../core/models.js';
import { hasSecret } from './secrets.js';

export const AppSettingsSchema = z.object({
  openai_model: z.string().default('gpt-4.1-mini'),
  ai_enabled: z.boolean().default(false),
  ai_daily_budget_usd: z.number().min(0).default(1.0),
  ai_max_jobs_per_run: z.number().int().min(0).default(40),
  ai_retry_count: z.number().int().min(0).max(5).default(1),
  // Pricing used only for local cost estimation (USD per 1M tokens). Editable because prices change.
  ai_price_input_per_m: z.number().min(0).default(0.4),
  ai_price_output_per_m: z.number().min(0).default(1.6),
  // Free web-search providers, tried in this order (falls back when one runs out of free credits).
  // Search providers in order (falls back when one fails). Serper/Tavily were removed; old saved values are ignored.
  search_providers: z.array(z.string()).transform((a) => a.filter((p) => ['dataforseo', 'jina', 'exa', 'searxng'].includes(p)))
    .default(['dataforseo', 'jina', 'searxng', 'exa']),
  searxng_url: z.string().max(300).default(''),
  google_jobs_queries_per_run: z.number().int().min(0).max(20).default(4),
  search_max_queries_per_run: z.number().int().min(0).default(12),
  max_employers_per_run: z.number().int().min(1).default(60),
  ats_autodiscover_per_run: z.number().int().min(0).default(60),
  enabled_sources: z.record(z.boolean()).default({}),
  role_focus: z.enum(['BOTH', 'INTERNSHIP', 'GRADUATE']).default('BOTH'),
  auto_accept_strong_sponsor_matches: z.boolean().default(true),
  exclude_b_rated_sponsors: z.boolean().default(true),
  ai_web_search_enabled: z.boolean().default(true),
  ai_web_search_max_results: z.number().int().min(5).max(100).default(40),
  ai_rank_after_scan: z.boolean().default(true),
  ai_rank_limit: z.number().int().min(1).max(100).default(25),
  visa_friendly_boost: z.number().int().min(0).max(20).default(8),
  deadline_radar_days: z.number().int().min(1).max(60).default(21),
  gradcracker_max_jobs_per_run: z.number().int().min(0).default(60),
  max_jobs_per_run: z.number().int().min(1).default(400),
  global_concurrency: z.number().int().min(1).max(8).default(4),
  per_source_delay_ms: z.number().int().min(0).default(400),
  request_timeout_ms: z.number().int().min(1000).default(20000),
  schedule_enabled: z.boolean().default(true),
  schedule_time_london: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  schedule_catch_up: z.boolean().default(true),
  daily_include_potential: z.boolean().default(true),
  // Daily 15: which countries' jobs it draws from, and whether empty slots are filled with labelled "Needs review" jobs.
  daily_markets: z.array(z.string()).transform((a) => a.filter((m) => ['UK', 'UAE', 'QATAR', 'SAUDI'].includes(m))).default(['UK', 'UAE', 'QATAR', 'SAUDI']),
  daily_fill_with_review: z.boolean().default(true),
  sponsor_current_days: z.number().int().default(14),
  sponsor_stale_days: z.number().int().default(45),
  sponsor_official_page: z.string().default('https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers'),
  graduate_visa_rules: z.object({
    source: z.string(),
    last_verified_at: z.string(),
    rule_version: z.string(),
    stale_after_days: z.number(),
    periods: z.array(z.object({ applied_on_or_before: z.string().nullable(), applied_on_or_after: z.string().nullable(), months: z.number() })),
  }).default({
    source: 'https://www.gov.uk/graduate-visa/overview',
    last_verified_at: '2026-10-14',
    rule_version: 'gv-2026-10-14',
    stale_after_days: 60,
    periods: [
      { applied_on_or_before: '2026-12-31', applied_on_or_after: null, months: 24 },
      { applied_on_or_before: null, applied_on_or_after: '2027-01-01', months: 18 },
    ],
  }),
  ui: z.record(z.any()).default({}),
  settings_version: z.number().int().default(1),
  min_roles_per_scan: z.number().int().min(0).max(500).default(150),
  scan_time_budget_minutes: z.number().int().min(2).max(180).default(15),
  resume_interrupted_scans: z.boolean().default(true),
  resolve_board_links: z.boolean().default(true),
  // Only keep postings published within this many days (editable on the Gulf page and in Settings).
  max_posting_age_days: z.number().int().min(1).max(365).default(30),
  // Treat a posting as undated-but-live when the source can't give a date (e.g. employer careers feeds list only open jobs).
  allow_undated_postings: z.boolean().default(true),
  // Let OpenAI web search read postings the app itself cannot open (LinkedIn, Bayt…), clearly labelled.
  ai_read_fallback: z.boolean().default(true),
  // SerpApi searches per Gulf scan (pages count: 10 jobs each; free plan = 250/month).
  gulf_google_queries_per_run: z.number().int().min(0).max(500).default(20),
  // Web searches per scan (DataForSEO ~$2 per 1,000; Jina ~$0.50 per 1,000).
  web_queries_per_run: z.number().int().min(0).max(1000).default(120),
  gulf_web_queries_per_run: z.number().int().min(0).max(1000).default(150),
  // OpenAI opens LinkedIn/Bayt/Indeed postings that search found but the app can't open (8 links per call).
  ai_link_reads_per_run: z.number().int().min(0).max(800).default(96),
  // Board postings opened with the Jina page reader per scan (checks the job is live + reads the full JD).
  board_page_reads_per_run: z.number().int().min(0).max(1000).default(250),
  // AI-steered search: OpenAI proposes test searches, scores them on real search results, then plans the full run.
  ai_search_planner: z.boolean().default(true),
  ai_search_probe_size: z.number().int().min(6).max(60).default(24),
  ai_search_replans: z.number().int().min(0).max(5).default(2),
  // Gulf entry-level score (0–100) a job needs to be "Eligible"; below it (with no blockers) it goes to "Needs review".
  // 45: a strong entry-level posting found on a job board (no employer careers link) can reach Eligible (max 55 without one).
  gulf_eligible_min_score: z.number().int().min(0).max(100).default(45),
  // After each scan, re-open up to N random Eligible jobs to check they are still live (spec §11).
  quality_spot_checks: z.number().int().min(0).max(50).default(10),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export function getSettings(): AppSettings {
  const row = getDb().get<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'app'");
  const raw = j<any>(row?.value_json, {});
  const s = AppSettingsSchema.parse(raw);
  if ((s.settings_version ?? 1) < 2) {
    // v2: use saved keys automatically and let AI read every graded posting (100-150 per scan).
    const up = { ...s, settings_version: 2, ai_max_jobs_per_run: Math.max(s.ai_max_jobs_per_run, 150), ai_daily_budget_usd: Math.max(s.ai_daily_budget_usd, 2), ai_enabled: s.ai_enabled || hasSecret('openai_api_key') };
    return saveSettings(up);
  }
  if (s.settings_version < 3) {
    // v3: wider Gulf search (search pages are now followed, so more queries/reads per scan are useful).
    return saveSettings({ settings_version: 3, gulf_google_queries_per_run: Math.max(s.gulf_google_queries_per_run, 20),
      gulf_web_queries_per_run: Math.max(s.gulf_web_queries_per_run, 60), ai_link_reads_per_run: Math.max(s.ai_link_reads_per_run, 96) });
  }
  if (s.settings_version < 4) {
    // v4: searches now cover several titles each and drop unproductive sites mid-scan, so a bigger budget is well spent.
    return saveSettings({ settings_version: 4, web_queries_per_run: Math.max(s.web_queries_per_run, 120), gulf_web_queries_per_run: Math.max(s.gulf_web_queries_per_run, 150),
      board_page_reads_per_run: Math.max(s.board_page_reads_per_run, 250), scan_time_budget_minutes: Math.max(s.scan_time_budget_minutes, 30) });
  }
  if (s.settings_version >= 7 && s.settings_version < 8) {
    // v8: Gulf job-board postings could never reach Eligible at 60 (max 55 without a careers link) → 45 unless you changed it.
    return saveSettings({ settings_version: 8, gulf_eligible_min_score: s.gulf_eligible_min_score === 60 ? 45 : s.gulf_eligible_min_score });
  }
  if (s.settings_version >= 6 && s.settings_version < 7) {
    // v7: Serper/Tavily replaced by DataForSEO (Google results) + Jina (search and page reader).
    return saveSettings({ settings_version: 7, search_providers: ['dataforseo', 'jina', 'searxng', 'exa'] });
  }
  if (s.settings_version >= 5 && s.settings_version < 6) {
    // v6: searches now find ~3x more postings — let the AI reader confirm more of them per scan.
    return saveSettings({ settings_version: 6, ai_link_reads_per_run: Math.max(s.ai_link_reads_per_run, 160) });
  }
  if (s.settings_version < 5) {
    // v5 (search spec): up to ~200 searches per scan; experience limit and score thresholds come from the spec.
    return saveSettings({ settings_version: 5, web_queries_per_run: Math.max(s.web_queries_per_run, 200), gulf_web_queries_per_run: Math.max(s.gulf_web_queries_per_run, 200) });
  }
  return s;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const row = getDb().get<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'app'");
  const next = AppSettingsSchema.parse({ ...j<any>(row?.value_json, {}), ...patch });
  getDb().run(
    "INSERT INTO settings(key, value_json, updated_at) VALUES ('app', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
    JSON.stringify(next), new Date().toISOString(),
  );
  return next;
}

export function getProfile(): { version: number; profile: Profile } {
  const db = getDb();
  let row = db.get<{ id: number; profile_json: string }>('SELECT id, profile_json FROM user_profile_versions ORDER BY id DESC LIMIT 1');
  if (!row) {
    const p = ProfileSchema.parse({});
    const r = db.run('INSERT INTO user_profile_versions(profile_json, created_at, note) VALUES (?, ?, ?)', JSON.stringify(p), new Date().toISOString(), 'default');
    row = { id: r.lastInsertRowid, profile_json: JSON.stringify(p) };
  }
  return { version: row.id, profile: ProfileSchema.parse(j(row.profile_json, {})) };
}

export function saveProfile(next: unknown, note = 'user edit'): { version: number; profile: Profile } {
  const p = ProfileSchema.parse(next);
  const r = getDb().run('INSERT INTO user_profile_versions(profile_json, created_at, note) VALUES (?, ?, ?)', JSON.stringify(p), new Date().toISOString(), note);
  return { version: r.lastInsertRowid, profile: p };
}
