# Test report — 2026-10-14

- `npm run test` + `npm run test:e2e`: **68/68 passing** (rules incl. every spec §11.3 edge case, engine, permission model,
  intent parsing/policy bypass, name normalisation, AI-merge grounding, API e2e incl. CSRF/Host guards, Daily 15, tracker).
- `npm run lint`, `npm run typecheck`: clean.
- Real sponsor CSV import: 143,159 rows / 123,132 Skilled Worker (matches spec), ~5 s.
- Live scan (real public ATS APIs): 23 seeded employers + auto-discovery (120 sponsors probed, 6 new boards found), ~950 postings
  read, 180 in-scope UK jobs stored with full JDs; exclusions spot-checked (senior, 3+ years mandatory, DV-required) — correct.
- UI checked in a browser at 1366×768: Dashboard, Explore, job detail (evidence highlighting), Sources, Sponsors.

Not verified: the Electron window itself (`npm run dev`) was not launched in this session; Reed/Adzuna/Jooble/Brave/OpenAI
adapters are implemented against their documented APIs but untested without keys.
