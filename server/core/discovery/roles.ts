// Target roles, organised by FUNCTION with several title variants each (technique from
// MadsLorentzen/ai-job-search: "organise by function, not job title"). Fully user-editable:
// toggle families on/off, edit keywords, or add your own role types.
import type { Category } from '../models.js';

export interface RoleFamily {
  id: string; label: string; category: 'SOC_SECURITY' | 'GRC_RISK_AUDIT' | 'IT_TECHNICAL';
  keywords: string[]; enabled: boolean; custom?: boolean;
}

export const DEFAULT_ROLE_FAMILIES: RoleFamily[] = [
  { id: 'soc', label: 'SOC & Security Analyst', category: 'SOC_SECURITY', enabled: true, keywords: ['soc analyst', 'security analyst', 'security operations', 'cyber security analyst', 'cybersecurity analyst', 'information security analyst', 'cyber analyst', 'security monitoring', 'cyber defence', 'cyber security intern', 'security intern', 'cyber security graduate', 'cybersecurity graduate', 'security graduate', 'cyber graduate', 'cyber security'] },
  { id: 'seceng', label: 'Security Engineer (junior / graduate)', category: 'SOC_SECURITY', enabled: true, keywords: ['security engineer', 'cyber security engineer', 'cloud security', 'application security', 'appsec', 'detection engineer', 'security engineering', 'iam analyst', 'identity and access'] },
  { id: 'threat', label: 'Threat Intel / Incident Response / Forensics', category: 'SOC_SECURITY', enabled: true, keywords: ['threat intelligence', 'threat analyst', 'incident response', 'forensic', 'dfir', 'threat hunting', 'malware'] },
  { id: 'vuln', label: 'Vulnerability Management / Pen Testing', category: 'SOC_SECURITY', enabled: true, keywords: ['vulnerability', 'penetration test', 'pen test', 'pentest', 'offensive security', 'red team', 'ethical hack'] },
  { id: 'grc', label: 'GRC & Security Compliance', category: 'GRC_RISK_AUDIT', enabled: true, keywords: ['grc', 'governance', 'security compliance', 'technology compliance', 'it compliance', 'information security governance', 'security policy', 'cyber compliance', 'compliance analyst'] },
  { id: 'risk', label: 'Technology Risk & IT Audit', category: 'GRC_RISK_AUDIT', enabled: true, keywords: ['technology risk', 'tech risk', 'cyber risk', 'it risk', 'information risk', 'it audit', 'technology audit', 'audit technology', 'risk and controls', 'risk & controls', 'third party risk', 'third-party risk', 'controls tester', 'technology assurance', 'data assurance', 'security assurance'] },
  { id: 'privacy', label: 'Privacy & Information Governance', category: 'GRC_RISK_AUDIT', enabled: true, keywords: ['privacy', 'data protection', 'information governance'] },
  { id: 'support', label: 'IT Support & Service Desk', category: 'IT_TECHNICAL', enabled: true, keywords: ['it support', 'service desk', 'helpdesk', 'help desk', 'desktop support', 'technical support', 'it technician', 'support technician', 'end user', 'it analyst', 'it intern', 'it graduate', 'it assistant', 'it officer', 'ict'] },
  { id: 'infra', label: 'Infrastructure & Systems Admin', category: 'IT_TECHNICAL', enabled: true, keywords: ['infrastructure', 'systems administrator', 'system administrator', 'sysadmin', 'systems engineer', 'it operations', 'technical operations', 'platform support', 'it engineer'] },
  { id: 'network', label: 'Network & NOC', category: 'IT_TECHNICAL', enabled: true, keywords: ['network engineer', 'network analyst', 'noc', 'network operations', 'network support', 'network technician'] },
  { id: 'cloud', label: 'Cloud Support & Cloud Ops', category: 'IT_TECHNICAL', enabled: true, keywords: ['cloud support', 'cloud operations', 'cloud engineer', 'cloud analyst'] },
  { id: 'techgrad', label: 'Technology graduate schemes', category: 'IT_TECHNICAL', enabled: true, keywords: ['technology graduate', 'graduate technology', 'technology analyst', 'technology consulting', 'tech graduate', 'it graduate scheme', 'digital graduate'] },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (k: string) => new RegExp(`(^|[^a-z0-9])${esc(k.toLowerCase().trim())}([^a-z0-9]|$)`);

/** First enabled family whose keyword appears (as whole words) in the title. */
export function matchTargetRole(title: string, families: RoleFamily[]): RoleFamily | null {
  const t = ` ${title.toLowerCase()} `;
  // Custom families first: they express explicit user intent.
  const ordered = [...families.filter((f) => f.custom), ...families.filter((f) => !f.custom)];
  for (const f of ordered) {
    if (!f.enabled) continue;
    if (f.keywords.some((k) => k.trim() && wordRe(k).test(t))) return f;
  }
  return null;
}

/** Search phrases for keyword APIs: two strongest title variants per enabled family. */
export function familyQueries(families: RoleFamily[]): string[] {
  return families.filter((f) => f.enabled).flatMap((f) => f.keywords.slice(0, f.custom ? 3 : 2)).filter(Boolean);
}

export function categoryOf(f: RoleFamily | null): Category { return f ? f.category : 'OTHER'; }

// ---------------------------------------------------------------------------------------------
// Custom restrictions you can add yourself (My Rules page)
// ---------------------------------------------------------------------------------------------
export interface CustomRule {
  id: string; label: string; enabled: boolean;
  kind: 'exclude_title' | 'exclude_text' | 'require_text' | 'exclude_employer';
  terms: string[]; action: 'exclude' | 'review';
}

export function evaluateCustomRules(rules: CustomRule[], job: { title: string; employer: string | null; text: string }):
  Array<{ rule: CustomRule; quote: string | null }> {
  const hits: Array<{ rule: CustomRule; quote: string | null }> = [];
  const text = job.text ?? '';
  const sentenceWith = (term: string) => {
    const re = wordRe(term);
    for (const s of text.split(/(?<=[.!?;\n])\s+/)) if (re.test(` ${s.toLowerCase()} `)) return s.trim().slice(0, 300);
    return null;
  };
  for (const r of rules) {
    if (!r.enabled || !r.terms.length) continue;
    const terms = r.terms.map((t) => t.trim()).filter(Boolean);
    if (r.kind === 'exclude_title') {
      const t = terms.find((x) => wordRe(x).test(` ${job.title.toLowerCase()} `));
      if (t) hits.push({ rule: r, quote: job.title });
    } else if (r.kind === 'exclude_employer') {
      const t = terms.find((x) => (job.employer ?? '').toLowerCase().includes(x.toLowerCase()));
      if (t) hits.push({ rule: r, quote: job.employer });
    } else if (r.kind === 'exclude_text') {
      for (const x of terms) { const q = sentenceWith(x); if (q) { hits.push({ rule: r, quote: q }); break; } }
    } else if (r.kind === 'require_text') {
      const hay = ` ${job.title.toLowerCase()} ${text.toLowerCase()} `;
      if (!terms.some((x) => wordRe(x).test(hay))) hits.push({ rule: r, quote: null });
    }
  }
  return hits;
}
