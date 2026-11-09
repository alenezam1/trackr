// AI web-search discovery: asks OpenAI (Responses API + built-in web search tool) to find CURRENT UK postings
// for your enabled target roles across job boards and careers pages. Returned links are then read by the normal
// pipeline: public ATS links via official APIs, employer pages if robots.txt allows; board pages (LinkedIn,
// Indeed, Glassdoor…) are stored as links with the AI's snippet and stay in review until you read/paste the JD.
import type { DiscoveredJob, DiscoveryContext, DiscoveryPage, JobSourceAdapter } from '../sources/types.js';
import type { SearchIntent } from '../models.js';
import { webSearchJson } from './client.js';
import { getSettings } from '../../config/settings.js';
import { hasSecret } from '../../config/secrets.js';
import { parseAtsUrl } from '../sources/ats.js';
import { boardForUrl } from '../sources/boards.js';
import { isSafeHttpUrl, parsePostedDate } from '../util/text.js';
import { canonicalBoardUrl, isEmployerSite, TEASER_BOARDS } from '../extraction/posting.js';

export const JOB_BOARDS_FOR_AI = [
  'LinkedIn Jobs', 'Indeed UK', 'Glassdoor UK', 'Gradcracker', 'Bright Network', 'targetjobs', 'Prospects', 'higherin', 'The Trackr',
  'Totaljobs', 'CWJobs', 'CV-Library', 'Reed', 'Guardian Jobs', 'Welcome to the Jungle (Otta)', 'Work In Startups', 'Escape the City', 'Cord',
  'Milkround', 'RateMyPlacement', 'Civil Service Jobs', 'NHS Jobs', 'jobs.ac.uk', 'CyberSecurityJobsite', 'Technojobs', 'company careers pages (Greenhouse, Lever, Ashby, Workable, Teamtailor, Personio, Recruitee, SmartRecruiters, Workday)',
];

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' }, url: { type: 'string' },
          board: { type: 'string' }, posted: { type: 'string' }, snippet: { type: 'string' },
          key_sentences: { type: 'string' }, experience_required: { type: 'string' }, nationality_requirement: { type: 'string' },
          careers_url: { type: 'string' },
        },
        required: ['title', 'company', 'location', 'url', 'board', 'posted', 'snippet', 'key_sentences', 'experience_required', 'nationality_requirement', 'careers_url'],
      },
    },
  },
  required: ['jobs'],
};

