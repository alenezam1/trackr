// The nine user-named job boards. None of them is presented as a live automated feed: each is an
// honest, limited connector (search links + user-shared link / pasted-JD import, plus optional
// discovery through a licensed search API). See docs/SOURCES.md for the reasoning per site.
import type { SearchIntent } from '../models.js';
import type { JobSourceAdapter, SearchLink, SourceAccessResult } from './types.js';
import { robotsAllows } from './http.js';

const enc = encodeURIComponent;
function roleTerm(i: SearchIntent): string {
  if (i.keywords.length) return i.keywords.join(' ');
  if (i.categories.length === 1) return i.categories[0] === 'SOC_SECURITY' ? 'cyber security' : i.categories[0] === 'GRC_RISK_AUDIT' ? 'technology risk' : 'IT support';
  return 'cyber security';
}
function level(i: SearchIntent): string { return i.offCycleOnly ? 'off-cycle internship' : i.internshipsOnly ? 'internship' : 'graduate'; }

interface BoardDef {
  id: string; name: string; home: string; robotsProbe?: string; loginRequired?: boolean; termsUrl?: string;
  note: string; links: (i: SearchIntent) => SearchLink[];
}

const BOARDS: BoardDef[] = [
  {
    id: 'linkedin', name: 'LinkedIn', home: 'https://www.linkedin.com/feed/', loginRequired: true, termsUrl: 'https://www.linkedin.com/legal/crawling-terms',
    note: 'LinkedIn prohibits automated crawling/scraping without express permission. Limited: open filtered searches in your browser and paste job links or JD text here.',
    links: (i) => [
      { label: `LinkedIn: ${roleTerm(i)} ${level(i)} — London`, url: `https://www.linkedin.com/jobs/search/?keywords=${enc(`${roleTerm(i)} ${level(i)}`)}&location=${enc('London, England, United Kingdom')}&f_E=1%2C2` },
      { label: 'LinkedIn: IT support entry level — UK', url: `https://www.linkedin.com/jobs/search/?keywords=${enc('IT support')}&location=${enc('United Kingdom')}&f_E=1%2C2` },
      { label: 'LinkedIn: GRC / technology risk — London', url: `https://www.linkedin.com/jobs/search/?keywords=${enc('GRC OR "technology risk"')}&location=${enc('London, England, United Kingdom')}&f_E=1%2C2` },
    ],
  },
  {
    id: 'brightnetwork', name: 'Bright Network', home: 'https://www.brightnetwork.co.uk/dashboard/', loginRequired: true, robotsProbe: 'https://www.brightnetwork.co.uk/graduate-jobs/',
    note: 'Dashboard content requires your login; no public API. Limited: open searches and import shared links / pasted JDs.',
    links: (i) => [
      { label: 'Bright Network: Technology graduate jobs', url: 'https://www.brightnetwork.co.uk/graduate-jobs/technology/' },
      { label: 'Bright Network: Internships', url: 'https://www.brightnetwork.co.uk/internships/' },
      { label: `Bright Network search: ${roleTerm(i)}`, url: `https://www.brightnetwork.co.uk/search/?query=${enc(roleTerm(i))}` },
    ],
  },
  {
    id: 'ucl_careers', name: 'UCL Careers (TargetConnect)', home: 'https://uclcareers.targetconnect.net/student/jobs.html?execution=e1s1', loginRequired: true,
    note: 'Authenticated university portal. The app never stores your UCL credentials or session. Open it in your browser and paste links / JD text.',
    links: () => [{ label: 'UCL Careers job board (login)', url: 'https://uclcareers.targetconnect.net/student/jobs.html?execution=e1s1' }],
  },
  {
    id: 'indeed', name: 'Indeed UK', home: 'https://uk.indeed.com/jobs?q=cyber+security+internship&l=london', robotsProbe: 'https://uk.indeed.com/jobs?q=x',
    note: 'Indeed restricts automated access to search pages. Limited: open searches, paste job links; the app then looks for the employer posting.',
    links: (i) => [
      { label: `Indeed: ${roleTerm(i)} ${level(i)} — London`, url: `https://uk.indeed.com/jobs?q=${enc(`${roleTerm(i)} ${level(i)}`)}&l=london` },
      { label: 'Indeed: cyber security internship — London', url: 'https://uk.indeed.com/jobs?q=cyber+security+internship&l=london' },
      { label: 'Indeed: IT support graduate — UK', url: 'https://uk.indeed.com/jobs?q=it+support+graduate&l=United+Kingdom' },
    ],
  },
  {
    id: 'trackr', name: 'The Trackr', home: 'https://app.the-trackr.com/uk-tech/graduate-programmes#bz7fap4t26', robotsProbe: 'https://app.the-trackr.com/uk-tech/graduate-programmes',
    note: 'Interactive web app without a documented public API. Limited: open the tracker (graduate programmes + internships) and import links.',
    links: () => [
      { label: 'The Trackr: UK tech graduate programmes', url: 'https://app.the-trackr.com/uk-tech/graduate-programmes' },
      { label: 'The Trackr: UK tech summer internships', url: 'https://app.the-trackr.com/uk-tech/summer-internships' },
    ],
  },
  {
    id: 'prospects', name: 'Prospects', home: 'https://www.prospects.ac.uk/graduate-jobs-results?sortBy=dp&advert_top=17180&careers=69&size=20&page=0', robotsProbe: 'https://www.prospects.ac.uk/graduate-jobs-results',
    note: 'No public jobs API. Limited: open filtered searches and import links; optional discovery via your licensed search API.',
    links: () => [{ label: 'Prospects: IT graduate jobs (newest)', url: 'https://www.prospects.ac.uk/graduate-jobs-results?sortBy=dp&advert_top=17180&careers=69&size=20&page=0' }],
  },
  {
    id: 'targetjobs', name: 'targetjobs', home: 'https://targetjobs.co.uk/', robotsProbe: 'https://targetjobs.co.uk/search',
    note: 'No public jobs API. Limited: open searches and import links; optional discovery via your licensed search API.',
    links: (i) => [{ label: `targetjobs: ${roleTerm(i)}`, url: `https://targetjobs.co.uk/search?search=${enc(roleTerm(i))}` }],
  },
  {
    id: 'gradcracker', name: 'Gradcracker', home: 'https://www.gradcracker.com/search/computing-technology/graduate-jobs-in-london-and-south-east', robotsProbe: 'https://www.gradcracker.com/search/computing-technology/graduate-jobs-in-london-and-south-east',
    note: 'No public jobs API; many listings are for students. Limited: open searches and import links; the app checks student-only wording in the full JD.',
    links: () => [
      { label: 'Gradcracker: computing graduate jobs — London & SE', url: 'https://www.gradcracker.com/search/computing-technology/graduate-jobs-in-london-and-south-east' },
      { label: 'Gradcracker: computing work placements/internships', url: 'https://www.gradcracker.com/search/computing-technology/work-placements-internships' },
    ],
  },
  {
    id: 'higherin', name: 'higherin', home: 'https://higherin.com/search-jobs/graduates', robotsProbe: 'https://higherin.com/search-jobs/graduates',
    note: 'No public jobs API. Limited: open searches and import links; optional discovery via your licensed search API.',
    links: () => [
      { label: 'higherin: graduate jobs', url: 'https://higherin.com/search-jobs/graduates' },
      { label: 'higherin: internships', url: 'https://higherin.com/search-jobs/internships' },
    ],
  },
];

