// Official, key-based job/search APIs configured by the user. Nothing here works until the user saves
// their own key, and the UI says so ("Not configured").
//   Reed Jobseeker API   https://www.reed.co.uk/developers/jobseeker
//   Adzuna API           https://developer.adzuna.com/
//   Brave Search API     https://api.search.brave.com/app/documentation/web-search
import { getSecret, hasSecret } from '../../config/secrets.js';
import { politeFetch } from './http.js';
import type { DiscoveredJob, DiscoveryContext, DiscoveryPage, JobSourceAdapter } from './types.js';
import type { SearchIntent } from '../models.js';
import { buildBooleanQueries, buildRoleQueries } from '../discovery/intent.js';
import { htmlToText } from '../util/text.js';
import { boardForUrl } from './boards.js';
import { parseAtsUrl } from './ats.js';

function ukDate(s: string | null | undefined): string | null {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const loc = (i: SearchIntent) => (i.market === 'UAE' ? 'United Arab Emirates' : i.market === 'QATAR' ? 'Qatar' : i.market === 'SAUDI' ? 'Saudi Arabia'
  : i.location === 'LONDON' || i.location == null ? 'London' : 'United Kingdom');

export const reedAdapter: JobSourceAdapter = {
  id: 'reed', displayName: 'Reed.co.uk Jobseeker API', sourceHomepage: 'https://www.reed.co.uk/developers/jobseeker',
  mode: 'OFFICIAL_API', kind: 'API',
  description: 'Official Reed API (free key). Returns full job descriptions via the job-details endpoint. Many Reed ads are placed by agencies; those stay in review until the real employer is known.',
  async verifyAccess() {
    if (!hasSecret('reed_api_key')) return { status: 'NOT_CONFIGURED', message: 'Add a Reed API key in Settings to enable.', recommendedAction: 'Register at reed.co.uk/developers and paste the key in Settings → Sources.' };
    const key = await getSecret('reed_api_key');
    const r = await politeFetch('https://www.reed.co.uk/api/1.0/search?keywords=security&resultsToTake=1', { sourceId: 'reed', accept: 'application/json', headers: { Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64') }, retries: 0 });
    return r.ok ? { status: 'CONNECTED', message: 'Reed API key accepted.' } : { status: r.status === 401 ? 'AUTH_REQUIRED' : 'ERROR', message: r.error ?? `HTTP ${r.status}` };
  },
  async discover(intent: SearchIntent, ctx: DiscoveryContext): Promise<DiscoveryPage> {
    const key = await getSecret('reed_api_key');
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    if (!key) return out;
    const auth = { Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64') };
    for (const q of buildRoleQueries(intent, Math.min(6, ctx.budget.queriesLeft))) {
      if (ctx.shouldStop()) break;
      ctx.budget.queriesLeft--;
      const url = `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(q)}&locationName=${encodeURIComponent(loc(intent))}&distanceFromLocation=20&resultsToTake=50`;
      out.queries.push(`reed: ${q} @ ${loc(intent)}`);
      const r = await politeFetch(url, { sourceId: 'reed', accept: 'application/json', headers: auth });
      if (!r.ok) { out.errors.push(`Reed search "${q}": ${r.error ?? r.status}`); if (r.blocked) break; continue; }
      const results = JSON.parse(r.text).results ?? [];
      out.linksFound += results.length;
      for (const j of results) {
        out.jobs.push({
          sourceId: 'reed', sourceJobId: String(j.jobId), title: j.jobTitle, employer: j.employerName ?? null, location: j.locationName ?? null,
          boardUrl: j.jobUrl, employerUrl: null, applyUrl: j.jobUrl, applyUrlKind: 'BOARD', postedAt: ukDate(j.date), deadline: ukDate(j.expirationDate),
          salaryText: j.minimumSalary ? `£${j.minimumSalary}${j.maximumSalary ? `–£${j.maximumSalary}` : ''}` : null,
          descriptionText: j.jobDescription ?? null, descriptionComplete: false, extractionMethod: 'reed_api_search', accessMode: 'OFFICIAL_API', query: q,
        });
      }
    }
    return out;
  },
};

/** Fetch Reed's full description for a prefiltered job (called by the pipeline). */
export async function reedDetail(job: DiscoveredJob): Promise<DiscoveredJob> {
  const key = await getSecret('reed_api_key');
  if (!key || !job.sourceJobId) return job;
  const r = await politeFetch(`https://www.reed.co.uk/api/1.0/jobs/${encodeURIComponent(job.sourceJobId)}`, { sourceId: 'reed', accept: 'application/json', headers: { Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64') } });
  if (!r.ok) return job;
  const b = JSON.parse(r.text);
  const text = htmlToText(b.jobDescription ?? '');
  const ext = b.externalUrl && /^https:\/\//.test(b.externalUrl) ? b.externalUrl : null;
  return {
    ...job, descriptionText: text, descriptionComplete: text.length > 300, extractionMethod: 'reed_api_details',
    employerUrl: ext, applyUrl: ext ?? job.applyUrl, applyUrlKind: ext ? 'EMPLOYER_SITE' : 'BOARD',
    deadline: ukDate(b.expirationDate) ?? job.deadline,
    salaryText: job.salaryText ?? (b.salary ? String(b.salary) : null),
  };
}

export const adzunaAdapter: JobSourceAdapter = {
  id: 'adzuna', displayName: 'Adzuna API', sourceHomepage: 'https://developer.adzuna.com/',
  mode: 'OFFICIAL_API', kind: 'API',
  description: 'Official Adzuna aggregator API (free key). Provides title, employer and a snippet only — results stay in review until you read/paste the full JD.',
  async verifyAccess() {
    if (!hasSecret('adzuna_app_id') || !hasSecret('adzuna_app_key')) return { status: 'NOT_CONFIGURED', message: 'Add Adzuna app id + key in Settings to enable.' };
    const [id, key] = [await getSecret('adzuna_app_id'), await getSecret('adzuna_app_key')];
    const r = await politeFetch(`https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${id}&app_key=${key}&results_per_page=1&what=security`, { sourceId: 'adzuna', accept: 'application/json', retries: 0 });
    return r.ok ? { status: 'CONNECTED', message: 'Adzuna credentials accepted.' } : { status: r.status === 401 ? 'AUTH_REQUIRED' : 'ERROR', message: r.error ?? `HTTP ${r.status}` };
  },
  async discover(intent, ctx) {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const [id, key] = [await getSecret('adzuna_app_id'), await getSecret('adzuna_app_key')];
    if (!id || !key) return out;
    for (const q of buildRoleQueries(intent, Math.min(4, ctx.budget.queriesLeft))) {
      if (ctx.shouldStop()) break;
      ctx.budget.queriesLeft--;
      out.queries.push(`adzuna: ${q} @ ${loc(intent)}`);
      const url = `https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}&results_per_page=50&what=${encodeURIComponent(q)}&where=${encodeURIComponent(loc(intent))}&max_days_old=30`;
      const r = await politeFetch(url, { sourceId: 'adzuna', accept: 'application/json' });
      if (!r.ok) { out.errors.push(`Adzuna "${q}": ${r.error ?? r.status}`); if (r.blocked) break; continue; }
      const results = JSON.parse(r.text).results ?? [];
      out.linksFound += results.length;
      for (const j of results) {
        out.jobs.push({
          sourceId: 'adzuna', sourceJobId: String(j.id), title: htmlToText(j.title ?? ''), employer: j.company?.display_name ?? null,
          location: j.location?.display_name ?? null, boardUrl: j.redirect_url, employerUrl: null, applyUrl: j.redirect_url, applyUrlKind: 'BOARD',
          postedAt: j.created ?? null, deadline: null, salaryText: j.salary_min ? `£${Math.round(j.salary_min)}${j.salary_max ? `–£${Math.round(j.salary_max)}` : ''}` : null,
          descriptionText: htmlToText(j.description ?? ''), descriptionComplete: false, extractionMethod: 'adzuna_api_snippet', accessMode: 'OFFICIAL_API', query: q,
        });
      }
    }
    return out;
  },
};

export const joobleAdapter: JobSourceAdapter = {
  id: 'jooble', displayName: 'Jooble API (multi-board aggregator)', sourceHomepage: 'https://jooble.org/api/about',
  mode: 'OFFICIAL_API', kind: 'API',
  description: 'Official Jooble REST API (free key). Aggregates UK listings from many job boards and career sites; returns title, company, snippet and link. Full JD must be read from the employer page or pasted.',
  async verifyAccess() {
    if (!hasSecret('jooble_api_key')) return { status: 'NOT_CONFIGURED', message: 'Add a Jooble API key in Settings to enable.', recommendedAction: 'Request a free key at jooble.org/api/about.' };
    const key = await getSecret('jooble_api_key');
    const r = await politeFetch(`https://jooble.org/api/${encodeURIComponent(key!)}`, { sourceId: 'jooble', method: 'POST', body: JSON.stringify({ keywords: 'security analyst', location: 'London' }), headers: { 'Content-Type': 'application/json' }, accept: 'application/json', retries: 0 });
    return r.ok ? { status: 'CONNECTED', message: 'Jooble API key accepted.' } : { status: r.status === 403 || r.status === 401 ? 'AUTH_REQUIRED' : 'ERROR', message: r.error ?? `HTTP ${r.status}` };
  },
  async discover(intent, ctx) {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const key = await getSecret('jooble_api_key');
    if (!key) return out;
    for (const q of buildRoleQueries(intent, Math.min(6, ctx.budget.queriesLeft))) {
      if (ctx.shouldStop()) break;
      ctx.budget.queriesLeft--;
      out.queries.push(`jooble: ${q} @ ${loc(intent)}`);
      const r = await politeFetch(`https://jooble.org/api/${encodeURIComponent(key)}`, { sourceId: 'jooble', method: 'POST', body: JSON.stringify({ keywords: q, location: loc(intent), page: '1' }), headers: { 'Content-Type': 'application/json' }, accept: 'application/json' });
      if (!r.ok) { out.errors.push(`Jooble "${q}": ${r.error ?? r.status}`); if (r.blocked) break; continue; }
      const results = JSON.parse(r.text).jobs ?? [];
      out.linksFound += results.length;
      for (const j of results) {
        const link: string = j.link ?? '';
        const ats = parseAtsUrl(link);
        out.jobs.push({
          sourceId: 'jooble', sourceJobId: String(j.id ?? link), title: htmlToText(j.title ?? ''), employer: j.company || null, location: j.location ?? null,
          boardUrl: link, employerUrl: ats ? link : null, applyUrl: link, applyUrlKind: ats ? 'EMPLOYER_ATS' : 'BOARD', postedAt: j.updated ?? null, deadline: null,
          salaryText: j.salary || null, descriptionText: htmlToText(j.snippet ?? ''), descriptionComplete: false, extractionMethod: 'jooble_api_snippet', accessMode: 'OFFICIAL_API', query: q,
        });
      }
    }
    return out;
  },
};


/** Best-effort parse of search-result titles, e.g. "Acme hiring SOC Analyst in London | LinkedIn" or "SOC Analyst - Acme - London | Indeed.com". */
export function parseResultTitle(t: string, board: string | null): { title: string; employer: string | null; location: string | null } {
  // GulfTalent / Naukrigulf: "Title | Job in Dubai, UAE by Company | GulfTalent" (company may be cut off with "…").
  const jobIn = t.match(/^(.+?)\s*[|–-]\s*Jobs? in (.+?)\s+by\s+(.+?)(?:\s*[|–-]\s*(?:GulfTalent|Naukrigulf|Bayt)\S*)?\s*$/i);
  if (jobIn) {
    const emp = jobIn[3].replace(/\s*(\.\.\.|…)\s*$/, '').trim();
    return { title: jobIn[1].trim(), location: jobIn[2].trim(), employer: emp.length >= 3 && !/(\.\.\.|…)/.test(jobIn[3]) ? emp : (emp.length >= 3 ? emp : null) };
  }
  const clean = t.replace(/\s*[|–-]\s*(LinkedIn|Indeed(\.com)?|Bright Network|Gradcracker|targetjobs|Prospects(\.ac\.uk)?|higherin|The Trackr|Bayt(\.com)?|GulfTalent(\.com)?|Naukrigulf(\.com)?|Glassdoor|Totaljobs|CWJobs|Workday)\b.*$/i, '').trim();
  const li = clean.match(/^(.+?) hiring (.+?) in (.+)$/i);
  if (li) return { employer: li[1].trim(), title: li[2].trim(), location: li[3].trim() };
  // "Title at Company" (Glassdoor/LinkedIn variants)
  const at = clean.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+(.+))?$/i);
  if (at && board && board !== 'indeed') return { title: at[1].trim(), employer: at[2].trim(), location: at[3]?.trim() ?? null };
  const parts = clean.split(/\s+[-–|]\s+/);
  // "Title - Company - City" (Indeed, Bayt, GulfTalent, NaukriGulf, Totaljobs…)
  if (board && parts.length >= 3) return { title: parts[0], employer: parts[1], location: parts.slice(2).join(', ') };
  if (board && board !== 'linkedin' && parts.length === 2) return { title: parts[0], employer: parts[1], location: null };
  return { title: parts[0] ?? clean, employer: null, location: null };
}

/** Google cannot be queried programmatically here; we only build links to open in the user's browser. */
export function googleQueryLinks(intent: SearchIntent): Array<{ label: string; url: string }> {
  return buildBooleanQueries(intent).map((q) => ({ label: `Open in Google: ${q.slice(0, 80)}…`, url: `https://www.google.com/search?q=${encodeURIComponent(q)}` }));
}
