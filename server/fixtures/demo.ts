// Deterministic SYNTHETIC demo vacancies (clearly labelled DEMO). None of these are real jobs or real employers.
import type { DiscoveredJob } from '../core/sources/types.js';

const base = (id: string, p: Partial<DiscoveredJob>): DiscoveredJob => ({
  sourceId: 'demo', sourceJobId: id, title: '', employer: null, location: 'London, UK', boardUrl: null,
  employerUrl: `https://example.com/demo/${id}`, applyUrl: `https://example.com/demo/${id}/apply`, applyUrlKind: 'EMPLOYER_SITE',
  postedAt: '2026-10-10', deadline: null, salaryText: null, descriptionText: '', descriptionComplete: true,
  extractionMethod: 'demo_fixture', accessMode: 'MANUAL_IMPORT', isDemo: true, ...p,
});

const pad = (s: string) => `${s}\n\nAbout the team\nThis is a synthetic DEMO vacancy used to exercise the eligibility rules. It does not describe a real job, employer or opening. Our team works across security monitoring, governance and infrastructure operations, supporting colleagues across the business with practical, well-documented processes. You will receive structured training, mentoring and exposure to real tooling in a supportive environment.`;

export const DEMO_JOBS: DiscoveredJob[] = [
  base('d1', { title: 'Off-cycle Technology Risk Intern (DEMO)', employer: 'DEMO Example Security Ltd', salaryText: '£32,000 pro rata',
    descriptionText: pad('Fixed-term 6-month off-cycle internship starting January 2027, recent graduates welcome.\nWhat you will do:\n• Support ISO 27001 control testing and risk assessment.\n• Document third-party risk reviews.\nRequirements:\n• A degree in Computer Science, Information Security or similar.\n• Interest in governance, risk and compliance.\nBPSS checks will be completed before you start. Graduate visa holders are welcome to apply.') }),
  base('d2', { title: 'Junior SOC Analyst (DEMO)', employer: 'DEMO Example Security Ltd', salaryText: '£30,000 - £34,000',
    descriptionText: pad('Permanent position in our London SOC.\nEssential:\n• Familiarity with SIEM tools such as Splunk or Microsoft Sentinel.\n• Understanding of networking and incident response.\nAll applicants must have the right to work in the UK.') }),
  base('d3', { title: 'Cyber Security Graduate Analyst (DEMO)', employer: 'DEMO Riverside Bank PLC', salaryText: '£35,000',
    descriptionText: pad('Join our 3-year graduate development programme rotating across security operations and GRC.\nYou must be eligible for Security Check (SC) clearance.\nWe cannot accept time-limited work visas.') }),
  base('d4', { title: 'IT Service Desk Analyst (DEMO)', employer: 'DEMO Northgate Infrastructure Limited', location: 'Manchester, UK', salaryText: '£26,000',
    descriptionText: pad('Permanent role supporting end users with Microsoft 365, Active Directory and hardware troubleshooting.\nVisa sponsorship is not offered for this role.\nBPSS and DBS checks apply.\nExperience of SCADA security is advantageous.') }),
  base('d5', { title: 'Security Assurance Placement Student (DEMO)', employer: 'DEMO Example Security Ltd',
    descriptionText: pad('A 12-month placement for second-year students returning to university to complete their degree.\nPaid at £24,000.') }),
  base('d6', { title: 'Senior Security Engineer (DEMO)', employer: 'DEMO Example Security Ltd',
    descriptionText: pad("Must have at least 5 years' experience in security engineering.\nSalary £85,000.") }),
  base('d7', { title: 'IT Support Technician (DEMO)', employer: 'DEMO Beta Rated Systems Ltd',
    descriptionText: pad('Fixed-term contract supporting our London office.\nSalary £27,000.\nYou may be required to undergo security screening.') }),
  base('d8', { title: 'GRC Analyst Intern (DEMO)', employer: 'DEMO Mobility Only Ltd',
    descriptionText: pad('Paid 3-month internship in governance and compliance, £2,400 per month. Recent graduates welcome.') }),
  base('d9', { title: 'University IT Support Analyst (DEMO)', employer: 'DEMO University of Example',
    descriptionText: pad("Fixed-term 9-month contract in our university IT service desk.\nSalary £29,500.\n3 years' experience preferred but not essential.\nBritish nationality is mandatory for this post.") }),
  base('d10', { title: 'Graduate Network Operations Analyst (DEMO)', employer: 'DEMO Northgate Infrastructure Limited', location: 'Remote - UK',
    descriptionText: pad('12-month fixed-term graduate role in our NOC. Salary £28,000. Visa sponsorship is available for this position. Graduates of any discipline can apply.') }),
  base('d11', { title: 'Information Security Analyst (DEMO, snippet only)', employer: 'DEMO Riverside Bank PLC', descriptionText: 'Short board snippet only.', descriptionComplete: false }),
];