// More UK boards (search links + AI web search + Brave site: discovery; never scraped).
const q = (s: string) => encodeURIComponent(s);
const MORE_BOARDS: BoardDef[] = [
  { id: 'glassdoor', name: 'Glassdoor UK', home: 'https://www.glassdoor.co.uk/Job/index.htm', loginRequired: true, note: 'Login wall and anti-bot protection; search links + AI web search only.', links: (i) => [{ label: `Glassdoor: ${roleTerm(i)} London`, url: `https://www.glassdoor.co.uk/Job/jobs.htm?sc.keyword=${q(`${roleTerm(i)} ${level(i)}`)}&locKeyword=London` }] },
  { id: 'totaljobs', name: 'Totaljobs', home: 'https://www.totaljobs.com/', note: 'No public API; search links + AI web search.', links: (i) => [{ label: `Totaljobs: ${roleTerm(i)} ${level(i)} — London`, url: `https://www.totaljobs.com/jobs/${q(`${roleTerm(i)} ${level(i)}`.replace(/\s+/g, '-'))}/in-london` }] },
  { id: 'cwjobs', name: 'CWJobs (IT jobs)', home: 'https://www.cwjobs.co.uk/', note: 'IT/tech board; search links + AI web search.', links: (i) => [{ label: `CWJobs: ${roleTerm(i)} graduate`, url: `https://www.cwjobs.co.uk/jobs/${q(`${roleTerm(i)} graduate`.replace(/\s+/g, '-'))}` }] },
  { id: 'cvlibrary', name: 'CV-Library', home: 'https://www.cv-library.co.uk/', note: 'Search links + AI web search.', links: (i) => [{ label: `CV-Library: ${roleTerm(i)} graduate`, url: `https://www.cv-library.co.uk/${q(`${roleTerm(i)}-graduate`.replace(/\s+/g, '-'))}-jobs-in-london` }] },
  { id: 'wttj', name: 'Welcome to the Jungle (Otta)', home: 'https://app.welcometothejungle.com/', loginRequired: true, note: 'Startup jobs; login needed for search. AI web search + links.', links: () => [{ label: 'Welcome to the Jungle: London jobs', url: 'https://app.welcometothejungle.com/' }] },
  { id: 'workinstartups', name: 'Work In Startups', home: 'https://workinstartups.com/', note: 'UK startup board; search links + AI web search.', links: () => [{ label: 'Work In Startups: latest', url: 'https://workinstartups.com/job-board/jobs' }] },
  { id: 'escapethecity', name: 'Escape the City', home: 'https://www.escapethecity.org/', note: 'Purpose-driven roles; links + AI web search.', links: () => [{ label: 'Escape the City: tech jobs', url: 'https://www.escapethecity.org/search/jobs?category=Technology' }] },
  { id: 'milkround', name: 'Milkround', home: 'https://www.milkround.com/', note: 'Graduate board; links + AI web search.', links: (i) => [{ label: `Milkround: ${roleTerm(i)}`, url: `https://www.milkround.com/jobs/${q(roleTerm(i).replace(/\s+/g, '-'))}` }] },
  { id: 'ratemyplacement', name: 'RateMyPlacement', home: 'https://www.ratemyplacement.co.uk/', note: 'Mostly student placements (often student-only); links only.', links: () => [{ label: 'RateMyPlacement: IT internships', url: 'https://www.ratemyplacement.co.uk/search?sectors=it-technology' }] },
  { id: 'civilservice', name: 'Civil Service Jobs', home: 'https://www.civilservicejobs.service.gov.uk/', note: 'Many roles need nationality/SC — the rules engine checks each JD. Links + AI web search.', links: () => [{ label: 'Civil Service Jobs: search', url: 'https://www.civilservicejobs.service.gov.uk/csr/index.cgi' }] },
  { id: 'jobsacuk', name: 'jobs.ac.uk (universities)', home: 'https://www.jobs.ac.uk/', note: 'University IT, cyber and KTP roles; links + AI web search.', links: () => [{ label: 'jobs.ac.uk: IT jobs', url: 'https://www.jobs.ac.uk/search/?keywords=IT+support' }, { label: 'jobs.ac.uk: KTP associates', url: 'https://www.jobs.ac.uk/search/?keywords=KTP+associate' }] },
  { id: 'cybersecurityjobsite', name: 'CyberSecurityJobsite', home: 'https://www.cybersecurityjobsite.com/', note: 'Specialist cyber board; links + AI web search.', links: () => [{ label: 'CyberSecurityJobsite: graduate', url: 'https://www.cybersecurityjobsite.com/jobs/graduate/' }] },
];
BOARDS.push(...MORE_BOARDS);

