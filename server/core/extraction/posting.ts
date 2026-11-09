// Posting quality checks: is this a real, single job posting we actually read — or a search/listing page,
// a board teaser, or a likely scam? Deterministic heuristics; AI adds its own grounded signals on top.
import { splitSentences } from '../util/text.js';

const LISTING_URL = /([?&](q|query|keywords?|search|what)=)|\/search\b|\/jobs\/?(\?|$)|\/jobs-in-|\/browse\b|\/category\/|\/jobs\/[a-z-]+-jobs\/?$|linkedin\.com\/jobs\/(search|collections)|indeed\.[a-z.]+\/(jobs|q-)|glassdoor\.[a-z.]+\/Job\/(?!.*_IL\.)/i;
const LISTING_TITLE = /\b\d[\d,]*\+?\s+(jobs|vacancies|roles|positions)\b|\bjobs in\b|\bjob search\b|\bjobs\s*\|\s*(linkedin|indeed|glassdoor|totaljobs|reed)|\bhiring now\b|\bbrowse jobs\b|\btop \d+ jobs\b/i;

/** True when a URL/title is a search results or listing page rather than one job posting. */
const SINGLE_JOB_URL = /[?&](gh_jid|jid|job_?id|jobid|vacancy_?id|req(uisition)?_?id|id)=|\/jobs?\/view\/\d|\/(job|jobs|vacancy|vacancies|position|careers?)\/[^/?#]*\d{3,}|\/j\/[A-Z0-9]{6,}|jobs\.lever\.co\/[^/]+\/[0-9a-f-]{20,}|jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{20,}|\/jobadvert\//i;

/** URL shape of one specific vacancy (job id in the path or query). */
export function looksLikeSinglePosting(url: string | null | undefined): boolean {
  return !!url && (SINGLE_JOB_URL.test(url) || /myworkdayjobs\.com\/.+\/job\/|successfactors\.(com|eu)\/.+(career_job_req_id|jobId)|oraclecloud\.com\/.+\/job\/\d+|taleo\.net\/.+(job=|jobdetail)/i.test(url));
}

export function looksLikeListingPage(url: string | null | undefined, title: string | null | undefined): boolean {
  if (url && SINGLE_JOB_URL.test(url)) return !!title && LISTING_TITLE.test(title);
  return (!!url && LISTING_URL.test(url)) || (!!title && LISTING_TITLE.test(title));
}

const SCAM_PATTERNS: Array<[RegExp, string]> = [
  [/\b(pay|payment|fee|deposit|purchase)\b[^.]{0,50}\b(training|registration|equipment|starter kit|onboarding|background check|certificat|visa|uniform|software licen[cs]e)\b/i, 'Asks the candidate to pay a fee'],
  [/\b(whatsapp|telegram|signal app|wechat)\b[^.]{0,50}\b(contact|message|text|apply|interview|recruiter)\b|\b(contact|message|apply|interview)\b[^.]{0,40}\b(whatsapp|telegram)\b/i, 'Interview/contact via WhatsApp or Telegram'],
  [/\b(send|email)\b[^.]{0,40}\b(cv|resume|application)\b[^.]{0,40}@(gmail|yahoo|hotmail|outlook|aol|proton(mail)?)\.(com|co\.uk)/i, 'Applications to a free personal email address'],
  [/\bearn\s+(up to\s+)?£\s?\d{3,}[^.]{0,20}\b(per|a|each)\s+(day|week)\b/i, 'Unrealistic “earn £X per day/week” promise'],
  [/\b(no (experience|interview) (needed|required))\b[^.]{0,80}\b(guaranteed|immediate start|same day pay)\b/i, 'No-interview / guaranteed-hire wording'],
  [/\b(bitcoin|crypto(currency)?|gift cards?)\b[^.]{0,60}\b(payment|pay you|paid in|deposit|transfer)\b/i, 'Payment in crypto or gift cards'],
  [/\b(bank account|national insurance number|passport)\b[^.]{0,40}\b(before (the )?interview|to apply|in your application)\b/i, 'Requests sensitive documents before interview'],
];

/** Returns human-readable scam signals with the sentence that triggered each. */
export function scamSignals(text: string): Array<{ signal: string; quote: string }> {
  const out: Array<{ signal: string; quote: string }> = [];
  if (!text) return out;
  for (const s of splitSentences(text)) {
    for (const [re, label] of SCAM_PATTERNS) {
      if (re.test(s.text) && !out.some((o) => o.signal === label)) out.push({ signal: label, quote: s.text.slice(0, 300) });
    }
  }
  return out;
}

/**
 * A board link reduced to the canonical address of ONE posting, or null when it isn't one.
 * Search engines return Indeed click-tracking, company-review and search links that open nothing useful
 * ("invalid request"); only links that carry the posting's own id are kept.
 */
export function canonicalBoardUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) {
    // Indeed: only viewjob?jk=<16 hex>. /rc/clk, /pagead, /cmp/<company>, /q-…-jobs.html and search pages are not postings.
    const jk = u.searchParams.get('jk') ?? u.searchParams.get('vjk');
    return jk && /^[0-9a-f]{16}$/i.test(jk) ? `https://${host}/viewjob?jk=${jk.toLowerCase()}` : null;
  }
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{8,})/)?.[1] ?? u.searchParams.get('currentJobId');
    return id && /^\d{8,}$/.test(id) ? `https://www.linkedin.com/jobs/view/${id}` : null;
  }
  if (/(^|\.)glassdoor\.[a-z.]+$/.test(host)) {
    const jl = u.searchParams.get('jl');
    return jl && /^\d{6,}$/.test(jl) ? `https://${host}/job-listing/j?jl=${jl}` : null;
  }
  if (/(^|\.)bayt\.com$/.test(host)) return /\/jobs\/[^/]*-\d{5,}\/?$/.test(u.pathname) ? `https://www.bayt.com${u.pathname}` : null;
  if (/(^|\.)gulftalent\.com$/.test(host)) return /\/jobs\/[^/]*-\d{4,}\/?$/.test(u.pathname) ? `https://www.gulftalent.com${u.pathname}` : null;
  if (/(^|\.)(jobsora\.com|careerjet\.[a-z.]+|jora\.com|whatjobs\.com|jobleads\.com|expertini\.com)$/.test(host)) return null; // copies of other boards' ads
  if (/(^|\.)naukrigulf\.com$/.test(host)) return /-jid-\d+/.test(u.pathname) ? `https://www.naukrigulf.com${u.pathname}` : null;
  return url; // other boards (Gradcracker, Bright Network…) keep their own link checks
}

