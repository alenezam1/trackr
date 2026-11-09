// Canonical JD acquisition for user-shared links and pasted text (spec §6). Board pages that forbid
// automated access are NEVER fetched; employer pages are fetched only when robots.txt allows.
import * as cheerio from 'cheerio';
import { politeFetch, robotsAllows } from '../sources/http.js';
import { fetchAtsDetail, listAtsJobs, parseAtsUrl, type AtsType } from '../sources/ats.js';
import { boardForUrl, READABLE_BOARDS } from '../sources/boards.js';
import type { DiscoveredJob } from '../sources/types.js';
import { htmlToText, isSafeHttpUrl } from '../util/text.js';

export interface JsonLdJob {
  title?: string; description?: string; hiringOrganization?: { name?: string; legalName?: string; sameAs?: string };
  jobLocation?: any; datePosted?: string; validThrough?: string; employmentType?: string | string[]; baseSalary?: any; directApply?: boolean; url?: string;
}

export function extractJsonLdJobPosting(html: string): JsonLdJob | null {
  const $ = cheerio.load(html);
  const blocks = $('script[type="application/ld+json"]').map((_, el) => $(el).text()).get();
  for (const b of blocks) {
    try {
      const data = JSON.parse(b);
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const it of items) {
        const t = it['@type'];
        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return it as JsonLdJob;
      }
    } catch { /* malformed JSON-LD is ignored */ }
  }
  return null;
}

function jsonLdLocation(loc: any): string | null {
  const arr = Array.isArray(loc) ? loc : loc ? [loc] : [];
  const parts = arr.map((l: any) => {
    const a = l?.address ?? {};
    return [a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].filter(Boolean).join(', ');
  }).filter(Boolean);
  return parts.join('; ') || null;
}

export interface ImportOutcome { job: DiscoveredJob | null; message: string; atsRef?: { ats: AtsType; token: string } }

export async function importFromUrl(url: string, pastedText?: string | null, overrides: Partial<DiscoveredJob> = {}): Promise<ImportOutcome> {
  if (!isSafeHttpUrl(url)) return { job: null, message: 'Only http(s) URLs can be imported.' };
  const ats = parseAtsUrl(url);
  if (ats?.jobId) {
    const j = await fetchSingleAtsJob(ats.ats, ats.token, ats.jobId, url);
    if (j) return { job: { ...j, ...nonNull(overrides) }, message: `Read the full JD through the public ${ats.ats} API.`, atsRef: { ats: ats.ats, token: ats.token } };
  }
  const board = boardForUrl(url);
  const base: DiscoveredJob = {
    sourceId: board ?? 'user_link', sourceJobId: url, title: overrides.title ?? 'Imported job', employer: overrides.employer ?? null, location: overrides.location ?? null,
    boardUrl: board ? url : null, employerUrl: board ? null : url, applyUrl: url, applyUrlKind: board ? 'BOARD' : 'EMPLOYER_SITE', postedAt: null, deadline: null,
    salaryText: null, descriptionText: null, descriptionComplete: false, extractionMethod: 'user_shared_link', accessMode: 'USER_SHARED_LINK',
  };
  if (pastedText && pastedText.trim().length > 50) {
    return { job: { ...base, ...nonNull(overrides), descriptionText: pastedText.trim(), descriptionComplete: pastedText.trim().length > 300, extractionMethod: 'user_pasted_text', accessMode: 'MANUAL_IMPORT' }, message: 'Using the JD text you pasted.' };
  }
  if (board && !READABLE_BOARDS.has(board)) {
    return { job: { ...base, ...nonNull(overrides) }, message: `${board} pages are not fetched automatically. The link is saved; paste the full JD text to analyse it.` };
  }
  const robots = await robotsAllows(url);
  if (!robots.allowed) return { job: { ...base, ...nonNull(overrides) }, message: `${robots.reason}. Saved the link; paste the JD text to analyse it.` };
  const r = await politeFetch(url, { sourceId: `site:${new URL(url).host}`, accept: 'text/html' });
  if (!r.ok) return { job: { ...base, ...nonNull(overrides), listingState: r.status === 404 || r.status === 410 ? 'CLOSED' : 'UNKNOWN' }, message: `Could not read the page (${r.error ?? 'HTTP ' + r.status}). Paste the JD text instead.` };
  const ld = extractJsonLdJobPosting(r.text);
  if (ld) {
    const text = htmlToText(ld.description ?? '');
    return {
      job: {
        ...base,
        title: ld.title ?? base.title, employer: ld.hiringOrganization?.name ?? base.employer, legalEmployerHint: ld.hiringOrganization?.legalName ?? null,
        location: jsonLdLocation(ld.jobLocation) ?? base.location, postedAt: ld.datePosted ?? null, deadline: ld.validThrough ? ld.validThrough.slice(0, 10) : null,
        descriptionText: text, descriptionComplete: text.length > 300, extractionMethod: 'jsonld_jobposting', accessMode: 'PERMITTED_PUBLIC_HTML',
        ...nonNull(overrides),
      },
      message: 'Read the JobPosting structured data from the employer page.',
    };
  }
  const $ = cheerio.load(r.text);
  const title = $('h1').first().text().trim() || $('title').text().trim();
  const main = $('main').html() ?? $('article').html() ?? $('body').html() ?? '';
  const text = htmlToText(main);
  return {
    job: { ...base, title: title || base.title, descriptionText: text, descriptionComplete: text.length > 800, extractionMethod: 'semantic_html', accessMode: 'PERMITTED_PUBLIC_HTML', ...nonNull(overrides) },
    message: text.length > 800 ? 'Read the page text (no structured data); check the evidence view.' : 'Page had little readable text; paste the JD to complete the analysis.',
  };
}