export const BOARD_DOMAINS: Record<string, string> = {
  linkedin: 'linkedin.com', brightnetwork: 'brightnetwork.co.uk', ucl_careers: 'targetconnect.net', indeed: 'indeed.com',
  trackr: 'the-trackr.com', prospects: 'prospects.ac.uk', targetjobs: 'targetjobs.co.uk', gradcracker: 'gradcracker.com', higherin: 'higherin.com',
  glassdoor: 'glassdoor.co.uk', totaljobs: 'totaljobs.com', cwjobs: 'cwjobs.co.uk', cvlibrary: 'cv-library.co.uk', wttj: 'welcometothejungle.com',
  workinstartups: 'workinstartups.com', escapethecity: 'escapethecity.org', milkround: 'milkround.com', ratemyplacement: 'ratemyplacement.co.uk',
  civilservice: 'civilservicejobs.service.gov.uk', jobsacuk: 'jobs.ac.uk', cybersecurityjobsite: 'cybersecurityjobsite.com',
  bayt: 'bayt.com', naukrigulf: 'naukrigulf.com', gulftalent: 'gulftalent.com', dubizzle: 'dubizzle.com', tanqeeb: 'tanqeeb.com',
  glassdoor_com: 'glassdoor.com', founditgulf: 'founditgulf.com', ziprecruiter: 'ziprecruiter.com', talent: 'talent.com', jooble_board: 'jooble.org',
  drjob: 'drjobpro.com', laimoon: 'laimoon.com', gulfnews: 'gulfnews.com', qatarliving: 'qatarliving.com', jadarat: 'jadarat.sa', jobsindubai: 'jobsindubai.com', careerjet: 'careerjet.ae', jora: 'jora.com',
};

