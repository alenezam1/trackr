<div align="center">

# 🎯 SponsorFirst · Daily 15

**A local-first desktop app that hunts UK cyber security, GRC and IT roles, checks every employer against the UK Home Office visa-sponsor register, reads the full job description, and hands you 15 roles a day you can actually apply for.**

[![CI](https://github.com/alenezam1/trackr/actions/workflows/ci.yml/badge.svg)](https://github.com/alenezam1/trackr/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Electron](https://img.shields.io/badge/Electron-desktop-47848F?logo=electron&logoColor=white)
![Node](https://img.shields.io/badge/Node-22.13%2B-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

</div>

---

## Why I built it

International graduates in the UK need an employer that holds a **Skilled Worker sponsor licence**. Job boards don't filter
on that, and most postings hide the deal-breakers (security clearance, citizenship only, "must have permanent right to work",
3+ years' experience) deep in the description. I was checking the 143,000-row government register by hand for every
application, so I automated the whole process:

> **discover roles → verify the sponsor → read the full JD → apply hard rules with evidence → rank → track applications**

Everything runs on your own machine. Nothing is hosted, and API keys are encrypted with Windows DPAPI.

## ✨ Highlights

| | |
|---|---|
| 🏛️ **Sponsor gate** | Imports the official GOV.UK sponsor register (143k rows in about 5 s), normalises legal names, tracks snapshots and diffs, and maps brands to legal entities. Fuzzy similarity can only *propose* a match; it never approves one. |
| 📜 **Deterministic eligibility engine** | Rule-based extraction flags SC/DV/CTC clearance, citizenship-only, permanent right-to-work, student-only, seniority and unpaid roles, and keeps the **exact sentence and offset as evidence**. A pure policy engine turns those facts into a status with reason codes. |
| 🤖 **Grounded AI (optional)** | OpenAI structured extraction runs only after the cheap gates pass. The output is schema-validated (zod), every quote must be found in the JD, and the AI can **add** a restriction but never **remove** one. Results are cached by JD hash, model, prompt and rules version. |
| 🔎 **Multi-source discovery** | Public Greenhouse / Lever / Ashby / SmartRecruiters ATS APIs, Reed / Adzuna / Jooble job APIs, plus web-search providers (SerpApi, Tavily, Exa, Serper, Brave, SearXNG). It also **auto-discovers ATS boards** for sponsors on the register. |
| 🧭 **Ethical by design** | Polite HTTP with robots.txt support. Boards that forbid scraping (LinkedIn, Indeed and others) get filtered search links and a paste-the-JD flow instead of a scraper. |
| 📊 **Daily 15 and tracker** | Fit scoring, a daily shortlist that never includes excluded, stale or closed jobs, application tracking, alerts, CSV import/export, run history and backups. |
| 🌍 **Gulf markets mode** | Separate discovery and rules for entry-level cyber roles in the UAE, Qatar and Saudi Arabia, which filter out roles reserved for nationals. |
| 🔐 **Hardened local server** | Bound to 127.0.0.1 only, Host-header (DNS-rebinding) and Origin checks, a mandatory custom header on state changes (CSRF), strict CSP, and a sandboxed Electron renderer with no Node access. |

## 🏗️ Architecture

```
Electron shell (electron/main.cjs) ──spawns──▶ Local API server (server/index.ts, 127.0.0.1 only)
  sandboxed BrowserWindow                       ├─ api.ts          allow-listed, zod-validated routes
  links open in the system browser              ├─ config/         settings, profile versions, DPAPI secrets
                                                ├─ db/             node:sqlite + replayable migrations
React + Tailwind UI (src/, built by Vite)       └─ core/
  fetch('/api/…') + X-SponsorFirst header          ├─ sponsors/    register import, snapshots, name keys, matching
                                                   ├─ sources/     ATS APIs, job APIs, web search, board connectors
                                                   ├─ discovery/   intent parser, ATS auto-discovery, scan pipeline, scheduler
                                                   ├─ extraction/  classifiers, evidence rules, JD acquisition (JSON-LD)
                                                   ├─ ai/          optional grounded LLM extraction and ranking
                                                   ├─ eligibility/ permission model + deterministic policy engine
                                                   ├─ ranking/     fit score + Daily 15 selection
                                                   └─ tracker/     applications, CSV import/export, backups
```

**Pipeline per posting:** discover → prefilter (no network) → dedupe across sources → fetch the full JD (versioned by hash) →
rule facts with evidence → sponsor gate → optional AI → deterministic decision → fit score → alerts.

**Invariants enforced in code**
- Extraction never writes statuses; AI never decides sponsor membership.
- A hard fail always produces `EXCLUDED` with no fit score.
- `VERIFIED_COMPATIBLE` needs explicit sponsorship evidence **and** a user-confirmed work permission.
- A provider error is recorded as an error. It is never treated as "no jobs".

More detail: [Architecture](docs/ARCHITECTURE.md) · [Design decisions](docs/DECISIONS.md) · [Rules](docs/RULES.md) ·
[Sources](docs/SOURCES.md) · [User guide](docs/USER_GUIDE.md) · [Test report](docs/TEST_REPORT.md)

## 🧰 Tech stack

**TypeScript** throughout · **React 18** + **Tailwind CSS** + Lucide · **Vite** · **Electron** + electron-builder (Windows
portable exe + NSIS installer) · **Node 22 `node:sqlite`** (no native build step) · **zod** · **cheerio** · **esbuild** ·
**Vitest** · **ESLint** · GitHub Actions CI

## 🚀 Getting started

Requirements: **Windows**, **Node.js 22.13+** (uses the built-in `node:sqlite`).

```powershell
git clone https://github.com/alenezam1/trackr.git
cd trackr
.\scripts\setup.ps1          # install, build UI, migrate DB, import the sponsor CSV if present
npm run dev                  # launch the desktop app
```

Or run it in a browser with `npm run start:server` and open http://127.0.0.1:4317.

**Sponsor register:** download the *Worker and Temporary Worker* CSV from
[GOV.UK](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers) into the project folder before
running setup, or use **Sponsors → Refresh from official GOV.UK CSV** inside the app. To try the app without real data,
`npm run fixtures:seed` loads labelled **DEMO** data.

**Optional free API keys** (Settings → API keys): SerpApi, Tavily, Exa, Serper, Brave, Reed, Adzuna, Jooble. An OpenAI key
turns on the AI features.

## 🧪 Quality

```powershell
npm test             # unit tests: rules, engine, planner, providers, roles, sources, Gulf
npm run test:e2e     # end-to-end API tests on an isolated temp DB (CSRF/Host guards, Daily 15, tracker)
npm run lint
npm run typecheck
```

CI runs lint, typecheck and the unit tests on every push.

## 📦 Build the Windows app

```powershell
npm run dist:exe     # → release/SponsorFirst-<version>-portable.exe and the x64 installer
```

## 📁 Project layout

```
electron/   desktop shell
server/     local API, database, and the core engine
src/        React UI (pages + components)
tests/      unit and end-to-end tests
scripts/    Windows setup and updater
docs/       architecture, decisions, rules, sources, user guide
data/       DEMO fixtures
```

## 📄 License

[MIT](LICENSE) © Mohsen Alenezi
