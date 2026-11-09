# Eligibility rules (rules version `rules-2026.10.14-1`)

Implemented in `server/core/eligibility/engine.ts` (decision) and `server/core/extraction/rules.ts` (evidence).
All reasons are collected (not first-match), each with severity, message, quoted evidence and profile setting.

Status: `STALE` if closed/past deadline → else `EXCLUDED` if any **hard_fail** → else `NEEDS_REVIEW` if any **uncertain** →
else `VERIFIED_COMPATIBLE` if (JD explicitly accepts Graduate visa **or** offers sponsorship) **and** your work permission is
CONFIRMED **and** duration is not incompatible → else `POTENTIAL_NO_STATED_BLOCKER`.

| Check | hard_fail | uncertain (review) | advisory |
|---|---|---|---|
| Sponsor register | entity confirmed absent (`SPONSOR_NOT_FOUND`) — includes employers listed only on non-Skilled-Worker routes | proposed/ambiguous entity, agency/unknown employer, B rating, stale or missing snapshot | snapshot ageing |
| Scope | category OTHER / disabled, non-UK location, senior title | category unclear, ambiguous remote location | — |
| Citizenship / nationality | mandatory British/UK citizenship; other nationality restriction excluding yours | residency years required but yours not set | — |
| Clearance | mandatory (incl. "eligible for / able to obtain") SC, DV, CTC per your settings | ambiguous vetting ("may be required to undergo security screening"); other mandatory vetting | — |
| Work authorisation | explicit time-limited/Graduate visa ban; permanent/unrestricted/settled RTW; "no sponsorship now or in the future" (when you need a future route) | ambiguous/contradictory visa wording | "Right to work in the UK" alone is *not* a blocker |
| Students / cohort | currently-enrolled/placement-year only | cohort stated but your graduation year unknown | — |
| Experience | mandatory years > your max (default 2) | — | preferred years > max |
| Pay | explicitly unpaid | — | — |
| Duration | 3-year programme without stated sponsorship; end after **confirmed** expiry without transition | end after **estimated** expiry; 3-year programme that states sponsorship; fixed-term/programme without length | — |
| Start date | start after confirmed expiry | before your earliest start; Student permission | — |
| Future sponsorship | — | "no sponsorship" on roles outlasting the visa (permanent) | "no sponsorship" on short roles |
| AI | — | AI claims not found in JD; AI failure would otherwise leave a job VERIFIED | — |

Evidence semantics follow spec §11.3: BPSS/DBS are not SC; "SCADA" is not SC; "3 years of company history" is not a
programme length; "3 years' experience preferred" is not mandatory; requirement level is taken from the sentence's cue words
or its section heading (Essential/Requirements vs Desirable/Nice to have).

Graduate visa rule (configurable, Settings): 24 months if applied on/before 2026-12-31, 18 months from 2027-01-01
(source https://www.gov.uk/graduate-visa/overview, verified 2026-10-14, flagged STALE after 60 days). Planned/applied
visas only produce *estimates*, never confirmed permission.

Manual review verdicts: "Confirmed eligible" can turn uncertain items into advisory (status at most POTENTIAL, marked
verified_by_user); it can never override a hard fail. "Confirmed ineligible" excludes. Verdicts apply to the JD version they were made on.
