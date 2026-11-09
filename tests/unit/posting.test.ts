import { describe, expect, it } from 'vitest';
import { looksLikeListingPage, scamSignals } from '../../server/core/extraction/posting.js';
import { sameJob } from '../../server/core/sources/websearch.js';

describe('posting quality', () => {
  it('detects search/listing pages, not single postings', () => {
    expect(looksLikeListingPage('https://www.linkedin.com/jobs/search/?keywords=soc', 'SOC jobs')).toBe(true);
    expect(looksLikeListingPage('https://uk.indeed.com/jobs?q=it+support&l=london', null)).toBe(true);
    expect(looksLikeListingPage(null, '1,245 Cyber Security jobs in London')).toBe(true);
    expect(looksLikeListingPage('https://boards.greenhouse.io/monzo/jobs/123', 'Security Analyst')).toBe(false);
    expect(looksLikeListingPage('https://www.linkedin.com/jobs/view/4012345', 'SOC Analyst')).toBe(false);
    expect(looksLikeListingPage('https://www.acme.com/careers/jobs?gh_jid=5123456', 'Security Analyst')).toBe(false);
    expect(looksLikeListingPage('https://www.bayt.com/en/uae/jobs/soc-analyst-5012345/', 'SOC Analyst')).toBe(false);
  });
  it('flags scam red flags with the sentence', () => {
    const s = scamSignals('Great role! You must pay a £99 fee for training before you start. Interviews are held on Telegram, message us to apply.');
    expect(s.map((x) => x.signal)).toEqual(expect.arrayContaining(['Asks the candidate to pay a fee', 'Interview/contact via WhatsApp or Telegram']));
    expect(scamSignals('BPSS checks apply. We offer a competitive salary and hybrid working.')).toHaveLength(0);
  });
  it('matches the same job across a board and an ATS', () => {
    expect(sameJob('Junior SOC Analyst', 'Junior SOC Analyst - London | Acme')).toBe(true);
    expect(sameJob('Junior SOC Analyst', 'Senior Data Engineer')).toBe(false);
  });
});

describe('board links', () => {
  it('keeps only real single postings, in canonical form', async () => {
    const { canonicalBoardUrl } = await import('../../server/core/extraction/posting.js');
    expect(canonicalBoardUrl('https://ae.indeed.com/viewjob?jk=1A2b3c4d5e6f7a8b&from=serp')).toBe('https://ae.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b');
    expect(canonicalBoardUrl('https://ae.indeed.com/rc/clk?jk=1a2b3c4d5e6f7a8b&fccid=x')).toBe('https://ae.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b');
    expect(canonicalBoardUrl('https://ae.indeed.com/q-cyber-security-l-dubai-jobs.html')).toBeNull();
    expect(canonicalBoardUrl('https://ae.indeed.com/cmp/Acme/jobs')).toBeNull();
    expect(canonicalBoardUrl('https://ae.linkedin.com/jobs/view/soc-analyst-at-acme-4012345678?trk=x')).toBe('https://www.linkedin.com/jobs/view/4012345678');
    expect(canonicalBoardUrl('https://www.linkedin.com/company/acme/jobs')).toBeNull();
    expect(canonicalBoardUrl('https://www.bayt.com/en/uae/jobs/cyber-security-analyst-4931234/')).toBe('https://www.bayt.com/en/uae/jobs/cyber-security-analyst-4931234/');
    expect(canonicalBoardUrl('https://www.bayt.com/en/uae/jobs/cyber-security-jobs/')).toBeNull();
    expect(canonicalBoardUrl('https://www.gradcracker.com/hub/89/cgi/graduate-job/85474/x')).toBe('https://www.gradcracker.com/hub/89/cgi/graduate-job/85474/x');
  });
});

describe('board page reader', () => {
  it('rejects a cut-down page that only lists similar jobs (closed LinkedIn job)', async () => {
    const { parseScrapedPosting } = await import('../../server/core/sources/websearch.js');
    const fs = await import('node:fs');
    const text = fs.readFileSync(new URL('../fixtures/linkedin-closed-serper.txt', import.meta.url), 'utf8');
    const r = parseScrapedPosting(text, '', 'Core42 hiring Analyst - Security Operations | LinkedIn');
    expect(r.ok && !r.expired).toBe(false);
    expect(r.postedAt ?? null).toBeNull(); // dates of OTHER jobs are never used
  });
  it('detects expired postings and reads live ones with their own date', async () => {
    const { parseScrapedPosting } = await import('../../server/core/sources/websearch.js');
    expect(parseScrapedPosting('SOC Analyst\nAcme · Dubai\nNo longer accepting applications\n' + 'x '.repeat(200), '', 'SOC Analyst').expired).toBe(true);
    const live = parseScrapedPosting('SOC Analyst\nAcme · Dubai · Posted 3 days ago\nResponsibilities: monitor alerts and triage incidents. ' + 'Requirements: 0-1 years experience in security. '.repeat(20) + '\nSimilar jobs\nOther Job\n4 months ago', '', 'SOC Analyst');
    expect(live.ok).toBe(true);
    expect(live.postedAt).not.toBeNull();
    expect(live.text).not.toMatch(/4 months ago/);
  });
});

describe('employer careers site vs aggregator', () => {
  it('recognises employer domains and careers platforms, not re-posting sites', async () => {
    const { isEmployerSite } = await import('../../server/core/extraction/posting.js');
    expect(isEmployerSite('https://careers.emiratesnbd.com/job/123', 'Emirates NBD')).toBe(true);
    expect(isEmployerSite('https://propertyfinder.teamtailor.com/jobs/8378126-x', 'Property Finder')).toBe(true);
    expect(isEmployerSite('https://juliusbaer.wd3.myworkdayjobs.com/x/job/Dubai/123', 'Julius Baer')).toBe(true);
    expect(isEmployerSite('https://www.appitsoftware.com/careers/grc-analyst', 'APPIT Software Inc.')).toBe(true);
    expect(isEmployerSite('https://ae.jobiglo.com/job-senior-soc-analyst-j-6a7a', 'CPX')).toBe(false);
    expect(isEmployerSite('https://zerotaxjobs.com/jobs/information-security-analyst', 'Al Futtaim')).toBe(false);
    expect(isEmployerSite('https://www.jobilize.com/job/ae-dubai-cyber', 'Holland Advisors')).toBe(false);
    expect(isEmployerSite('https://neojeen.com/en/jobs/64167', 'TASC Outsourcing')).toBe(false);
  });
  it('skips LinkedIn ids far older than the newest seen', async () => {
    const { staleLinkedInId } = await import('../../server/core/sources/websearch.js');
    expect(staleLinkedInId('https://www.linkedin.com/jobs/view/4360547742', 4467388130, 30)).toBe(true);
    expect(staleLinkedInId('https://www.linkedin.com/jobs/view/4463652726', 4467388130, 30)).toBe(false);
  });
});

describe('senior "Staff" titles and talent pools', () => {
  it('are recognised', async () => {
    const { isSeniorTitle, NOT_A_VACANCY_TITLE } = await import('../../server/core/extraction/classify.js');
    expect(isSeniorTitle('Staff SRE, AI Infrastructure')).toBe(true);
    expect(isSeniorTitle('SOC Analyst')).toBe(false);
    expect(NOT_A_VACANCY_TITLE.test('OT & Industrial Cyber Security - Future Opportunities | Register Your Interest')).toBe(true);
    expect(NOT_A_VACANCY_TITLE.test('Cyber Security Graduate Programme 2027')).toBe(false);
  });
});
