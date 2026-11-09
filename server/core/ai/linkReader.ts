// AI link reader: search finds single postings on LinkedIn, Bayt, Indeed, GulfTalent… that the app cannot open
// itself (login walls / bot checks). OpenAI's web tool opens up to 8 of them per call and copies back the key
// sentences VERBATIM, so they can be graded by the normal rules. Results are labelled "Read by AI web search".
import { webSearchJson } from './client.js';
import { isSafeHttpUrl, parsePostedDate } from '../util/text.js';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    postings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          url: { type: 'string' }, opened: { type: 'boolean' }, still_open: { type: 'boolean' }, title: { type: 'string' }, company: { type: 'string' },
          location: { type: 'string' }, posted: { type: 'string' }, key_sentences: { type: 'string' }, experience_required: { type: 'string' }, nationality_requirement: { type: 'string' },
          employer_apply_url: { type: 'string' },
        },
        required: ['url', 'opened', 'still_open', 'title', 'company', 'location', 'posted', 'key_sentences', 'experience_required', 'nationality_requirement', 'employer_apply_url'],
      },
    },
  },
  required: ['postings'],
};

export interface AiReadPosting { url: string; title: string; company: string; location: string; postedAt: string | null; text: string; employerUrl: string | null }

const BOARD_HOST = /(^|\.)(linkedin|indeed|glassdoor|bayt|gulftalent|naukrigulf|founditgulf|dubizzle|ziprecruiter|talent|jooble|careerjet|drjobpro|laimoon|jora|google)\./i;
function employerLink(u: string, postingUrl: string): string | null {
  if (!u || !isSafeHttpUrl(u)) return null;
  try { return BOARD_HOST.test(new URL(u).hostname) || u === postingUrl ? null : u; } catch { return null; }
}

export async function aiReadLinks(urls: string[]): Promise<{ results: AiReadPosting[]; error?: string }> {
  const list = urls.filter(isSafeHttpUrl).slice(0, 8);
  if (!list.length) return { results: [] };
  const prompt = `Open each of these job posting URLs and report what the posting itself says. Do not guess; if a page cannot be opened, set opened=false.
${list.map((u, i) => `${i + 1}. ${u}`).join('\n')}
For each: title, company, location, posted (YYYY-MM-DD if shown or computed from "x days ago"), still_open (true ONLY if the page shows a live posting; false if it is expired, removed, "no longer accepting applications", an error/"invalid request" page, or redirects to a search page), employer_apply_url (the employer's OWN careers-site or ATS link for this job if the posting links to it or you can find the same job on the company's careers site; "" if none — never a LinkedIn/Indeed/board link), key_sentences = 3-8 sentences COPIED VERBATIM from the posting covering duties, required experience, education, nationality/visa/residency requirements (max 900 characters), experience_required (as written, "" if not stated), nationality_requirement (verbatim sentence or "").`;
  const res = await webSearchJson<{ postings: any[] }>('ai_link_reader', 'You read job postings with web search and copy text verbatim. Output strict JSON.', prompt, SCHEMA, 'postings');
  if (!res.ok || !res.data) return { results: [], error: res.error };
  const results: AiReadPosting[] = [];
  for (const p of res.data.postings ?? []) {
    if (!p.opened || p.still_open !== true || !list.includes(p.url)) continue;
    const text = [p.key_sentences, p.experience_required ? `Experience required: ${p.experience_required}.` : '', p.nationality_requirement].filter((x: string) => x && x.trim()).join('\n');
    if (text.length < 150) continue;
    results.push({ url: p.url, title: p.title, company: p.company, location: p.location, postedAt: parsePostedDate(p.posted), text: `${p.title} — ${p.company} (${p.location})\n${text}`, employerUrl: employerLink(p.employer_apply_url, p.url) });
  }
  return { results };
}