export const aiWebSearchAdapter: JobSourceAdapter = {
  id: 'ai_web_search', displayName: 'AI web search (OpenAI) across all job boards', sourceHomepage: 'https://platform.openai.com/docs/guides/tools-web-search',
  mode: 'SEARCH_INDEX_DISCOVERY', kind: 'SEARCH',
  description: `Uses your OpenAI key + the official web-search tool to find live UK postings on ${JOB_BOARDS_FOR_AI.length}+ boards (LinkedIn, Indeed, Glassdoor, Totaljobs, Gradcracker, Otta…) and careers pages. Links are verified by the app; the AI never decides eligibility.`,
  async verifyAccess() {
    if (!hasSecret('openai_api_key')) return { status: 'NOT_CONFIGURED', message: 'Add an OpenAI API key and enable AI in Settings.' };
    if (!getSettings().ai_enabled) return { status: 'NOT_CONFIGURED', message: 'AI is switched off in Settings.' };
    return { status: 'CONNECTED', message: 'Ready (each run uses a few web searches from your OpenAI budget).' };
  },
  async discover(intent: SearchIntent, ctx: DiscoveryContext): Promise<DiscoveryPage> {
    const out: DiscoveryPage = { jobs: [], linksFound: 0, queries: [], errors: [] };
    const s = getSettings();
    const roles = (intent.roleQueries ?? []).slice(0, 24);
    const level = intent.roleFocus === 'INTERNSHIP' ? 'internships (incl. off-cycle and summer)' : intent.roleFocus === 'GRADUATE' ? 'graduate schemes and entry-level / junior jobs' : 'internships, graduate schemes and entry-level / junior jobs';
    const gulf = intent.market ? { UAE: 'the United Arab Emirates (Dubai, Abu Dhabi, Sharjah…)', QATAR: 'Qatar (Doha…)', SAUDI: 'Saudi Arabia (Riyadh, Jeddah, Dammam…)' }[intent.market] : null;
    const where = gulf ?? (intent.location === 'REMOTE' ? 'remote roles open to UK residents' : intent.location === 'UK' ? 'anywhere in the UK' : 'London (or UK-remote)');
    const sources = gulf ? ['LinkedIn Jobs', 'Bayt', 'NaukriGulf', 'GulfTalent', 'Indeed', 'Glassdoor', 'dubizzle', 'company careers pages (Greenhouse, Lever, Ashby, Workable, Workday, SuccessFactors, Oracle)'] : JOB_BOARDS_FOR_AI;
    const windowDays = s.max_posting_age_days;
    // Gulf: three focused searches (each returns its own set) instead of one broad one.
    const clusters = gulf
      ? ['SOC analyst, security operations, cyber security analyst, information security analyst, security engineer (junior)',
        'GRC, cyber risk, information security governance, IT audit, compliance (ISO 27001, NESA/NCA), privacy',
        'cyber security internships, graduate programmes, fresh-graduate and trainee roles, junior penetration tester / threat analyst']
      : [roles.join('; ')];
    const seen = new Set<string>();
    for (const cluster of clusters) {
      if (ctx.shouldStop()) break;
      const prompt = `Find up to ${gulf ? Math.min(25, s.ai_web_search_max_results) : s.ai_web_search_max_results} CURRENTLY OPEN ${gulf ? 'entry-level / graduate / junior / internship' : level} postings in ${where}, posted within the last ${windowDays} days, for: ${cluster}${intent.keywords.length ? `; extra keywords: ${intent.keywords.join(' ')}` : ''}.
Search these sources: ${sources.join(', ')}. Use job boards to FIND postings, then look for the same job on the employer's own careers/ATS site: put that link in careers_url ("" if the employer has none) and the posting you opened in url. Board URLs must be the posting itself (e.g. indeed …/viewjob?jk=…, linkedin.com/jobs/view/<id>) — never search, company or click-tracking links. Skip postings that are expired, removed or show an error.
OPEN each posting and fill: posted (YYYY-MM-DD if shown), key_sentences = 3-8 sentences COPIED VERBATIM from the posting covering responsibilities, required experience, nationality/visa/residency requirements and education (max 900 characters), experience_required (as written, e.g. "0-1 years", "" if not stated), nationality_requirement (verbatim sentence, "" if none).
${gulf ? 'Skip roles reserved for local nationals (e.g. "UAE nationals only", Emiratisation/Qatarisation/Saudisation roles) and roles asking for more than 1 year of experience.' : 'Skip senior/lead/manager roles and roles requiring SC/DV clearance or British citizenship when the listing says so.'}
Return only real, currently open single postings you actually opened, with the exact URL copied from your search results — NEVER construct, shorten or guess a URL or job id (an invented Indeed jk= or LinkedIn id is worse than no result). Salary pages, course pages, people profiles and "jobs in <city>" pages are not postings. Keep each snippet under 150 characters. Use "" for unknown fields. Never invent postings or sentences.`;
      out.queries.push(`ai_web_search: ${cluster.slice(0, 90)}… (${where}, ≤${windowDays} days)`);
      const res = await webSearchJson<{ jobs: any[] }>('ai_web_search', 'You are a job-search assistant with web search. Output strict JSON.', prompt, SCHEMA, 'job_links');
      if (!res.ok || !res.data) { out.errors.push(`AI web search: ${res.error}`); ctx.log('SEARCH', `✗ AI web search (${cluster.slice(0, 60)}…): ${res.error}`, { provider: 'openai', site: 'AI web search', ok: false, results: 0, kept: 0 }); if (/budget|switched off|No OpenAI/.test(res.error ?? '')) break; continue; }
      ctx.log('SEARCH', `AI web search (${cluster.slice(0, 60)}…) → ${(res.data.jobs ?? []).length} postings suggested`, { provider: 'openai', site: 'AI web search', ok: true, results: (res.data.jobs ?? []).length, kept: (res.data.jobs ?? []).length });
      for (const jb0 of res.data.jobs ?? []) {
        if (!isSafeHttpUrl(jb0.url)) continue;
        const board = boardForUrl(jb0.url) ?? (TEASER_BOARDS.test(new URL(jb0.url).hostname) ? 'web_board' : null);
        const url = board ? canonicalBoardUrl(jb0.url) : jb0.url; // broken/tracking board links are dropped
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const jb = { ...jb0, url };
        out.linksFound++;
        const ats = parseAtsUrl(jb.url);
        const careers = isSafeHttpUrl(jb.careers_url) && !boardForUrl(jb.careers_url) && isEmployerSite(jb.careers_url, jb.company) ? jb.careers_url as string : null;
        // A non-board URL counts as the employer's only when its domain is theirs (else it's an aggregator copy → treated like a board).
        const ownSite = !board && isEmployerSite(jb.url, jb.company);
        const employerUrl = ats || ownSite ? jb.url : careers;
        const copy = !board && !ats && !ownSite; // aggregator / re-posting site
        const aiText = [jb.key_sentences, jb.experience_required ? `Experience required: ${jb.experience_required}.` : '', jb.nationality_requirement].filter((x: string) => x && x.trim()).join('\n');
        out.jobs.push({
          sourceId: board ?? (copy ? 'web_board' : 'ai_web_search'), sourceJobId: jb.url, title: jb.title || 'Untitled', employer: jb.company || null, location: jb.location || null,
          boardUrl: board || copy ? jb.url : null, employerUrl, applyUrl: employerUrl ?? jb.url,
          applyUrlKind: ats || (careers && parseAtsUrl(careers)) ? 'EMPLOYER_ATS' : employerUrl ? 'EMPLOYER_SITE' : 'BOARD',
          postedAt: parsePostedDate(jb.posted), deadline: null, salaryText: null,
          descriptionText: jb.snippet ? `AI search snippet (not the full JD): ${jb.snippet}` : null, descriptionComplete: false,
          extractionMethod: 'ai_web_search_link', accessMode: 'SEARCH_INDEX_DISCOVERY', query: `AI: ${jb.board}`,
          // Gulf: a board link is never trusted on this search's word — the link reader re-opens it to confirm it is real and live.
          aiReadText: aiText.length >= 150 && !(gulf && (board || copy)) ? `${jb.title} — ${jb.company} (${jb.location})\n${aiText}` : null,
        } as DiscoveredJob);
      }
    }
    return out;
  },
};
