// Sponsor-register-driven ATS auto-discovery (Track B expansion, spec §5.3/§10.3).
// Each run takes a bounded batch of not-yet-probed Skilled Worker sponsors (London and tech/finance/
// university-like names first), derives likely board slugs from the legal name, and checks the
// documented public Greenhouse / Lever / Ashby board APIs. Found boards become tracked employers with a
// PROPOSED (unconfirmed) link to the exact register row — similarity of names is never proof.
import { getDb, type Db } from '../../db/db.js';
import { activeSnapshot } from '../sponsors/import.js';
import { coreKey, splitTradingAs } from '../sponsors/normalize.js';
import { listAtsJobs, PROBE_ATS, type AtsType } from '../sources/ats.js';
import { classifyLocation } from '../extraction/classify.js';
import { proposeAllMatches } from './employers.js';

const SKIP = /\b(care|nursing|home care|homecare|healthcare services|restaurant|cafe|takeaway|kebab|pizza|grill|bakery|curry|tandoori|catering|food|construction|builders|plumbing|roofing|dental|pharmacy|chemist|church|mosque|temple|gurdwara|ministr|mission|cleaning|carwash|car wash|barber|salon|beauty|hotel|lodge|taxi|cars|motors|garage|transport|logistics|haulage|farm|nursery|school|academy|trust|charity|surgery|clinic|medical centre|practice|solicitors|accountants|convenience|stores?|mart|supermarket|wholesale|textiles|fashion|jewell)\b/i;
const PREFER = /\b(technolog|tech|software|digital|data|cyber|security|systems|solutions|bank|capital|financ|fintech|consult|cloud|labs?|ai|analytics|network|telecom|university|college|insurance|payments?|platform|computing|robotics|energy|media|games|studio|ventures)\w*/i;

