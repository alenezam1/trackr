// Replayable, ordered migrations. Never edit an applied migration; add a new one.
export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE user_profile_versions (id INTEGER PRIMARY KEY, profile_json TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT);

CREATE TABLE sponsor_snapshots (
  id INTEGER PRIMARY KEY, published_at TEXT, imported_at TEXT NOT NULL, source_url TEXT, source_file TEXT,
  sha256 TEXT NOT NULL, row_count INTEGER NOT NULL, skilled_worker_count INTEGER NOT NULL, parser_version TEXT NOT NULL,
  quality_json TEXT, diff_json TEXT, valid INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sponsor_organisations (
  id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL REFERENCES sponsor_snapshots(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL, exact_key TEXT NOT NULL, core_key TEXT NOT NULL, trading_core_key TEXT,
  town TEXT, county TEXT, type_rating TEXT, rating TEXT, route TEXT NOT NULL, raw_record TEXT NOT NULL
);
CREATE INDEX ix_sponsor_exact ON sponsor_organisations(snapshot_id, exact_key);
CREATE INDEX ix_sponsor_route_core ON sponsor_organisations(snapshot_id, route, core_key);
CREATE INDEX ix_sponsor_trading ON sponsor_organisations(snapshot_id, route, trading_core_key);

CREATE TABLE employers (
  id INTEGER PRIMARY KEY, canonical_name TEXT NOT NULL, employer_domain TEXT, ats_type TEXT, ats_token TEXT,
  careers_url TEXT, sector TEXT, suggested_legal_name TEXT, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 50,
  discovery_status TEXT NOT NULL DEFAULT 'NEW', provenance TEXT, first_seen_at TEXT NOT NULL, last_checked_at TEXT,
  last_new_jobs INTEGER DEFAULT 0, total_jobs_seen INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0, next_check_at TEXT,
  last_error TEXT, skip_reason TEXT, notes TEXT, UNIQUE(ats_type, ats_token)
);
CREATE TABLE employer_aliases (
  id INTEGER PRIMARY KEY, alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, legal_name TEXT NOT NULL,
  evidence_url TEXT, verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX ix_alias_norm ON employer_aliases(normalized_alias);
CREATE TABLE employer_sponsor_matches (
  id INTEGER PRIMARY KEY, employer_id INTEGER NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL, exact_key TEXT NOT NULL, town TEXT, snapshot_id INTEGER, match_method TEXT NOT NULL,
  status TEXT NOT NULL, evidence_url TEXT, evidence_note TEXT, verified_by_user INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_esm_employer ON employer_sponsor_matches(employer_id, active);

CREATE TABLE source_connections (
  source_id TEXT PRIMARY KEY, capability_mode TEXT NOT NULL, status TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TEXT, last_success_at TEXT, last_error TEXT, links_found INTEGER DEFAULT 0, full_jds INTEGER DEFAULT 0,
  failures INTEGER DEFAULT 0, next_allowed_request_at TEXT, notes TEXT
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY, canonical_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, advertised_employer TEXT,
  employer_id INTEGER REFERENCES employers(id), legal_employer TEXT, category TEXT, employment_type TEXT,
  location TEXT, salary_text TEXT, posted_at TEXT, deadline_at TEXT, listing_state TEXT NOT NULL DEFAULT 'OPEN',
  apply_url TEXT, apply_url_kind TEXT, source_id TEXT NOT NULL, source_job_id TEXT, first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, last_checked_at TEXT, is_demo INTEGER NOT NULL DEFAULT 0, presented_count INTEGER NOT NULL DEFAULT 0,
  current_status TEXT, current_fit INTEGER, user_hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_jobs_status ON jobs(current_status);
CREATE TABLE source_jobs (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, source_id TEXT NOT NULL,
  source_job_id TEXT, board_url TEXT, employer_url TEXT, query TEXT, run_id INTEGER, discovered_at TEXT NOT NULL,
  UNIQUE(source_id, source_job_id)
);
CREATE TABLE job_description_versions (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, text TEXT NOT NULL, hash TEXT NOT NULL,
  source_url TEXT, fetched_at TEXT NOT NULL, extraction_method TEXT NOT NULL, access_mode TEXT, complete INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT
);
CREATE INDEX ix_jdv_job ON job_description_versions(job_id, active);
CREATE TABLE job_facts (
  id INTEGER PRIMARY KEY, jd_version_id INTEGER NOT NULL REFERENCES job_description_versions(id) ON DELETE CASCADE,
  extraction_json TEXT NOT NULL, rule_facts_json TEXT, ai_json TEXT, evidence_validated INTEGER NOT NULL,
  model TEXT, prompt_version TEXT, profile_version INTEGER, cache_key TEXT, ai_error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX ix_facts_cache ON job_facts(cache_key);
CREATE TABLE job_decisions (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, jd_version_id INTEGER,
  sponsor_snapshot_id INTEGER, profile_version INTEGER, rules_version TEXT NOT NULL, status TEXT NOT NULL,
  reasons_json TEXT NOT NULL, matrix_json TEXT NOT NULL, sponsor_match_json TEXT, fit_score INTEGER, fit_json TEXT,
  review_state TEXT NOT NULL DEFAULT 'AUTO', created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_decisions_job ON job_decisions(job_id, active);

CREATE TABLE search_runs (
  id INTEGER PRIMARY KEY, mode TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, phase TEXT,
  query TEXT, intent_json TEXT, profile_version INTEGER, sponsor_snapshot_id INTEGER, counts_json TEXT, errors_json TEXT,
  source_stats_json TEXT, budget_json TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0, checkpoint_json TEXT
);
CREATE TABLE search_run_candidates (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE, job_id INTEGER, state TEXT NOT NULL,
  reason_codes_json TEXT, title TEXT, employer TEXT, source_id TEXT, url TEXT, created_at TEXT NOT NULL
);
CREATE INDEX ix_runcand_run ON search_run_candidates(run_id);

CREATE TABLE daily_batches (
  id INTEGER PRIMARY KEY, date_london TEXT NOT NULL UNIQUE, user_profile_version INTEGER, created_at TEXT NOT NULL,
  updated_at TEXT, target_cyber INTEGER NOT NULL, target_it INTEGER NOT NULL, summary_json TEXT
);
CREATE TABLE daily_batch_jobs (
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES daily_batches(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, category_slot TEXT NOT NULL, rank INTEGER NOT NULL,
  eligibility_label TEXT NOT NULL, selected_at TEXT NOT NULL, added_by TEXT NOT NULL DEFAULT 'AUTO', removed_at TEXT, note TEXT,
  UNIQUE(batch_id, job_id)
);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE, stage TEXT NOT NULL,
  applied_at TEXT, cv_version TEXT, cover_letter_version TEXT, qa_notes TEXT, followup_at TEXT, interview_at TEXT,
  recruiter TEXT, notes TEXT, tags_json TEXT, rating INTEGER, outcome TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  first_shortlisted_at TEXT
);
CREATE TABLE application_events (
  id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_stage TEXT, to_stage TEXT NOT NULL, at TEXT NOT NULL, user_action TEXT, note TEXT
);
CREATE TABLE user_feedback (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, rating INTEGER,
  not_interested INTEGER NOT NULL DEFAULT 0, strong_fit INTEGER NOT NULL DEFAULT 0, override_note TEXT,
  review_verdict TEXT, verified_by_user INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL
);
CREATE TABLE api_cost_ledger (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, model TEXT, task_name TEXT, tokens_input INTEGER, tokens_output INTEGER,
  estimated_cost REAL, source_id TEXT, run_id INTEGER
);
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, job_id INTEGER, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE sponsor_ats_probes (
  exact_key TEXT PRIMARY KEY, legal_name TEXT NOT NULL, town TEXT, probed_at TEXT NOT NULL, found INTEGER NOT NULL DEFAULT 0,
  result_json TEXT
);
`,
  },
  {
    version: 3,
    sql: `
CREATE INDEX IF NOT EXISTS ix_sponsor_exact_route ON sponsor_organisations(snapshot_id, exact_key, route);
CREATE INDEX IF NOT EXISTS ix_jobs_employer ON jobs(employer_id);
CREATE INDEX IF NOT EXISTS ix_source_jobs_job ON source_jobs(job_id);
ANALYZE;
`,
  },
  {
    version: 4,
    sql: `
CREATE TABLE IF NOT EXISTS ai_rankings (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, jd_hash TEXT, prompt_version TEXT,
  result_json TEXT NOT NULL, overall INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_rankings_job ON ai_rankings(job_id);
CREATE TABLE IF NOT EXISTS company_candidates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, source TEXT, sector TEXT, careers_url TEXT,
  register_status TEXT, legal_name TEXT, status TEXT, boards_json TEXT, checked_at TEXT
);
`,
  },
  {
    version: 5,
    sql: `
ALTER TABLE jobs ADD COLUMN market TEXT NOT NULL DEFAULT 'UK';
CREATE INDEX IF NOT EXISTS ix_jobs_market ON jobs(market, current_status);
`,
  },
  {
    version: 6,
    sql: `
-- Jobs you removed: deleted from the tracker and never added again by later scans.
CREATE TABLE IF NOT EXISTS dismissed_jobs (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL, title TEXT, employer TEXT, dismissed_at TEXT NOT NULL, UNIQUE(kind, value)
);
CREATE INDEX IF NOT EXISTS ix_source_jobs_board_url ON source_jobs(board_url);
CREATE INDEX IF NOT EXISTS ix_jobs_apply_url ON jobs(apply_url);
`,
  },
  {
    version: 7,
    sql: `
-- The first board page reader accepted cut-down pages (closed LinkedIn jobs showing only "similar jobs") and search-engine
-- dates. Remove those Gulf board jobs (unless in your tracker) so the next scan re-checks them properly.
DELETE FROM jobs WHERE market != 'UK' AND apply_url_kind = 'BOARD' AND id NOT IN (SELECT job_id FROM applications)
  AND id IN (SELECT job_id FROM job_description_versions WHERE extraction_method IN ('board_page_read', 'ai_web_read'));
`,
  },
  {
    version: 8,
    sql: `
-- Scan console: every step the search algorithm takes (queries, results, filters, pages opened, decisions).
CREATE TABLE IF NOT EXISTS scan_events (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, at TEXT NOT NULL, stage TEXT NOT NULL, msg TEXT NOT NULL, data_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_scan_events_run ON scan_events(run_id, id);
CREATE INDEX IF NOT EXISTS ix_src_run ON search_run_candidates(run_id);
`,
  },
];
