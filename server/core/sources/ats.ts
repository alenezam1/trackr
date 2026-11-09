// Public ATS job-board APIs. These are documented, unauthenticated endpoints that employers publish
// for embedding their own job boards:
//   Greenhouse Job Board API  https://developers.greenhouse.io/job-board.html
//   Lever Postings API        https://github.com/lever/postings-api
//   Ashby Job Postings API    https://developers.ashbyhq.com/docs/public-job-posting-api
//   SmartRecruiters Posting API https://developers.smartrecruiters.com/docs/posting-api
//   Recruitee careers-site API  https://{company}.recruitee.com/api/offers/ (no auth, documented by Recruitee)
//   Personio XML job feed       https://{company}.jobs.personio.de/xml (documented by Personio support)
//   Teamtailor public RSS       https://{company}.teamtailor.com/jobs.rss
//   Workable public widget API  https://apply.workable.com/api/v1/widget/accounts/{account}
import * as cheerio from 'cheerio';
import { politeFetch } from './http.js';
import type { DiscoveredJob } from './types.js';
import { htmlToText } from '../util/text.js';

export type AtsType = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'recruitee' | 'personio' | 'teamtailor' | 'workable';
export const ATS_TYPES: AtsType[] = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'personio', 'teamtailor', 'workable'];
/** ATS types cheap enough to probe by guessing names (one request per slug). Workable rate-limits guessing,
 *  so Workable boards are added from careers-page links or by URL instead. */
export const PROBE_ATS: AtsType[] = ['greenhouse', 'lever', 'ashby', 'recruitee', 'personio', 'teamtailor'];

export interface AtsEmployer { id: number; canonical_name: string; ats_type: AtsType; ats_token: string }

export interface AtsListing {
  ok: boolean; status: number; error?: string; blocked?: boolean;
  jobs: DiscoveredJob[];
  /** Jobs needing a second call for the full description (SmartRecruiters). */
  needsDetail?: boolean;
}

const base = (e: AtsEmployer, j: Partial<DiscoveredJob>): DiscoveredJob => ({
  sourceId: `ats_${e.ats_type}`, sourceJobId: null, title: '', employer: e.canonical_name, employerId: e.id, location: null,
  boardUrl: null, employerUrl: null, applyUrl: null, applyUrlKind: 'EMPLOYER_ATS', postedAt: null, deadline: null, salaryText: null,
  descriptionText: null, descriptionComplete: false, extractionMethod: `${e.ats_type}_public_api`, accessMode: 'PUBLIC_ATS', ...j,
});