/** Careers/ATS platforms employers host their own postings on. */
const CAREERS_PLATFORM = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|teamtailor\.com|recruitee\.com|personio\.(de|com)|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|successfactors\.(com|eu)|sapsf\.(com|eu)|taleo\.net|oraclecloud\.com|icims\.com|jobvite\.com|bamboohr\.com|breezy\.hr|zohorecruit\.(com|eu)|freshteam\.com|pinpointhq\.com|applytojob\.com|eightfold\.ai|phenompeople\.com|avature\.net|csod\.com|ultipro\.com|dayforcehcm\.com|rippling-ats\.com|comeet\.(com|co)|hibob\.com|join\.com|darwinbox\.(in|com)|jobs\.ac\.uk)$/i;
const GENERIC_NAME_WORDS = new Set(['group', 'company', 'holding', 'holdings', 'solutions', 'services', 'technologies', 'technology', 'international', 'limited', 'llc', 'fzc', 'fze', 'fzco', 'global', 'consulting', 'the', 'and', 'middle', 'east', 'private', 'enterprises', 'systems', 'digital', 'security', 'cyber', 'bank', 'dubai', 'abu', 'dhabi', 'uae', 'qatar', 'saudi', 'arabia']);

/**
 * True when a URL is the employer's OWN careers site: its domain carries the company name ("careers.emiratesnbd.com"),
 * or it is a careers/ATS platform employers host postings on (Workday, Greenhouse, SuccessFactors…).
 * Aggregators that copy ads (jobiglo, zerotaxjobs, jobilize…) are not.
 */
export function isEmployerSite(url: string | null | undefined, employer: string | null | undefined): boolean {
  if (!url) return false;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (TEASER_BOARDS.test(host)) return false;
  if (CAREERS_PLATFORM.test(host)) return true;
  const hostFlat = host.replace(/[^a-z0-9]/g, '');
  const words = (employer ?? '').toLowerCase().replace(/&/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
  if (!words.length) return false;
  if (words.some((w) => w.length >= 4 && hostFlat.includes(w))) return true;
  if (words.length >= 2 && hostFlat.includes(words.slice(0, 2).join(''))) return true; // "Property Finder" → propertyfinder
  const initials = (employer ?? '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0].toLowerCase()).join('');
  return initials.length >= 3 && new RegExp(`(^|\\.)${initials}\\.`).test(host); // "Emirates NBD" → enbd.com
}

/** Board pages we never treat as the posting itself (we must find the employer's own posting or a full JD). */
export const TEASER_BOARDS = /(^|\.)(linkedin\.com|indeed\.(com|co\.uk)|glassdoor\.(com|co\.uk)|ziprecruiter\.|talent\.com|jooble\.org|adzuna\.co\.uk|simplyhired\.|bebee\.com|jobrapido\.|jobsora\.com|himalayas\.app|careerjet\.|jora\.com|whatjobs\.com|jobleads\.com|trabajo\.org|recruit\.net|expertini\.com|learn4good\.com)/i;
