// Free, key-less public job feeds (all verified responding on 2026-10-14):
//   NHS Jobs RSS        https://www.jobs.nhs.uk/api/v1/search_rss   (official NHSBSA feed; detail pages read only if robots.txt allows)
//   Arbeitnow API       https://www.arbeitnow.com/api/job-board-api (no key; filtered to UK locations)
//   Himalayas API       https://himalayas.app/jobs/api/search       (no key; attribution: source link kept on every job)
//   HN "Who is hiring"  https://hn.algolia.com/api/v1               (no key; monthly thread comments, UK/remote-EU only)
import * as cheerio from 'cheerio';
import { politeFetch, robotsAllows } from './http.js';
import type { DiscoveredJob, DiscoveryContext, DiscoveryPage, JobSourceAdapter } from './types.js';
import type { SearchIntent } from '../models.js';
import { htmlToText } from '../util/text.js';
import { classifyLocation } from '../extraction/classify.js';

const ukOrRemote = (loc: string | null | undefined) => ['LONDON', 'UK', 'UK_REMOTE'].includes(classifyLocation(loc));
const job = (p: Partial<DiscoveredJob> & Pick<DiscoveredJob, 'sourceId' | 'title'>): DiscoveredJob => ({
  sourceJobId: null, employer: null, location: null, boardUrl: null, employerUrl: null, applyUrl: null, applyUrlKind: 'BOARD',
  postedAt: null, deadline: null, salaryText: null, descriptionText: null, descriptionComplete: false, extractionMethod: p.sourceId, accessMode: 'OFFICIAL_API', ...p,
});

const NHS_KEYWORDS: Record<string, string[]> = {
  SOC_SECURITY: ['cyber security', 'information security', 'security analyst'],
  GRC_RISK_AUDIT: ['information governance', 'cyber assurance', 'IT audit'],
  IT_TECHNICAL: ['IT support', 'service desk', 'infrastructure engineer', 'network engineer', 'desktop support'],
};

export const nhsAdapter: JobSourceAdapter = {
  id: 'nhs_jobs', displayName: 'NHS Jobs (official RSS)', sourceHomepage: 'https://www.jobs.nhs.uk/', mode: 'AUTHORISED_FEED', kind: 'API',
  description: 'Official NHS Jobs RSS feed (NHSBSA). Most NHS trusts are licensed sponsors and hire IT, cyber and information-governance staff. Full adverts are read from jobs.nhs.uk when robots.txt allows.',
  async verifyAccess() {
    const r = await politeFetch('https://www.jobs.nhs.uk/api/v1/search_rss?keyword=cyber', { sourceId: 'nhs_jobs', accept: 'application/rss+xml', retries: 0 });
    return r.ok ? { status: 'CONNECTED', message: 'NHS Jobs RSS feed responded.' } : { status: 'ERROR', message: r.error ?? `HTTP ${r.status}` };
  },
  async discover(intent: SearchIntent, ctx: DiscoveryContext): Promise<DiscoveryPage> {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const seen = new Set<string>();
    const kws = intent.categories.flatMap((c) => NHS_KEYWORDS[c] ?? []);
    for (const kw of kws) {
      if (ctx.shouldStop()) break;
      const loc = intent.location === 'LONDON' || intent.location == null ? '&location=London' : '';
      const url = `https://www.jobs.nhs.uk/api/v1/search_rss?keyword=${encodeURIComponent(kw)}${loc}`;
      out.queries.push(`nhs: ${kw}${loc ? ' @ London' : ''}`);
      const r = await politeFetch(url, { sourceId: 'nhs_jobs', accept: 'application/rss+xml' });
      if (!r.ok) { out.errors.push(`NHS Jobs "${kw}": ${r.error ?? r.status}`); continue; }
      const $ = cheerio.load(r.text, { xmlMode: true });
      $('item').each((_, it) => {
        const I = $(it);
        const link = I.children('link').text().trim();
        if (!link || seen.has(link)) return;
        seen.add(link);
        out.linksFound++;
        const closing = I.children('closingDate').text().trim();
        out.jobs.push(job({
          sourceId: 'nhs_jobs', sourceJobId: link.split('/').pop() ?? link, title: I.children('title').text().trim(), employer: I.children('author').text().trim() || null,
          boardUrl: link, employerUrl: link, applyUrl: link, applyUrlKind: 'EMPLOYER_SITE', location: loc ? 'London, United Kingdom' : 'England, United Kingdom',
          postedAt: I.children('pubDate').text().trim() ? new Date(I.children('pubDate').text().trim()).toISOString() : null,
          deadline: closing ? new Date(closing).toISOString().slice(0, 10) : null,
          descriptionText: I.children('description').text().trim(), extractionMethod: 'nhs_rss', accessMode: 'AUTHORISED_FEED', query: kw,
        }));
      });
    }
    return out;
  },
};

