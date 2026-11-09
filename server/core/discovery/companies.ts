// Company discovery for the Sponsor Registry section: built-in UK fintech/startup list + AI-generated list
// (OpenAI web search) + your own names. Each company is (1) matched to the Skilled Worker register and
// (2) checked for a public careers/ATS board — via its careers page (robots.txt respected) or name-based probes.
import { getDb, type Db } from '../../db/db.js';
import { getProfile } from '../../config/settings.js';
import { matchEmployer } from '../sponsors/match.js';
import { listAtsJobs, PROBE_ATS, parseAtsUrl, type AtsType } from '../sources/ats.js';
import { classifyLocation } from '../extraction/classify.js';
import { politeFetch, robotsAllows } from '../sources/http.js';
import { coreKey, exactKey } from '../sponsors/normalize.js';
import { builtInCompanies } from './companyList.js';
import { proposeAllMatches } from './employers.js';
import { webSearchJson, chatJson } from '../ai/client.js';
import { isSafeHttpUrl } from '../util/text.js';

export interface CompanyCandidate { name: string; careersUrl?: string | null; sector?: string | null; source: 'builtin' | 'ai' | 'user' }

const AI_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { companies: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, careers_url: { type: 'string' }, sector: { type: 'string' } }, required: ['name', 'careers_url', 'sector'] } } },
  required: ['companies'],
};

/** Ask OpenAI for UK fintech / startup / security employers with their careers pages. */
export async function aiCompanyList(limit: number): Promise<{ companies: CompanyCandidate[]; error?: string }> {
  const prompt = `List ${Math.min(limit, 400)} real companies that hire in the UK (London preferred) in fintech, payments, banking technology, cyber security, regtech, insurtech and venture-backed tech startups/scale-ups that run graduate, internship or junior programmes. For each give the official careers page URL (or "" if unsure) and a short sector label. Prefer companies with UK offices of 50+ people. Do not invent companies.`;
  let res = await webSearchJson<{ companies: any[] }>('ai_company_list', 'You are a UK tech labour-market researcher. Output strict JSON.', prompt, AI_SCHEMA, 'companies');
  if (!res.ok) res = await chatJson<{ companies: any[] }>('ai_company_list', 'You are a UK tech labour-market researcher. Output strict JSON.', prompt, AI_SCHEMA, 'companies');
  if (!res.ok || !res.data) return { companies: [], error: res.error };
  return { companies: (res.data.companies ?? []).filter((c: any) => c.name).map((c: any) => ({ name: String(c.name).trim(), careersUrl: isSafeHttpUrl(c.careers_url) ? c.careers_url : null, sector: c.sector || null, source: 'ai' as const })) };
}

const ATS_LINK_RE = /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/[a-z0-9_-]+|https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/[a-z0-9_-]+|https?:\/\/jobs\.(?:eu\.)?lever\.co\/[a-z0-9_.-]+|https?:\/\/jobs\.ashbyhq\.com\/[a-z0-9_.%-]+|https?:\/\/[a-z0-9-]+\.recruitee\.com|https?:\/\/[a-z0-9-]+\.jobs\.personio\.(?:de|com)|https?:\/\/[a-z0-9-]+\.teamtailor\.com|https?:\/\/apply\.workable\.com\/[a-z0-9_-]+|https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/[A-Za-z0-9_-]+/gi;