export async function listAtsJobs(e: AtsEmployer): Promise<AtsListing> {
  const tok = encodeURIComponent(e.ats_token);
  switch (e.ats_type) {
    case 'greenhouse': {
      const r = await politeFetch(`https://boards-api.greenhouse.io/v1/boards/${tok}/jobs?content=true`, { sourceId: 'ats_greenhouse', accept: 'application/json', maxBytes: 40e6 });
      if (!r.ok) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const body = JSON.parse(r.text);
      const jobs = (body.jobs ?? []).map((j: any) => {
        const text = htmlToText(j.content ?? '');
        return base(e, {
          sourceJobId: `${e.ats_token}:${j.id}`, title: j.title, location: j.location?.name ?? null,
          employerUrl: j.absolute_url, applyUrl: j.absolute_url, postedAt: j.first_published ?? j.updated_at ?? null,
          descriptionText: text, descriptionComplete: text.length > 300,
        });
      });
      return { ok: true, status: r.status, jobs };
    }
    case 'lever': {
      const r = await politeFetch(`https://api.lever.co/v0/postings/${tok}?mode=json`, { sourceId: 'ats_lever', accept: 'application/json', maxBytes: 40e6 });
      if (!r.ok) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const arr = JSON.parse(r.text);
      const jobs = (Array.isArray(arr) ? arr : []).map((j: any) => {
        const parts = [j.descriptionPlain ?? htmlToText(j.description ?? '')];
        for (const l of j.lists ?? []) parts.push(`${l.text}:\n${htmlToText(l.content ?? '')}`);
        parts.push(j.additionalPlain ?? htmlToText(j.additional ?? ''));
        const text = parts.filter(Boolean).join('\n\n').trim();
        const sal = j.salaryRange ? `${j.salaryRange.currency ?? ''} ${j.salaryRange.min ?? ''}-${j.salaryRange.max ?? ''} ${j.salaryRange.interval ?? ''}`.trim() : null;
        return base(e, {
          sourceJobId: `${e.ats_token}:${j.id}`, title: j.text, location: [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join('; ') || null,
          employerUrl: j.hostedUrl, applyUrl: j.applyUrl ?? j.hostedUrl, postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
          salaryText: sal, descriptionText: `${j.categories?.commitment ? `Commitment: ${j.categories.commitment}\n` : ''}${text}`, descriptionComplete: text.length > 300,
        });
      });
      return { ok: true, status: r.status, jobs };
    }
    case 'ashby': {
      const r = await politeFetch(`https://api.ashbyhq.com/posting-api/job-board/${tok}?includeCompensation=true`, { sourceId: 'ats_ashby', accept: 'application/json', maxBytes: 40e6 });
      if (!r.ok) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const body = JSON.parse(r.text);
      const jobs = (body.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => {
        const text = j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? '');
        const locs = [j.location, ...(j.secondaryLocations ?? []).map((s: any) => s.location)].filter(Boolean);
        return base(e, {
          sourceJobId: `${e.ats_token}:${j.id}`, title: j.title, location: [locs.join('; '), j.isRemote ? '(Remote)' : ''].filter(Boolean).join(' ') || null,
          employerUrl: j.jobUrl, applyUrl: j.applyUrl ?? j.jobUrl, postedAt: j.publishedAt ?? null,
          salaryText: j.compensation?.compensationTierSummary ?? null,
          descriptionText: `${j.employmentType ? `Employment type: ${j.employmentType}\n` : ''}${text}`, descriptionComplete: (text ?? '').length > 300,
        });
      });
      return { ok: true, status: r.status, jobs };
    }
    case 'smartrecruiters': {
      const r = await politeFetch(`https://api.smartrecruiters.com/v1/companies/${tok}/postings?limit=100&country=gb`, { sourceId: 'ats_smartrecruiters', accept: 'application/json' });
      if (!r.ok) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const body = JSON.parse(r.text);
      const jobs = (body.content ?? []).map((j: any) => base(e, {
        sourceJobId: `${e.ats_token}:${j.id}`, title: j.name,
        location: [j.location?.city, j.location?.region, j.location?.country?.toUpperCase() === 'GB' ? 'United Kingdom' : j.location?.country, j.location?.remote ? 'Remote' : null].filter(Boolean).join(', '),
        employerUrl: `https://jobs.smartrecruiters.com/${tok}/${j.id}`, applyUrl: `https://jobs.smartrecruiters.com/${tok}/${j.id}`,
        postedAt: j.releasedDate ?? null, descriptionText: null, descriptionComplete: false,
      }));
      return { ok: true, status: r.status, jobs, needsDetail: true };
    }
    case 'recruitee': {
      const r = await politeFetch(`https://${tok}.recruitee.com/api/offers/`, { sourceId: 'ats_recruitee', accept: 'application/json', maxBytes: 40e6, retries: 1 });
      if (!r.ok || !r.contentType.includes('json')) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const offers = JSON.parse(r.text).offers ?? [];
      const jobs = offers.map((o: any) => {
        const tr = o.translations?.en ?? {};
        const text = [htmlToText(o.description ?? tr.description ?? ''), htmlToText(o.requirements ?? tr.requirements ?? '')].filter(Boolean).join('\n\n');
        const loc = [o.city, o.country ?? o.country_code, o.remote ? 'Remote' : null].filter(Boolean).join(', ') || o.location || null;
        return base(e, {
          sourceJobId: `${e.ats_token}:${o.id ?? o.guid}`, title: o.title ?? tr.title ?? 'Untitled', location: loc,
          employerUrl: o.careers_url, applyUrl: o.careers_apply_url ?? o.careers_url, postedAt: o.published_at ?? o.created_at ?? null,
          salaryText: o.salary?.min ? `${o.salary.currency ?? ''} ${o.salary.min}-${o.salary.max ?? ''} ${o.salary.period ?? ''}`.trim() : null,
          descriptionText: `${o.employment_type_code ? `Employment type: ${o.employment_type_code}\n` : ''}${text}`, descriptionComplete: text.length > 300,
        });
      });
      return { ok: true, status: r.status, jobs };
    }
    case 'personio': {
      let r = await politeFetch(`https://${tok}.jobs.personio.de/xml?language=en`, { sourceId: 'ats_personio', accept: 'application/xml', retries: 1 });
      if (!r.ok) r = await politeFetch(`https://${tok}.jobs.personio.com/xml?language=en`, { sourceId: 'ats_personio', accept: 'application/xml', retries: 0 });
      if (!r.ok || !r.text.includes('<workzag-jobs')) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const host = new URL(r.url).host;
      const $ = cheerio.load(r.text, { xmlMode: true });
      const jobs = $('position').map((_, p) => {
        const P = $(p);
        const id = P.children('id').text().trim();
        const offices = [P.children('office').text().trim(), ...P.find('additionalOffices office').map((__, o) => $(o).text().trim()).get()].filter(Boolean);
        const text = P.find('jobDescription').map((__, d) => `${$(d).children('name').text().trim()}\n${htmlToText($(d).children('value').text())}`).get().join('\n\n');
        const url = `https://${host}/job/${id}`;
        return base(e, {
          sourceJobId: `${e.ats_token}:${id}`, title: P.children('name').text().trim(), location: offices.join('; ') || null,
          employerUrl: url, applyUrl: url, postedAt: P.children('createdAt').text().trim() || null, legalEmployerHint: P.children('subcompany').text().trim() || null,
          descriptionText: `Employment type: ${P.children('employmentType').text().trim()} ${P.children('schedule').text().trim()}\n${text}`, descriptionComplete: text.length > 300,
        });
      }).get();
      return { ok: true, status: r.status, jobs };
    }
    case 'teamtailor': {
      const r = await politeFetch(`https://${tok}.teamtailor.com/jobs.rss`, { sourceId: 'ats_teamtailor', accept: 'application/rss+xml', maxBytes: 40e6, retries: 1 });
      if (!r.ok || !r.text.includes('<rss')) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const $ = cheerio.load(r.text, { xmlMode: true });
      const jobs = $('item').map((_, it) => {
        const I = $(it);
        const link = I.children('link').text().trim();
        const locs = I.find('tt\\:location, location').map((__, l) => [$(l).find('tt\\:city, city').text().trim(), $(l).find('tt\\:country, country').text().trim()].filter(Boolean).join(', ')).get().filter(Boolean);
        const remote = I.find('remoteStatus, tt\\:remoteStatus').text().trim();
        const text = htmlToText(I.children('description').text());
        return base(e, {
          sourceJobId: `${e.ats_token}:${I.children('guid').text().trim() || link}`, title: I.children('title').text().trim(),
          location: [locs.join('; '), remote && remote !== 'none' ? `(${remote})` : ''].filter(Boolean).join(' ') || null,
          employerUrl: link, applyUrl: link, postedAt: I.children('pubDate').text().trim() ? new Date(I.children('pubDate').text().trim()).toISOString() : null,
          descriptionText: text, descriptionComplete: text.length > 300,
        });
      }).get();
      return { ok: true, status: r.status, jobs };
    }
    case 'workable': {
      // Workable rate-limits aggressively: space requests out more.
      const r = await politeFetch(`https://apply.workable.com/api/v1/widget/accounts/${tok}?details=true`, { sourceId: 'ats_workable', accept: 'application/json', maxBytes: 40e6, retries: 1, delayMs: 2500 });
      if (!r.ok) return { ok: false, status: r.status, error: r.error ?? `HTTP ${r.status}`, blocked: r.blocked, jobs: [] };
      const body = JSON.parse(r.text);
      const jobs = (body.jobs ?? []).map((j: any) => {
        const text = [htmlToText(j.description ?? ''), htmlToText(j.requirements ?? ''), htmlToText(j.benefits ?? '')].filter(Boolean).join('\n\n');
        const loc = [j.city, j.state, j.country, j.telecommuting ? 'Remote' : null].filter(Boolean).join(', ') || (j.locations ?? []).map((l: any) => [l.city, l.country].filter(Boolean).join(', ')).join('; ') || null;
        const url = j.url ?? j.shortlink ?? `https://apply.workable.com/${tok}/j/${j.shortcode}/`;
        return base(e, {
          sourceJobId: `${e.ats_token}:${j.shortcode ?? j.id ?? url}`, title: j.title, location: loc, employerUrl: url, applyUrl: j.application_url ?? url,
          postedAt: j.published_on ?? j.created_at ?? null, descriptionText: `${j.employment_type ? `Employment type: ${j.employment_type}\n` : ''}${text}`,
          descriptionComplete: text.length > 300,
        });
      });
      return { ok: true, status: r.status, jobs, needsDetail: jobs.some((x: DiscoveredJob) => !x.descriptionComplete) };
    }
  }
}

