// Seed list for Track B (sponsor-first targeted employer sweep). Every entry was checked on 2026-10-14:
//  - the public ATS board token responded with live postings, and
//  - the suggested legal entity appears with Route = "Skilled Worker" in the 2026-10-05 register.
// The brand → legal-entity mapping is a PROPOSAL until you confirm it on the Employers page.
// Add more employers in the app (Employers → Add) — any public Greenhouse/Lever/Ashby/SmartRecruiters board works.
import type { AtsType } from '../sources/ats.js';

export interface EmployerSeed { name: string; ats: AtsType; token: string; legal: string | string[]; sector: string; careers?: string }

export const EMPLOYER_SEEDS: EmployerSeed[] = [
  { name: 'Monzo', ats: 'greenhouse', token: 'monzo', legal: 'Monzo Bank Ltd', sector: 'Fintech / bank' },
  { name: 'GoCardless', ats: 'greenhouse', token: 'gocardless', legal: 'GoCardless Limited', sector: 'Fintech' },
  { name: 'Cloudflare', ats: 'greenhouse', token: 'cloudflare', legal: 'Cloudflare Limited', sector: 'Security / infrastructure' },
  { name: 'Datadog', ats: 'greenhouse', token: 'datadog', legal: 'Datadog Ireland Limited', sector: 'Cloud monitoring / security' },
  { name: 'Elastic', ats: 'greenhouse', token: 'elastic', legal: 'Elasticsearch Limited', sector: 'Search / security' },
  { name: 'Twilio', ats: 'greenhouse', token: 'twilio', legal: 'Twilio UK Limited', sector: 'Cloud communications' },
  { name: 'Okta', ats: 'greenhouse', token: 'okta', legal: 'Okta UK Ltd', sector: 'Identity security' },
  { name: 'MongoDB', ats: 'greenhouse', token: 'mongodb', legal: 'MongoDB UK Limited', sector: 'Database / cloud' },
  { name: 'Deliveroo', ats: 'greenhouse', token: 'deliveroo', legal: 'Roofoods Ltd t/a Deliveroo', sector: 'Technology' },
  { name: 'Databricks', ats: 'greenhouse', token: 'databricks', legal: 'Databricks UK Limited', sector: 'Data / cloud' },
  { name: 'Palantir', ats: 'lever', token: 'palantir', legal: ['Palantir Technologies UK Limited', 'Palantir UK Limited'], sector: 'Software / defence' },
  { name: 'Spotify', ats: 'lever', token: 'spotify', legal: 'Spotify Limited', sector: 'Technology' },
  { name: 'Zopa', ats: 'lever', token: 'zopa', legal: 'Zopa Bank Limited', sector: 'Fintech / bank' },
  { name: 'Synthesia', ats: 'ashby', token: 'synthesia', legal: 'Synthesia Limited', sector: 'AI' },
  { name: 'Wayve', ats: 'ashby', token: 'wayve', legal: 'Wayve Technologies Ltd', sector: 'AI / autonomy' },
  { name: 'Faculty', ats: 'ashby', token: 'faculty', legal: 'Faculty Science Limited', sector: 'AI consultancy' },
  { name: 'Snyk', ats: 'ashby', token: 'snyk', legal: 'Snyk Limited', sector: 'Application security' },
  { name: 'Paddle', ats: 'ashby', token: 'paddle', legal: 'Paddle.com Market Limited', sector: 'Fintech' },
  { name: 'Marshmallow', ats: 'ashby', token: 'marshmallow', legal: 'Marshmallow Technology Ltd', sector: 'Insurtech' },
  { name: 'OakNorth', ats: 'ashby', token: 'oaknorth', legal: ['OakNorth Bank Plc', 'Oaknorth (UK) Limited'], sector: 'Bank' },
  { name: 'Multiverse', ats: 'ashby', token: 'multiverse', legal: 'Multiverse Group Limited', sector: 'EdTech' },
  { name: 'Vanta', ats: 'ashby', token: 'vanta', legal: 'Vanta Technology UK Limited', sector: 'GRC / compliance automation' },
  { name: 'Granola', ats: 'ashby', token: 'granola', legal: 'Granola Labs', sector: 'AI software' },
];

/** Universities named in the spec whose actual employing entity is on the register. They use careers
 *  sites without a public API, so they are tracked as watchlist entries with manual-import links. */
export const UNIVERSITY_WATCHLIST = [
  { name: 'University College London', legal: 'University College London', careers: 'https://www.ucl.ac.uk/work-at-ucl/search-ucl-jobs' },
  { name: "King's College London", legal: "King's College London", careers: 'https://www.kcl.ac.uk/jobs' },
  { name: 'Imperial College London', legal: 'Imperial College London (HR)', careers: 'https://www.imperial.ac.uk/jobs/' },
  { name: 'Queen Mary University of London', legal: 'Queen Mary University of London', careers: 'https://www.qmul.ac.uk/jobs/' },
  { name: 'London School of Economics', legal: 'The London School of Economics and Political Science', careers: 'https://jobs.lse.ac.uk/' },
  { name: 'University of Westminster', legal: 'University of Westminster', careers: 'https://www.westminster.ac.uk/about-us/jobs' },
  { name: "City St George's, University of London", legal: "City St George's, University of London", careers: 'https://www.citystgeorges.ac.uk/about/work-for-us' },
];