/** Read the full NHS advert page (robots.txt checked) for a prefiltered job. */
export async function nhsDetail(d: DiscoveredJob): Promise<DiscoveredJob> {
  if (!d.boardUrl) return d;
  const rb = await robotsAllows(d.boardUrl);
  if (!rb.allowed) return d;
  const r = await politeFetch(d.boardUrl, { sourceId: 'nhs_jobs_pages', accept: 'text/html', delayMs: 1200 });
  if (!r.ok) return d;
  const $ = cheerio.load(r.text);
  const text = htmlToText($('main').html() ?? $('body').html() ?? '');
  const t = (sel: string) => $(sel).first().text().replace(/\s+/g, ' ').trim();
  const loc = [t('#employer_town'), t('#employer_country')].filter(Boolean).join(', ');
  const salary = t('#fixed_salary') || t('#range_salary') || t('[id*="salary"]');
  return {
    ...d, descriptionText: text || d.descriptionText, descriptionComplete: text.length > 1200, extractionMethod: 'nhs_advert_page',
    location: loc || d.location, salaryText: salary || d.salaryText, employer: t('#employer_name') || d.employer,
  };
}

export const arbeitnowAdapter: JobSourceAdapter = {
  id: 'arbeitnow', displayName: 'Arbeitnow (free API)', sourceHomepage: 'https://www.arbeitnow.com/blog/job-board-api/', mode: 'OFFICIAL_API', kind: 'API',
  description: 'Free key-less job board API fed by employer ATSs (Greenhouse, SmartRecruiters, Join…). Mostly EU; the app keeps UK / UK-remote roles only and includes the visa-sponsorship flag when present.',
  async verifyAccess() {
    const r = await politeFetch('https://www.arbeitnow.com/api/job-board-api?page=1', { sourceId: 'arbeitnow', accept: 'application/json', retries: 0, maxBytes: 20e6 });
    return r.ok ? { status: 'CONNECTED', message: 'Arbeitnow API responded.' } : { status: 'ERROR', message: r.error ?? `HTTP ${r.status}` };
  },
  async discover(_intent, ctx) {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    for (let page = 1; page <= 3 && !ctx.shouldStop(); page++) {
      const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
      out.queries.push(`arbeitnow: page ${page}`);
      const r = await politeFetch(url, { sourceId: 'arbeitnow', accept: 'application/json', maxBytes: 20e6, delayMs: 1500 });
      if (!r.ok) { out.errors.push(`Arbeitnow page ${page}: ${r.error ?? r.status}`); break; }
      const data = JSON.parse(r.text).data ?? [];
      out.linksFound += data.length;
      for (const j of data) {
        const loc = `${j.location ?? ''}${j.remote ? ' (Remote)' : ''}`;
        if (!ukOrRemote(loc)) continue;
        const text = htmlToText(j.description ?? '');
        out.jobs.push(job({
          sourceId: 'arbeitnow', sourceJobId: j.slug, title: j.title, employer: j.company_name, location: loc, boardUrl: j.url, applyUrl: j.url,
          postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
          descriptionText: `${j.visa_sponsorship ? 'Visa sponsorship is available for this position (Arbeitnow listing flag).\n' : ''}${text}`, descriptionComplete: text.length > 300,
          extractionMethod: 'arbeitnow_api',
        }));
      }
      if (!data.length) break;
    }
    return out;
  },
};

