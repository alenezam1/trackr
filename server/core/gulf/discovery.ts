// Find public careers boards (Greenhouse, Lever, Ashby, Workable, Teamtailor, Personio, Recruitee) for Gulf
// employers and global companies with Gulf offices. Boards are kept only if they currently list Gulf jobs.
import { getDb, type Db } from '../../db/db.js';
import { listAtsJobs, PROBE_ATS, type AtsType } from '../sources/ats.js';
import { brandSlugs } from '../discovery/companies.js';
import { exactKey } from '../sponsors/normalize.js';
import { GULF_COMPANIES, marketOfLocation } from './markets.js';

export async function discoverGulfBoards(opts: { shouldStop?: () => boolean } = {}, db: Db = getDb()) {
  const known = new Set(db.all<{ k: string }>("SELECT ats_type || ':' || ats_token AS k FROM employers").map((r) => r.k));
  const list = [...new Set(GULF_COMPANIES)];
  let checked = 0; let found = 0; let next = 0;
  const work = async () => {
    while (next < list.length && !opts.shouldStop?.()) {
      const name = list[next++];
      const key = `gulf:${exactKey(name)}`;
      if (db.get("SELECT 1 FROM company_candidates WHERE name_key = ? AND checked_at >= datetime('now', '-14 days')", key)) continue;
      checked++;
      let hit: { ats: AtsType; token: string; gulf: number } | null = null;
      for (const slug of brandSlugs(name)) {
        const res = await Promise.all(PROBE_ATS.map(async (ats) => {
          if (known.has(`${ats}:${slug}`)) return null;
          const l = await listAtsJobs({ id: 0, canonical_name: name, ats_type: ats, ats_token: slug });
          if (!l.ok || !l.jobs.length) return null;
          const gulf = l.jobs.filter((j) => marketOfLocation(j.location)).length;
          return gulf > 0 ? { ats, token: slug, gulf } : null;
        }));
        hit = res.find(Boolean) ?? null;
        if (hit) break;
      }
      if (hit) {
        db.run(`INSERT OR IGNORE INTO employers(canonical_name, ats_type, ats_token, sector, provenance, first_seen_at, priority, enabled)
                VALUES (?, ?, ?, 'Gulf', 'gulf_list', ?, 60, 1)`, name, hit.ats, hit.token, new Date().toISOString());
        known.add(`${hit.ats}:${hit.token}`); found++;
      }
      db.run(`INSERT INTO company_candidates(name, name_key, source, sector, status, boards_json, checked_at) VALUES (?, ?, 'gulf', 'Gulf', ?, ?, ?)
              ON CONFLICT(name_key) DO UPDATE SET status = excluded.status, boards_json = excluded.boards_json, checked_at = excluded.checked_at`,
        name, key, hit ? 'BOARD_FOUND' : 'NO_PUBLIC_BOARD', JSON.stringify(hit ? [hit] : []), new Date().toISOString());
    }
  };
  await Promise.all([work(), work(), work()]);
  return { checked, found };
}