/** Second call for ATS types whose list endpoint omits the description. */
export async function fetchAtsDetail(e: AtsEmployer, job: DiscoveredJob): Promise<DiscoveredJob> {
  if (e.ats_type === 'workable' && job.sourceJobId) {
    const code = job.sourceJobId.split(':').slice(1).join(':');
    const r = await politeFetch(`https://apply.workable.com/api/v2/accounts/${encodeURIComponent(e.ats_token)}/jobs/${encodeURIComponent(code)}`, { sourceId: 'ats_workable', accept: 'application/json' });
    if (!r.ok) return job;
    const b = JSON.parse(r.text);
    const text = [htmlToText(b.description ?? ''), htmlToText(b.requirements ?? ''), htmlToText(b.benefits ?? '')].filter(Boolean).join('\n\n');
    return { ...job, descriptionText: text || job.descriptionText, descriptionComplete: text.length > 300 };
  }
  if (e.ats_type !== 'smartrecruiters' || !job.sourceJobId) return job;
  const id = job.sourceJobId.split(':').slice(1).join(':');
  const r = await politeFetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(e.ats_token)}/postings/${encodeURIComponent(id)}`, { sourceId: 'ats_smartrecruiters', accept: 'application/json' });
  if (!r.ok) return job;
  const b = JSON.parse(r.text);
  const sec = b.jobAd?.sections ?? {};
  const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
    .map((k) => sec[k] ? `${sec[k].title ?? ''}\n${htmlToText(sec[k].text ?? '')}` : '').filter(Boolean).join('\n\n').trim();
  return { ...job, descriptionText: text, descriptionComplete: text.length > 300, applyUrl: b.applyUrl ?? job.applyUrl, employerUrl: b.postingUrl ?? job.employerUrl };
}

/** Recognise public ATS posting/board URLs so a user-shared or search-discovered link resolves to the official API. */
export function parseAtsUrl(url: string): { ats: AtsType; token: string; jobId: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const seg = u.pathname.split('/').filter(Boolean);
  const h = u.hostname.toLowerCase();
  if (/(^|\.)greenhouse\.io$/.test(h) && seg.length) {
    // boards.greenhouse.io/{token}/jobs/{id}  |  job-boards.greenhouse.io/{token}/jobs/{id}  |  ?for=token&token=id (embed)
    const forTok = u.searchParams.get('for');
    if (forTok) return { ats: 'greenhouse', token: forTok, jobId: u.searchParams.get('token') };
    if (seg[0] === 'embed') return null;
    return { ats: 'greenhouse', token: seg[0], jobId: seg[1] === 'jobs' && seg[2] ? seg[2] : null };
  }
  if (h === 'jobs.lever.co' || h === 'jobs.eu.lever.co') return seg.length ? { ats: 'lever', token: seg[0], jobId: seg[1] ?? null } : null;
  if (h === 'jobs.ashbyhq.com') return seg.length ? { ats: 'ashby', token: seg[0], jobId: seg[1] ?? null } : null;
  if (h === 'jobs.smartrecruiters.com' || h === 'careers.smartrecruiters.com') return seg.length ? { ats: 'smartrecruiters', token: seg[0], jobId: seg[1] ?? null } : null;
  let m = h.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (m) return { ats: 'recruitee', token: m[1], jobId: seg[0] === 'o' && seg[1] ? seg[1] : null };
  m = h.match(/^([a-z0-9-]+)\.jobs\.personio\.(de|com)$/);
  if (m) return { ats: 'personio', token: m[1], jobId: seg[0] === 'job' && seg[1] ? seg[1] : null };
  m = h.match(/^([a-z0-9-]+)\.teamtailor\.com$/);
  if (m) return { ats: 'teamtailor', token: m[1], jobId: seg[0] === 'jobs' && seg[1] ? seg[1] : null };
  if (h === 'apply.workable.com' && seg.length) return { ats: 'workable', token: seg[0], jobId: seg[1] === 'j' && seg[2] ? seg[2] : null };
  return null;
}