function nonNull<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '')) as Partial<T>;
}

export async function fetchSingleAtsJob(ats: AtsType, token: string, jobId: string, url: string): Promise<DiscoveredJob | null> {
  const t = encodeURIComponent(token); const id = encodeURIComponent(jobId);
  const common = { sourceId: `ats_${ats}`, sourceJobId: `${token}:${jobId}`, employerUrl: url, applyUrlKind: 'EMPLOYER_ATS' as const, boardUrl: null, accessMode: 'PUBLIC_ATS' as const, deadline: null, salaryText: null };
  if (ats === 'greenhouse') {
    const r = await politeFetch(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs/${id}`, { sourceId: 'ats_greenhouse', accept: 'application/json' });
    if (!r.ok) return r.status === 404 ? { ...common, title: 'Closed posting', employer: token, location: null, applyUrl: url, postedAt: null, descriptionText: null, descriptionComplete: false, extractionMethod: 'greenhouse_public_api', listingState: 'CLOSED' } : null;
    const j = JSON.parse(r.text);
    const text = htmlToText(j.content ?? '');
    return { ...common, title: j.title, employer: j.company_name ?? token, location: j.location?.name ?? null, applyUrl: j.absolute_url ?? url, postedAt: j.first_published ?? j.updated_at ?? null, descriptionText: text, descriptionComplete: text.length > 300, extractionMethod: 'greenhouse_public_api' };
  }
  if (ats === 'lever') {
    const r = await politeFetch(`https://api.lever.co/v0/postings/${t}/${id}?mode=json`, { sourceId: 'ats_lever', accept: 'application/json' });
    if (!r.ok) return null;
    const j = JSON.parse(r.text);
    const parts = [j.descriptionPlain ?? '', ...(j.lists ?? []).map((l: any) => `${l.text}:\n${htmlToText(l.content ?? '')}`), j.additionalPlain ?? ''];
    const text = parts.join('\n\n').trim();
    return { ...common, title: j.text, employer: token, location: j.categories?.location ?? null, applyUrl: j.applyUrl ?? j.hostedUrl ?? url, postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null, descriptionText: text, descriptionComplete: text.length > 300, extractionMethod: 'lever_public_api' };
  }
  if (ats === 'ashby') {
    const r = await politeFetch(`https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`, { sourceId: 'ats_ashby', accept: 'application/json' });
    if (!r.ok) return null;
    const j = (JSON.parse(r.text).jobs ?? []).find((x: any) => x.id === jobId);
    if (!j) return { ...common, title: 'Closed posting', employer: token, location: null, applyUrl: url, postedAt: null, descriptionText: null, descriptionComplete: false, extractionMethod: 'ashby_public_api', listingState: 'CLOSED' };
    const text = j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? '');
    return { ...common, title: j.title, employer: token, location: j.location ?? null, applyUrl: j.applyUrl ?? j.jobUrl ?? url, postedAt: j.publishedAt ?? null, salaryText: j.compensation?.compensationTierSummary ?? null, descriptionText: text, descriptionComplete: text.length > 300, extractionMethod: 'ashby_public_api' };
  }
  if (ats === 'smartrecruiters') {
    const r = await politeFetch(`https://api.smartrecruiters.com/v1/companies/${t}/postings/${id}`, { sourceId: 'ats_smartrecruiters', accept: 'application/json' });
    if (!r.ok) return null;
    const b = JSON.parse(r.text);
    const sec = b.jobAd?.sections ?? {};
    const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation'].map((k) => sec[k] ? `${sec[k].title ?? ''}\n${htmlToText(sec[k].text ?? '')}` : '').join('\n\n').trim();
    return { ...common, title: b.name, employer: b.company?.name ?? token, location: [b.location?.city, b.location?.country].filter(Boolean).join(', '), applyUrl: b.applyUrl ?? url, postedAt: b.releasedDate ?? null, descriptionText: text, descriptionComplete: text.length > 300, extractionMethod: 'smartrecruiters_public_api' };
  }
  // Recruitee / Personio / Teamtailor / Workable: read the company feed and pick the posting.
  const listing = await listAtsJobs({ id: 0, canonical_name: token, ats_type: ats, ats_token: token });
  if (!listing.ok) return null;
  const hit = listing.jobs.find((j) => j.sourceJobId?.endsWith(`:${jobId}`) || j.employerUrl === url || (j.employerUrl ?? '').includes(jobId));
  if (!hit) return { ...common, title: 'Closed posting', employer: token, location: null, applyUrl: url, postedAt: null, descriptionText: null, descriptionComplete: false, extractionMethod: `${ats}_public_api`, listingState: 'CLOSED' };
  const full = listing.needsDetail && !hit.descriptionComplete ? await fetchAtsDetail({ id: 0, canonical_name: token, ats_type: ats, ats_token: token }, hit) : hit;
  return { ...full, employerId: null, employer: token };
}
