# User guide

## Daily routine
1. Open the app (`npm run dev`). If it is a weekday after 09:00 London time and today's scan hasn't run, it runs automatically
   (catch-up can be switched off). Scans only run **while the app is open**.
2. **Dashboard** shows the scan progress, register age, Daily 15 progress, filter trace and source health.
3. **Daily 15**: up to 10 Security/GRC + 5 IT roles, off-cycle internships first. Each card shows sponsor, Graduate-visa
   and clearance badges. *Potential* = no stated blocker in the full JD, **not** employer confirmation. Toggle *Verified only*.
   If one category is short, you can accept an alternate mix (recorded). The counter is never filled with ineligible roles.
4. Open a job → **Decision & evidence** (quoted sentences, matrix, fit), **Full JD** (evidence highlighted), **Sponsor match**
   (exact CSV row; *Correct entity match*), **Tracker**, **Drafts & questions** (recruiter questions, cover-note draft).
5. **Open Apply** opens the employer page in your browser. It does not mark the job applied — use *Mark applied* only after
   you actually submit.

## Getting more results
- Confirm proposed employer mappings (Sponsors & Employers → Employers → select → *Confirm selected*). Only confirm after checking
  the legal entity (careers site footer, privacy notice, Companies House).
- Add free API keys (Settings): Reed, Adzuna, Jooble, Brave Search. These search listings drawn from most UK boards.
- Run History → *Discover more sponsor boards* probes 150 more register sponsors for public job boards.
- Add employers by careers URL. Paste interesting links from LinkedIn/Indeed/etc. on **Import job**.

## Review & rejected
- **Needs Review** groups items by the action needed (confirm entity, read JD, clarify vetting, …).
- **Rejected** shows the exact rule and JD sentence. Use *Dispute / mark for review* if a source error caused it.

## Settings
- Visa status and dates. *Verified* requires a granted visa with expiry and "evidence checked".
- Protected rules (clearances, experience, paid only, student placements, strict sponsorship) need explicit confirmation and
  re-evaluate all jobs.
- OpenAI: see exactly what is sent; daily $ budget and per-run cap.

## Backup / restore
Settings → *Back up now* writes `%APPDATA%\SponsorFirst\backups\trackr-<time>.sqlite` (+ settings JSON without keys).
To restore: close the app, copy the backup over `%APPDATA%\SponsorFirst\trackr.sqlite`, reopen.

## Optional: run without opening the app
`npx tsx server/cli.ts scan` runs one headless scan. You may create a Windows Task Scheduler task for it yourself; the app does
not install one, and nothing runs while the computer is asleep or off.

## Demo data
`npm run fixtures:seed` writes synthetic **DEMO** jobs into a separate folder (`%APPDATA%\SponsorFirst-DEMO`). View with
`$env:TRACKR_DATA_DIR="$env:APPDATA\SponsorFirst-DEMO"; npm run dev`. Demo jobs never enter your Daily 15.