/** Boards whose individual job pages may be read when their robots.txt allows it (checked per URL). */
export const READABLE_BOARDS = new Set(['bayt', 'naukrigulf', 'gulftalent', 'tanqeeb']);

export function boardForUrl(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    for (const [id, d] of Object.entries(BOARD_DOMAINS)) if (h === d || h.endsWith('.' + d)) return id;
  } catch { /* ignore */ }
  return null;
}

export function boardAdapters(): JobSourceAdapter[] {
  return BOARDS.map((b) => ({
    id: b.id,
    displayName: b.name,
    sourceHomepage: b.home,
    mode: 'USER_SHARED_LINK',
    kind: 'BOARD',
    description: b.note,
    searchLinks: b.links,
    async verifyAccess(): Promise<SourceAccessResult> {
      if (b.loginRequired && !b.robotsProbe) {
        return { status: b.id === 'linkedin' ? 'LIMITED' : 'LOGIN_REQUIRED', message: b.note, recommendedAction: 'Open searches in your browser, then use “Import job” to paste the link or JD text.' };
      }
      if (b.id === 'linkedin') return { status: 'LIMITED', message: 'Limited: open searches + paste job link. Automated LinkedIn access is not permitted.', recommendedAction: 'Use the search links and paste postings into Import.' };
      if (b.robotsProbe) {
        const r = await robotsAllows(b.robotsProbe);
        return {
          status: 'LIMITED',
          message: `${b.note} robots.txt check for the search page: ${r.reason}. Automated crawling is not enabled because the site's terms do not grant it.`,
          recommendedAction: 'Use the search links; import links/JD text; optionally configure a licensed search API for site: discovery.',
        };
      }
      return { status: 'LIMITED', message: b.note };
    },
  }));
}
