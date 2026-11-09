# Sources and access decisions

The app only uses automated access where it is documented/permitted. Everything else is an honest *Limited* connector.

| Source id | Mode | Status shown | What the app does |
|---|---|---|---|
| `linkedin` | USER_SHARED_LINK | Limited | Filtered search links; paste job links/JD. LinkedIn's crawling terms prohibit scraping without permission. Brave `site:linkedin.com/jobs/view` discovery (if configured) stores links only. |
| `brightnetwork` | USER_SHARED_LINK | Limited | Dashboard needs your login; no public API. Search links + import. |
| `ucl_careers` | USER_SHARED_LINK | Login Required | Authenticated TargetConnect portal; credentials/sessions are never collected. Paste links/JD. |
| `indeed` | USER_SHARED_LINK | Limited | Search links + import; employer posting used for the full JD when it is on a public ATS. |
| `trackr` | USER_SHARED_LINK | Limited | Graduate programme / internship tracker links + import. |
| `prospects`, `targetjobs`, `gradcracker`, `higherin` | USER_SHARED_LINK | Limited | robots.txt is checked and shown; no automated crawling because the terms do not grant it. Search links, import, optional Brave `site:` discovery. |
| `gradcracker_reader` | PERMITTED_PUBLIC_HTML (opt-in) | Connected when enabled | Reads computing graduate-job + internship listings and full job pages (`.job-description`). robots.txt allows `/search` and `/hub` (checked 2026-10-14 and per URL at runtime); never touches `/out` or apply links. 1.5 s between requests, max 60 job pages per run. |
| `ats_greenhouse` | PUBLIC_ATS | Connected | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` (documented Job Board API). |
| `ats_lever` | PUBLIC_ATS | Connected | `api.lever.co/v0/postings/{token}?mode=json` (documented Postings API). |
| `ats_ashby` | PUBLIC_ATS | Connected | `api.ashbyhq.com/posting-api/job-board/{token}` (documented Job Posting API). |
| `ats_smartrecruiters` | PUBLIC_ATS | Connected | `api.smartrecruiters.com/v1/companies/{id}/postings` + detail call. |
| `ats_recruitee` | PUBLIC_ATS | Connected | `{company}.recruitee.com/api/offers/` (no auth). Included in register auto-discovery. |
| `ats_personio` | PUBLIC_ATS | Connected | `{company}.jobs.personio.de/xml?language=en` (falls back to `.com`). Included in auto-discovery. |
| `ats_teamtailor` | PUBLIC_ATS | Connected | `{company}.teamtailor.com/jobs.rss`. Included in auto-discovery. |
| `ats_workable` | PUBLIC_ATS | Connected | `apply.workable.com/api/v1/widget/accounts/{account}?details=true` + v2 job detail. Included in auto-discovery. |
| `nhs_jobs` | AUTHORISED_FEED | Connected | Official NHS Jobs RSS (`/api/v1/search_rss?keyword=…&location=London`); full advert page read for prefiltered roles (robots.txt checked, 1.2 s spacing). |
| `arbeitnow` | OFFICIAL_API | Connected | Free key-less API; UK / UK-remote listings only; visa-sponsorship flag carried into the JD text. |
| `himalayas` | OFFICIAL_API | Connected | Free key-less remote-jobs API with `country=United Kingdom`; attribution kept (source link + "Source: Himalayas"). |
| `hn_whoishiring` | OFFICIAL_API | Connected | Algolia HN API: current "Ask HN: Who is hiring?" top-level posts mentioning London/UK. |
| `ats_workday` | UNAVAILABLE | Permission Required | No documented public API; undocumented endpoints are not used. Manual import only. |
| `reed` | OFFICIAL_API | Not Configured until key | Reed Jobseeker API: search + full description. Agency ads stay in review until the employer is known. |
| `adzuna` | OFFICIAL_API | Not Configured until key | Aggregator API; snippet only → `FULL_JD_NOT_READ` until you read/paste the JD. |
| `jooble` | OFFICIAL_API | Not Configured until key | Aggregator API across many boards; snippet + link; ATS links resolved via official ATS API. |
| `brave_search` | SEARCH_INDEX_DISCOVERY | Not Configured until key | Licensed search API for Boolean/`site:` discovery. Google HTML is never scraped; Google queries are offered as browser links. |
| `user_link` | MANUAL_IMPORT | Connected | Paste link or text. ATS links → API; employer pages → only if robots.txt allows (JSON-LD `JobPosting` preferred); board pages → never fetched. |

## Employer discovery

- **Seeds** (`server/core/discovery/employerSeeds.ts`): 23 employers whose public boards responded and whose suggested legal
  entity exists on the 2026-10-05 Skilled Worker register, plus 7 London universities (watchlist, manual import).
- **Auto-discovery** (`atsDiscovery.ts`): each full scan probes N not-yet-probed A-rated Skilled Worker sponsors (London and
  tech/finance/university-like names first, non-tech trades skipped) for Greenhouse/Lever/Ashby boards derived from their
  legal/trading names. Boards with UK postings become tracked employers with a **proposed** mapping to that exact register row.
- You can add any employer by careers URL on the Employers page.

## Politeness

Identified user agent, per-source spacing (default 400 ms), timeouts, bounded retries with exponential backoff, `Retry-After`,
circuit breaker on 401/403/429 (no repeated attempts), robots.txt for HTML pages, per-run caps on employers, jobs, queries and AI.