/** Read a careers page (robots.txt permitting) and find embedded ATS board links. */
export async function detectAtsFromCareersPage(url: string): Promise<Array<{ ats: AtsType; token: string }>> {
  if (!isSafeHttpUrl(url)) return [];
  const direct = parseAtsUrl(url);
  if (direct) return [{ ats: direct.ats, token: direct.token }];
  const rb = await robotsAllows(url);
  if (!rb.allowed) return [];
  const r = await politeFetch(url, { sourceId: `careers:${new URL(url).host}`, accept: 'text/html', retries: 0, timeoutMs: 15000 });
  if (!r.ok) return [];
  const found = new Map<string, { ats: AtsType; token: string }>();
  for (const m of r.text.matchAll(ATS_LINK_RE)) {
    let link = m[0];
    if (/boards-api\.greenhouse\.io\/v1\/boards\//.test(link)) link = link.replace(/boards-api\.greenhouse\.io\/v1\/boards\//, 'boards.greenhouse.io/');
    const p = parseAtsUrl(link);
    if (p && !['embed', 'api', 'v1', 'jobs'].includes(p.token)) found.set(`${p.ats}:${p.token}`, { ats: p.ats, token: p.token });
  }
  // Also follow the final redirect host (e.g. careers.x.com -> x.teamtailor.com)
  const red = parseAtsUrl(r.url);
  if (red) found.set(`${red.ats}:${red.token}`, { ats: red.ats, token: red.token });
  return [...found.values()];
}

export function brandSlugs(name: string): string[] {
  const c = coreKey(name.replace(/\.(com|io|ai|co)\b/gi, ' $1'));
  const toks = c.split(' ').filter(Boolean);
  const out = new Set<string>([toks.join(''), toks.join('-')]);
  if (toks[0]?.length >= 4) out.add(toks[0]);
  return [...out].filter((s) => /^[a-z0-9-]{3,40}$/.test(s)).slice(0, 3);
}

export async function discoverCompanies(opts: { useAi: boolean; limit: number; extra?: CompanyCandidate[]; shouldStop?: () => boolean }, db: Db = getDb()) {
  const { profile } = getProfile();
  const errors: string[] = [];
  let list: CompanyCandidate[] = builtInCompanies().map((name) => ({ name, source: 'builtin' as const }));
  if (opts.useAi) {
    const ai = await aiCompanyList(opts.limit);
    if (ai.error) errors.push(`AI company list: ${ai.error} — using the built-in list only.`);
    list = [...ai.companies, ...list];
  }
  list = [...(opts.extra ?? []), ...list];
  const seen = new Set<string>();
  list = list.filter((c) => { const k = coreKey(c.name); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, opts.limit);

  const known = new Set(db.all<{ k: string }>("SELECT ats_type || ':' || ats_token AS k FROM employers").map((r) => r.k));
  let checked = 0; let boardsFound = 0; let next = 0;
  const work = async () => {
    while (next < list.length && !opts.shouldStop?.()) {
      const c = list[next++];
      checked++;
      const prev = db.get<any>("SELECT * FROM company_candidates WHERE name_key = ? AND checked_at >= datetime('now', '-14 days')", exactKey(c.name));
      if (prev) continue;
      // 1) Sponsor register gate (strict exact/alias/strong matches only).
      const sm = matchEmployer({ advertisedEmployer: c.name }, db);
      const onRegister = sm.status === 'VERIFIED_EXACT' || sm.status === 'VERIFIED_ALIAS';
      // A single register candidate for the brand becomes the proposed legal entity (auto-accepted only if strong).
      const distinct = [...new Set(sm.candidates.map((x) => exactKey(x.legal_name)))];
      const brand = coreKey(c.name);
      const extraOk = (legalName: string) => {
        const extra = coreKey(legalName).replace(brand, '').trim().split(' ').filter(Boolean);
        return extra.every((t) => /^(bank|technologies|technology|tech|labs?|financial|finance|payments?|software|systems|digital|capital|markets|ai|services|platform|security|cyber|solutions|io|com|app|europe|ltd)$/.test(t));
      };
      const legal = sm.matched?.legal_name ?? (distinct.length === 1 && coreKey(sm.candidates[0].legal_name).startsWith(brand) && extraOk(sm.candidates[0].legal_name) ? sm.candidates[0].legal_name : null);
      let status = onRegister ? 'ON_REGISTER' : sm.status === 'PROPOSED' || sm.status === 'AMBIGUOUS' ? 'REGISTER_UNCLEAR' : 'NOT_ON_REGISTER';
      let boards: Array<{ ats: AtsType; token: string; uk: number }> = [];
      if (onRegister || !profile.requires_sponsor_licensed_employer || status === 'REGISTER_UNCLEAR') {
        // 2) Find the careers board: careers page first, then name-based probes.
        const fromPage = c.careersUrl ? await detectAtsFromCareersPage(c.careersUrl) : [];
        const groups = fromPage.length ? [fromPage] : brandSlugs(c.name).map((slug) => PROBE_ATS.map((ats) => ({ ats, token: slug })));
        for (const group of groups) {
          // Probe all ATS types for one slug in parallel (each host keeps its own polite spacing).
          const res = await Promise.all(group.map(async (cand) => {
            if (known.has(`${cand.ats}:${cand.token}`)) return { ...cand, uk: -1 };
            const l = await listAtsJobs({ id: 0, canonical_name: c.name, ats_type: cand.ats, ats_token: cand.token });
            if (!l.ok || !l.jobs.length) return null;
            const uk = l.jobs.filter((x) => ['LONDON', 'UK', 'UK_REMOTE'].includes(classifyLocation(x.location))).length;
            return uk > 0 ? { ...cand, uk } : null;
          }));
          const hit = res.filter(Boolean) as Array<{ ats: AtsType; token: string; uk: number }>;
          if (hit.length) { boards = hit; break; }
        }
        for (const b of boards.filter((x) => x.uk >= 0)) {
          db.run(`INSERT OR IGNORE INTO employers(canonical_name, ats_type, ats_token, careers_url, sector, suggested_legal_name, provenance, first_seen_at, priority, enabled)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 65, 1)`, c.name, b.ats, b.token, c.careersUrl ?? null, c.sector ?? (c.source === 'builtin' ? 'Fintech / startup list' : 'AI company list'),
            legal ? JSON.stringify([legal]) : null, `company_list_${c.source}`, new Date().toISOString());
          known.add(`${b.ats}:${b.token}`);
          boardsFound++;
        }
        if (boards.length) status = onRegister ? 'BOARD_FOUND' : 'BOARD_FOUND_REGISTER_UNCLEAR';
        else if (onRegister) status = 'ON_REGISTER_NO_PUBLIC_BOARD';
      }
      db.run(`INSERT INTO company_candidates(name, name_key, source, sector, careers_url, register_status, legal_name, status, boards_json, checked_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(name_key) DO UPDATE SET source = excluded.source, careers_url = COALESCE(excluded.careers_url, careers_url), register_status = excluded.register_status,
                legal_name = excluded.legal_name, status = excluded.status, boards_json = excluded.boards_json, checked_at = excluded.checked_at`,
        c.name, exactKey(c.name), c.source, c.sector ?? null, c.careersUrl ?? null, sm.status, legal, status, JSON.stringify(boards), new Date().toISOString());
    }
  };
  await Promise.all([work(), work(), work()]);
  proposeAllMatches(db);
  return { checked, boardsFound, total: list.length, errors };
}

export function companySummary(db: Db = getDb()) {
  const by = db.all<any>('SELECT status, COUNT(*) n FROM company_candidates GROUP BY status');
  const rows = db.all<any>('SELECT * FROM company_candidates ORDER BY CASE WHEN status LIKE \'BOARD_FOUND%\' THEN 0 WHEN status LIKE \'ON_REGISTER%\' THEN 1 ELSE 2 END, name LIMIT 600');
  return { byStatus: Object.fromEntries(by.map((r) => [r.status, r.n])), companies: rows };
}
