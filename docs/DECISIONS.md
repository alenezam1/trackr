# Decisions and deviations from the default stack

1. **SQLite via `node:sqlite` instead of `better-sqlite3`.** better-sqlite3 is a native module that must be rebuilt for
   Electron's ABI on Windows, which commonly fails without build tools. Node 22's built-in `node:sqlite` needs no build step.
   Consequence: the server runs in **system Node 22.13+** (spawned by Electron) rather than inside Electron's bundled Node.
2. **Local HTTP API instead of Electron IPC.** The UI talks to a 127.0.0.1-only server with an allow-list of zod-validated
   routes. Equivalent protections: loopback Host check (DNS-rebinding), mandatory custom header on state changes (forces a CORS
   preflight that is never approved), Origin check, strict CSP, no Node in the renderer (`contextIsolation`, `sandbox`,
   `nodeIntegration: false`). Benefit: the same app runs in a normal browser and is testable end-to-end.
3. **Secrets via Windows DPAPI (PowerShell `ProtectedData`)** instead of Electron `safeStorage`, because the server process is
   plain Node. Keys never leave the server; the UI only sees "configured: true/false".
4. **Tailwind + hand-built components instead of shadcn/ui** to avoid a CLI-generated component tree; Lucide icons are used.
5. **E2E tests are API-level** (real server, isolated temp DB, DEMO fixtures) rather than Playwright browser tests, to avoid a
   ~300 MB browser download. The UI was checked manually in a browser at 1366×768 (see TEST_REPORT.md).
6. **Prefiltered postings are not stored.** Clearly out-of-scope or non-UK titles from employer boards are counted in the run
   trace but not persisted, to keep the database focused. Everything that passes the prefilter is stored and never deleted.
10. **User directive (2026-10-14): take jobs whose full JD states no restriction.** Such jobs are shown as
    "Eligible · no restrictions stated" and fill the Daily 15. Strong sponsor matches are auto-accepted (setting
    `auto_accept_strong_sponsor_matches`, default on): checked seed/auto-discovered mappings, register trading names,
    a single legal entity with the same brand-level name, and a checked alias list (EY, PwC, Deloitte, KPMG, BDO, …).
    They are labelled "auto-matched", never "Verified". Unstated programme/contract length is now advisory.
    LinkedIn, Indeed and Bright Network are still not scraped (terms / 403); targetjobs, Prospects and The Trackr render
    listings with JavaScript, so they stay link + paste. Gradcracker has an opt-in reader.
11. **Role focus toggle** (Internships / Graduate & entry-level / Both) filters scans, Explore and the Daily 15.

7. **Seeded employer → legal-entity mappings are proposals** (auto-accepted when the setting above is on). They were checked against the register on 2026-10-14 but brand
   names are not proof of the employing entity, so each mapping needs your confirmation before jobs can pass the sponsor gate.
8. **Default OpenAI model `gpt-4.1-mini`** is only a default; the model name is free text in Settings. AI is off until you enable it.
9. **No scraping of named boards.** LinkedIn, Indeed, Bright Network, UCL Careers, The Trackr, Prospects, targetjobs,
   Gradcracker and higherin are Limited connectors. Breadth across "every board" comes from official aggregator APIs
   (Reed, Adzuna, Jooble) and a licensed search API (Brave) — all optional and key-based.