export const himalayasAdapter: JobSourceAdapter = {
  id: 'himalayas', displayName: 'Himalayas (free API)', sourceHomepage: 'https://himalayas.app/api', mode: 'OFFICIAL_API', kind: 'API',
  description: 'Free key-less remote-jobs API, filtered to roles open to the United Kingdom. Attribution: each job links back to Himalayas.',
  async verifyAccess() {
    const r = await politeFetch('https://himalayas.app/jobs/api/search?q=security&limit=1', { sourceId: 'himalayas', accept: 'application/json', retries: 0 });
    return r.ok ? { status: 'CONNECTED', message: 'Himalayas API responded.' } : { status: 'ERROR', message: r.error ?? `HTTP ${r.status}` };
  },
  async discover(intent, ctx) {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const qs = [...(intent.categories.includes('SOC_SECURITY') ? ['security analyst', 'cyber security'] : []), ...(intent.categories.includes('GRC_RISK_AUDIT') ? ['GRC', 'compliance analyst'] : []), ...(intent.categories.includes('IT_TECHNICAL') ? ['IT support', 'systems administrator'] : [])];
    for (const q of qs) {
      if (ctx.shouldStop()) break;
      out.queries.push(`himalayas: ${q} (United Kingdom)`);
      const r = await politeFetch(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&country=United%20Kingdom&limit=20`, { sourceId: 'himalayas', accept: 'application/json', delayMs: 1200 });
      if (!r.ok) { out.errors.push(`Himalayas "${q}": ${r.error ?? r.status}`); continue; }
      const jobs = JSON.parse(r.text).jobs ?? [];
      out.linksFound += jobs.length;
      for (const j of jobs) {
        const restr: string[] = j.locationRestrictions ?? [];
        const loc = restr.length ? `Remote (${restr.join(', ')})` : 'Remote (worldwide)';
        if (restr.length && !restr.some((x) => /united kingdom|uk|europe|emea/i.test(x))) continue;
        const text = htmlToText(j.description ?? '') || j.excerpt || '';
        out.jobs.push(job({
          sourceId: 'himalayas', sourceJobId: j.guid ?? j.applicationLink, title: j.title, employer: j.companyName, location: loc.includes('United Kingdom') ? loc : `${loc}; UK eligible`,
          boardUrl: j.guid ?? null, applyUrl: j.applicationLink ?? j.guid, applyUrlKind: 'EMPLOYER_SITE', postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
          salaryText: j.minSalary ? `${j.currency ?? ''} ${j.minSalary}-${j.maxSalary ?? ''}`.trim() : null,
          descriptionText: `Source: Himalayas (himalayas.app)\nSeniority: ${(j.seniority ?? []).join(', ') || 'not stated'}\n${text}`, descriptionComplete: text.length > 400,
          extractionMethod: 'himalayas_api',
        }));
      }
    }
    return out;
  },
};

export const hnAdapter: JobSourceAdapter = {
  id: 'hn_whoishiring', displayName: 'Hacker News "Who is hiring?" (Algolia API)', sourceHomepage: 'https://hn.algolia.com/api', mode: 'OFFICIAL_API', kind: 'API',
  description: 'Free key-less Algolia HN API. Reads this month\'s "Ask HN: Who is hiring?" thread and keeps posts mentioning London/UK or UK-compatible remote. Startups here often state "visa sponsorship". Posts are complete as written.',
  async verifyAccess() {
    const r = await politeFetch('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=1', { sourceId: 'hn', accept: 'application/json', retries: 0 });
    return r.ok ? { status: 'CONNECTED', message: 'Algolia HN API responded.' } : { status: 'ERROR', message: r.error ?? `HTTP ${r.status}` };
  },
  async discover(_intent, ctx) {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const s = await politeFetch('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10', { sourceId: 'hn', accept: 'application/json' });
    if (!s.ok) { out.errors.push(`HN: ${s.error ?? s.status}`); return out; }
    const story = (JSON.parse(s.text).hits ?? []).find((h: any) => /who is hiring/i.test(h.title ?? ''));
    if (!story) { out.errors.push('HN: no current "Who is hiring?" thread found'); return out; }
    out.queries.push(`hn: ${story.title}`);
    for (const q of ['London', 'UK']) {
      if (ctx.shouldStop()) break;
      const r = await politeFetch(`https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&query=${q}&hitsPerPage=500`, { sourceId: 'hn', accept: 'application/json' });
      if (!r.ok) { out.errors.push(`HN comments: ${r.error ?? r.status}`); continue; }
      for (const c of JSON.parse(r.text).hits ?? []) {
        if (c.parent_id !== Number(story.objectID)) continue; // top-level posts only
        const text = htmlToText(c.comment_text ?? '');
        const first = text.split('\n')[0];
        const parts = first.split('|').map((x: string) => x.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const locPart = parts.find((p) => /london|uk|united kingdom|remote|england|scotland|manchester|edinburgh/i.test(p)) ?? null;
        if (!locPart || !/london|uk\b|united kingdom|england|scotland|manchester|edinburgh|europe|emea|worldwide|anywhere/i.test(locPart)) continue;
        const rolePart = parts.find((p) => /security|soc|grc|compliance|risk|audit|it support|infrastructure|sre|devops|systems|network|support|intern|graduate|junior|engineer|analyst/i.test(p)) ?? parts[1];
        const link = `https://news.ycombinator.com/item?id=${c.objectID}`;
        out.linksFound++;
        out.jobs.push(job({
          sourceId: 'hn_whoishiring', sourceJobId: String(c.objectID), title: rolePart, employer: parts[0].replace(/\(.*?\)/g, '').trim(), location: locPart.includes('London') || /\buk\b|united kingdom/i.test(locPart) ? locPart : `${locPart}; UK`,
          boardUrl: link, applyUrl: link, postedAt: c.created_at ?? null, descriptionText: text, descriptionComplete: text.length > 300, extractionMethod: 'hn_comment',
        }));
      }
    }
    return out;
  },
};