export function slugCandidates(legalName: string): string[] {
  const { legal, trading } = splitTradingAs(legalName);
  const out = new Set<string>();
  for (const n of [trading, legal].filter(Boolean) as string[]) {
    const core = coreKey(n).replace(/\b(technologies|technology|services|solutions|international|global|europe|emea|bank|labs?)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const full = coreKey(n);
    for (const c of [core, full]) {
      if (!c) continue;
      const toks = c.split(' ');
      if (c.replace(/\s/g, '').length >= 4) out.add(toks.join(''));
      if (toks.length > 1) out.add(toks.join('-'));
      if (toks[0].length >= 5) out.add(toks[0]);
    }
  }
  return [...out].filter((s) => /^[a-z0-9-]{3,40}$/.test(s)).slice(0, 3);
}

export interface AutoDiscoveryResult { probedSponsors: number; requests: number; boardsFound: Array<{ sponsor: string; ats: AtsType; token: string; ukJobs: number }>; }

export async function autoDiscoverAtsBoards(opts: { maxSponsors: number; shouldStop?: () => boolean; log?: (m: string) => void }, db: Db = getDb()): Promise<AutoDiscoveryResult> {
  const snap = activeSnapshot(db);
  const res: AutoDiscoveryResult = { probedSponsors: 0, requests: 0, boardsFound: [] };
  if (!snap) return res;
  // Candidate pool: unprobed (or probed > 90 days ago) Skilled Worker A-rated sponsors.
  const pool = db.all<{ legal_name: string; exact_key: string; town: string }>(`
    SELECT legal_name, exact_key, town FROM sponsor_organisations
    WHERE snapshot_id = ? AND route = 'Skilled Worker' AND rating = 'A'
      AND exact_key NOT IN (SELECT exact_key FROM sponsor_ats_probes WHERE probed_at >= datetime('now', '-90 days'))
    GROUP BY exact_key
    ORDER BY CASE WHEN lower(town) LIKE '%london%' THEN 0 ELSE 1 END, random()
    LIMIT 4000`, snap.id);
  const ranked = pool.filter((p) => !SKIP.test(p.legal_name))
    .sort((a, b) => (PREFER.test(b.legal_name) ? 1 : 0) - (PREFER.test(a.legal_name) ? 1 : 0)
      || (/london/i.test(b.town) ? 1 : 0) - (/london/i.test(a.town) ? 1 : 0))
    .slice(0, opts.maxSponsors);

  const known = new Set(db.all<{ k: string }>("SELECT ats_type || ':' || ats_token AS k FROM employers").map((r) => r.k));
  // Three sponsors at a time; each ATS host keeps its own polite spacing.
  let next = 0;
  const worker = async () => { while (next < ranked.length && !opts.shouldStop?.()) await probeOne(ranked[next++]); };
  await Promise.all([worker(), worker(), worker()]);
  proposeAllMatches(db);
  return res;

  async function probeOne(sp: { legal_name: string; exact_key: string; town: string }) {
    res.probedSponsors++;
    const found: any[] = [];
    for (const slug of slugCandidates(sp.legal_name)) {
      // Probe every public ATS API in parallel (each has its own polite rate limiter).
      const probes = await Promise.all(PROBE_ATS.map(async (ats) => {
        if (known.has(`${ats}:${slug}`)) return null;
        res.requests++;
        const r = await listAtsJobs({ id: 0, canonical_name: sp.legal_name, ats_type: ats, ats_token: slug });
        if (!r.ok || !r.jobs.length) return null;
        const uk = r.jobs.filter((j) => ['LONDON', 'UK', 'UK_REMOTE'].includes(classifyLocation(j.location))).length;
        return uk > 0 ? { ats, token: slug, ukJobs: uk, total: r.jobs.length } : null;
      }));
      for (const p of probes) if (p) found.push(p);
      if (found.length) break;
    }
    db.run(`INSERT INTO sponsor_ats_probes(exact_key, legal_name, town, probed_at, found, result_json) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(exact_key) DO UPDATE SET probed_at = excluded.probed_at, found = excluded.found, result_json = excluded.result_json`,
      sp.exact_key, sp.legal_name, sp.town, new Date().toISOString(), found.length > 0, JSON.stringify(found));
    for (const f of found) {
      const display = splitTradingAs(sp.legal_name).trading ?? sp.legal_name;
      db.run(`INSERT OR IGNORE INTO employers(canonical_name, ats_type, ats_token, sector, suggested_legal_name, provenance, first_seen_at, priority, enabled)
              VALUES (?, ?, ?, 'Auto-discovered', ?, 'auto_discovered_from_register', ?, 55, 1)`,
        display, f.ats, f.token, JSON.stringify([sp.legal_name]), new Date().toISOString());
      known.add(`${f.ats}:${f.token}`);
      res.boardsFound.push({ sponsor: sp.legal_name, ats: f.ats, token: f.token, ukJobs: f.ukJobs });
      opts.log?.(`Found ${f.ats} board "${f.token}" for sponsor ${sp.legal_name} (${f.ukJobs} UK postings)`);
    }
  }
}

export function autoDiscoveryStats(db: Db = getDb()) {
  return db.get<any>(`SELECT COUNT(*) AS probed, COALESCE(SUM(found), 0) AS found, MAX(probed_at) AS last FROM sponsor_ats_probes`);
}

/** How far through the register the app has got, and what the next scan will do. */
export function registerProgress(db: Db = getDb()) {
  const snap = activeSnapshot(db);
  const total = snap ? db.get<{ n: number }>(`SELECT COUNT(DISTINCT exact_key) n FROM sponsor_organisations WHERE snapshot_id = ? AND route = 'Skilled Worker' AND rating = 'A'`, snap.id)?.n ?? 0 : 0;
  const checked = db.get<{ n: number }>(`SELECT COUNT(DISTINCT exact_key) n FROM sponsor_ats_probes WHERE probed_at >= datetime('now', '-90 days')`)?.n ?? 0;
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const emp = db.get<any>(`SELECT COUNT(*) boards,
      COALESCE(SUM(last_checked_at IS NOT NULL), 0) scannedEver,
      COALESCE(SUM(last_checked_at >= ?), 0) scanned24h,
      COALESCE(SUM(next_check_at IS NULL OR next_check_at <= ?), 0) dueNow,
      MIN(CASE WHEN next_check_at > ? THEN next_check_at END) nextDue
    FROM employers WHERE ats_type IS NOT NULL AND ats_token IS NOT NULL AND enabled = 1`, dayAgo, now, now);
  const found = db.get<{ n: number }>(`SELECT COUNT(*) n FROM employers WHERE provenance = 'auto_discovered_from_register'`)?.n ?? 0;
  return { totalSponsors: total, sponsorsChecked: checked, sponsorsLeft: Math.max(0, total - checked), boardsFromRegister: found, ...emp };
}
