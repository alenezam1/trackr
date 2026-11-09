# Architecture

```
Electron shell (electron/main.cjs)  ── spawns ──▶  Local server (server/index.ts, 127.0.0.1 only)
  sandboxed BrowserWindow                           ├─ api.ts            allow-listed, zod-validated routes
  no Node in renderer                               ├─ config/           settings, profile versions, DPAPI secrets
  links → system browser                            ├─ db/               node:sqlite + replayable migrations
                                                    └─ core/
React UI (src/, built by Vite to dist/)                ├─ sponsors/     CSV import, snapshots, diff, name keys, matching, GOV.UK refresh
  fetch('/api/…') + X-SponsorFirst header              ├─ sources/      polite HTTP + robots, 9 board connectors, ATS APIs, Reed/Adzuna/Jooble/Brave, registry
                                                       ├─ discovery/    intent parser, employer seeds, ATS auto-discovery, pipeline, scan orchestrator, scheduler
                                                       ├─ extraction/   classifiers, deterministic evidence rules, JD acquisition (JSON-LD)
                                                       ├─ ai/           optional OpenAI structured extraction + grounded merge
                                                       ├─ eligibility/  permission model + DETERMINISTIC policy engine
                                                       ├─ ranking/      fit score + Daily 15 selection
                                                       └─ tracker/      jobs queries, applications, CSV import/export, backups
```

## Pipeline (per posting)

1. **Discover** (Track A role-first APIs/search; Track B sponsor-first ATS boards + register auto-discovery).
2. **Prefilter** (cheap, no network/AI): category, UK location, search intent. Counted in the run trace.
3. **Dedupe / upsert**: canonical key per ATS job id or source id; cross-source duplicates collapse onto one record
   (same employer + title + city within 60 days). All provenance URLs kept in `source_jobs`; employer/ATS apply URL preferred.
4. **Full JD**: ATS APIs return full text; Reed/SmartRecruiters get a second detail call; board links are never fetched.
   Each text change creates a new immutable `job_description_versions` row (hash, method, access mode).
5. **Rule facts** (`extraction/rules.ts`) with exact sentences + offsets as evidence.
6. **Sponsor gate** (`sponsors/match.ts`): user-confirmed mapping / exact legal name / verified alias pass; similarity only proposes.
7. **Optional AI** only after cheap gates pass; schema-validated; every quote located in the JD; AI may add restrictions only
   with grounded quotes and can never remove rule-detected ones. Cached by JD hash + model + prompt + rules + profile version.
8. **Deterministic decision** (`eligibility/engine.ts`) → status, reason codes with severity + evidence, visa matrix.
9. **Fit score** only for non-excluded jobs. Decision persisted (old ones kept inactive for history); alerts on changes.

## Invariants enforced in code

- Extraction never writes statuses; AI never sets sponsor membership; adapters never insert approved matches.
- Hard fails always produce `EXCLUDED` and no fit score; Daily 15 never selects EXCLUDED/STALE/closed/demo jobs.
- `VERIFIED_COMPATIBLE` requires explicit visa/sponsorship evidence **and** a user-confirmed work permission.
- Search text can only narrow results; policy-bypass phrases produce a visible warning.
- Provider errors are recorded per source and in the run; they are never treated as "no jobs".
