// Gradcracker reader (PERMITTED_PUBLIC_HTML, opt-in). gradcracker.com/robots.txt allows /search and /hub
// pages for all user agents (checked 2026-10-14; re-checked per URL at runtime). Off until you enable it on the
// Sources page. Slow, identified, sequential requests; only listing + job pages are read — never /out or apply links.
import * as cheerio from 'cheerio';
import { politeFetch, robotsAllows } from './http.js';
import type { DiscoveredJob, DiscoveryContext, DiscoveryPage, JobSourceAdapter } from './types.js';
import type { SearchIntent } from '../models.js';
import { htmlToText } from '../util/text.js';
import { getSettings } from '../../config/settings.js';

const BASE = 'https://www.gradcracker.com';
const DELAY = 1500;
const JOB_LINK = /^(?:https:\/\/www\.gradcracker\.com)?\/hub\/\d+\/[^/]+\/(graduate-job|work-placement-internship|internship|placement|job)[^/]*\/\d+\/[^/?#]+/;

export function gradcrackerListingUrls(intent: SearchIntent, focus: 'BOTH' | 'INTERNSHIP' | 'GRADUATE'): string[] {
  const region = intent.location === 'LONDON' || intent.location == null ? '-in-london-and-south-east' : '';
  const urls: string[] = [];
  const wantIntern = focus !== 'GRADUATE' && !intent.employmentTypes.includes('GRADUATE_PROGRAMME');
  const wantGrad = focus !== 'INTERNSHIP' && !intent.internshipsOnly && !intent.offCycleOnly;
  if (wantIntern) urls.push(`${BASE}/search/computing-technology/work-placements-internships${region}`);
  if (wantGrad) {
    if (intent.categories.includes('SOC_SECURITY') || intent.categories.includes('GRC_RISK_AUDIT')) urls.push(`${BASE}/search/computing-technology/cyber-security-graduate-jobs${region}`);
    if (intent.categories.includes('IT_TECHNICAL')) urls.push(`${BASE}/search/computing-technology/information-technology-graduate-jobs${region}`);
    urls.push(`${BASE}/search/computing-technology/graduate-jobs${region}`);
  }
  return urls;
}

export function parseGradcrackerListing(html: string): Array<{ url: string; title: string }> {
  const $ = cheerio.load(html);
  const out = new Map<string, string>();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    if (!JOB_LINK.test(href) || /featured-graduate-employer|\/9000001\//.test(href)) return;
    const url = new URL(href, BASE).toString().split('?')[0];
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (!out.has(url) || (title && title.length > (out.get(url) ?? '').length)) out.set(url, title);
  });
  return [...out].map(([url, title]) => ({ url, title }));
}

export function parseGradcrackerJob(html: string, url: string): DiscoveredJob {
  const $ = cheerio.load(html);
  const title = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const pageTitle = $('title').text();
  const company = pageTitle.split('|').map((s) => s.trim())[1] || url.split('/')[5]?.replace(/-/g, ' ') || null;
  const facts: Record<string, string> = {};
  $('li, dt, div').each((_, e) => {
    if ($(e).children().length > 4) return;
    const t = $(e).text().replace(/\s+/g, ' ').trim();
    const m = t.match(/^(Location|Salary|Deadline|Starting|Start date|Duration|Degree required|Hours)\s+(.{1,160})$/i);
    if (m && !facts[m[1].toLowerCase()]) facts[m[1].toLowerCase()] = m[2];
  });
  const descHtml = $('.job-description').first().html() ?? $('.body-content').first().html() ?? '';
  const desc = htmlToText(descHtml);
  const header = Object.entries(facts).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)}: ${v}`).join('\n');
  const deadline = facts.deadline?.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s+(20\d\d)/);
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const deadlineIso = deadline && months.indexOf(deadline[2].toLowerCase()) >= 0 ? `${deadline[3]}-${String(months.indexOf(deadline[2].toLowerCase()) + 1).padStart(2, '0')}-${deadline[1].padStart(2, '0')}` : null;
  const id = url.match(/\/(\d+)\/[^/]+$/)?.[1] ?? url;
  const text = [header, desc].filter(Boolean).join('\n\n');
  return {
    sourceId: 'gradcracker', sourceJobId: id, title: title || 'Gradcracker job', employer: company, location: facts.location ?? null,
    boardUrl: url, employerUrl: null, applyUrl: url, applyUrlKind: 'BOARD', postedAt: null, deadline: deadlineIso,
    salaryText: facts.salary ?? null, descriptionText: text, descriptionComplete: desc.length > 400,
    extractionMethod: 'gradcracker_html', accessMode: 'PERMITTED_PUBLIC_HTML',
  };
}

export const gradcrackerAdapter: JobSourceAdapter = {
  id: 'gradcracker_reader', displayName: 'Gradcracker reader (opt-in)', sourceHomepage: BASE, mode: 'PERMITTED_PUBLIC_HTML', kind: 'BOARD',
  description: 'Reads Gradcracker computing graduate-job and internship listings and the full job pages (robots.txt allows these paths). Off by default — enable it on this page after reviewing Gradcracker\'s terms. 1.5 s between requests.',
  async verifyAccess() {
    const r = await robotsAllows(`${BASE}/search/computing-technology/graduate-jobs`);
    if (!r.allowed) return { status: 'BLOCKED', message: r.reason };
    return getSettings().enabled_sources.gradcracker_reader === true
      ? { status: 'CONNECTED', message: `Enabled. ${r.reason}.` }
      : { status: 'PERMISSION_REQUIRED', message: `Off until you enable it. ${r.reason}.`, recommendedAction: 'Enable the toggle on the Sources page.' };
  },
  async discover(intent: SearchIntent, ctx: DiscoveryContext): Promise<DiscoveryPage> {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const s = getSettings();
    const focus = intent.roleFocus ?? s.role_focus;
    const seen = new Set<string>();
    const links: Array<{ url: string; title: string }> = [];
    for (const u of gradcrackerListingUrls(intent, focus)) {
      if (ctx.shouldStop()) break;
      const rb = await robotsAllows(u);
      if (!rb.allowed) { out.errors.push(`Gradcracker: ${rb.reason}`); continue; }
      out.queries.push(`gradcracker: ${u.replace(BASE, '')}`);
      const r = await politeFetch(u, { sourceId: 'gradcracker_reader', accept: 'text/html', delayMs: DELAY });
      if (!r.ok) { out.errors.push(`Gradcracker listing ${u}: ${r.error ?? r.status}`); if (r.blocked) break; continue; }
      for (const l of parseGradcrackerListing(r.text)) if (!seen.has(l.url)) { seen.add(l.url); links.push(l); }
    }
    out.linksFound = links.length;
    // Cheap title prefilter before reading full pages.
    const relevant = links.filter((l) => !l.title || /cyber|secur|risk|audit|grc|compliance|governance|\bit\b|technology|infrastructure|network|support|service desk|cloud|systems|technical|digital|data cent/i.test(l.title));
    for (const l of relevant.slice(0, s.gradcracker_max_jobs_per_run)) {
      if (ctx.shouldStop()) break;
      const rb = await robotsAllows(l.url);
      if (!rb.allowed) continue;
      const r = await politeFetch(l.url, { sourceId: 'gradcracker_reader', accept: 'text/html', delayMs: DELAY });
      if (!r.ok) { out.errors.push(`Gradcracker job ${l.url}: ${r.error ?? r.status}`); if (r.blocked) break; continue; }
      out.jobs.push({ ...parseGradcrackerJob(r.text, l.url), query: 'gradcracker listing' });
    }
    return out;
  },
};
