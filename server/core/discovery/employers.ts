import { getDb, type Db } from '../../db/db.js';
import { activeSnapshot } from '../sponsors/import.js';
import { exactLookup, proposeCandidates } from '../sponsors/match.js';
import { exactKey } from '../sponsors/normalize.js';
import { EMPLOYER_SEEDS, UNIVERSITY_WATCHLIST } from './employerSeeds.js';
import { listAtsJobs, parseAtsUrl, type AtsType } from '../sources/ats.js';

const now = () => new Date().toISOString();

export function seedEmployers(db: Db = getDb()): number {
  let added = 0;
  for (const s of EMPLOYER_SEEDS) {
    const ex = db.get<{ id: number }>('SELECT id FROM employers WHERE ats_type = ? AND ats_token = ?', s.ats, s.token);
    if (ex) continue;
    db.run(`INSERT INTO employers(canonical_name, ats_type, ats_token, sector, suggested_legal_name, provenance, first_seen_at, priority)
            VALUES (?, ?, ?, ?, ?, 'seed-2026-10-14', ?, 60)`, s.name, s.ats, s.token, s.sector, JSON.stringify(Array.isArray(s.legal) ? s.legal : [s.legal]), now());
    added++;
  }
  for (const u of UNIVERSITY_WATCHLIST) {
    const ex = db.get<{ id: number }>("SELECT id FROM employers WHERE ats_type = 'manual' AND canonical_name = ?", u.name);
    if (ex) continue;
    db.run(`INSERT INTO employers(canonical_name, ats_type, ats_token, careers_url, sector, suggested_legal_name, provenance, first_seen_at, priority, discovery_status)
            VALUES (?, 'manual', ?, ?, 'University', ?, 'seed-2026-10-14', ?, 70, 'MANUAL_ONLY')`, u.name, exactKey(u.name), u.careers, JSON.stringify([u.legal]), now());
    added++;
  }
  proposeAllMatches(db);
  return added;
}

/** Create PROPOSED (unconfirmed) employer→sponsor mappings for employers without one. */
export function proposeAllMatches(db: Db = getDb()) {
  const snap = activeSnapshot(db);
  if (!snap) return;
  const emps = db.all<any>('SELECT * FROM employers WHERE id NOT IN (SELECT employer_id FROM employer_sponsor_matches WHERE active = 1)');
  for (const e of emps) {
    const suggestions: string[] = e.suggested_legal_name ? JSON.parse(e.suggested_legal_name) : [];
    let rows = suggestions.flatMap((s) => exactLookup(db, snap.id, s));
    let method = 'SEEDED_LEGAL_NAME';
    if (!rows.length) { rows = exactLookup(db, snap.id, e.canonical_name); method = 'EXACT_BRAND_NAME'; }
    if (!rows.length) { rows = proposeCandidates(db, snap.id, e.canonical_name, 3); method = 'NAME_SIMILARITY'; }
    if (rows.length === 1 || (rows.length > 1 && suggestions.length === 1)) {
      const r = rows[0];
      db.run(`INSERT INTO employer_sponsor_matches(employer_id, legal_name, exact_key, town, snapshot_id, match_method, status, evidence_note, verified_by_user, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'PROPOSED', ?, 0, ?)`, e.id, r.legal_name, exactKey(r.legal_name), r.town, snap.id, method,
        `Register row: ${r.legal_name}, ${r.town}, ${r.type_rating}, ${r.route}. Proposal only — confirm that this entity employs ${e.canonical_name}'s UK staff.`, now());
    }
  }
}

export function listEmployers(db: Db = getDb()) {
  const snap = activeSnapshot(db);
  const rows = db.all<any>(`SELECT e.*, m.id AS match_id, m.legal_name AS match_legal_name, m.town AS match_town, m.status AS match_status,
      m.verified_by_user, m.verified_at, m.match_method, m.evidence_note, m.evidence_url,
      (SELECT COUNT(*) FROM jobs j WHERE j.employer_id = e.id) AS job_count,
      (SELECT COUNT(*) FROM jobs j WHERE j.employer_id = e.id AND j.current_status IN ('VERIFIED_COMPATIBLE','POTENTIAL_NO_STATED_BLOCKER')) AS viable_count
    FROM employers e LEFT JOIN employer_sponsor_matches m ON m.employer_id = e.id AND m.active = 1 ORDER BY e.canonical_name`);
  return rows.map((r) => {
    let register: any = null;
    if (snap && r.match_legal_name) {
      const rr = exactLookup(db, snap.id, r.match_legal_name);
      register = rr.find((x) => !r.match_town || x.town.toLowerCase() === String(r.match_town).toLowerCase()) ?? rr[0] ?? null;
    }
    return { ...r, register_row: register, on_current_register: !!register };
  });
}

export function confirmEmployerMatch(employerId: number, sponsorOrgId: number, evidenceUrl: string | null, db: Db = getDb()) {
  const org = db.get<any>('SELECT * FROM sponsor_organisations WHERE id = ?', sponsorOrgId);
  if (!org) throw new Error('Sponsor register row not found.');
  if (org.route !== 'Skilled Worker') throw new Error('Only Skilled Worker register rows satisfy your sponsor rule.');
  const emp = db.get<any>('SELECT * FROM employers WHERE id = ?', employerId);
  if (!emp) throw new Error('Employer not found.');
  db.tx(() => {
    db.run('UPDATE employer_sponsor_matches SET active = 0 WHERE employer_id = ?', employerId);
    db.run(`INSERT INTO employer_sponsor_matches(employer_id, legal_name, exact_key, town, snapshot_id, match_method, status, evidence_url, evidence_note, verified_by_user, verified_at, created_at)
            VALUES (?, ?, ?, ?, ?, 'USER_CONFIRMED_MAPPING', 'CONFIRMED', ?, ?, 1, ?, ?)`, employerId, org.legal_name, org.exact_key, org.town, org.snapshot_id, evidenceUrl,
      `Confirmed by user: ${emp.canonical_name} → ${org.legal_name} (${org.town}, ${org.type_rating}).`, now(), now());
    db.run('INSERT INTO employer_aliases(alias, normalized_alias, legal_name, evidence_url, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      emp.canonical_name, exactKey(emp.canonical_name), org.legal_name, evidenceUrl, now());
  });
}

export function markEmployerNotSponsor(employerId: number, note: string | null, db: Db = getDb()) {
  db.tx(() => {
    db.run('UPDATE employer_sponsor_matches SET active = 0 WHERE employer_id = ?', employerId);
    db.run(`INSERT INTO employer_sponsor_matches(employer_id, legal_name, exact_key, match_method, status, evidence_note, verified_by_user, verified_at, created_at)
            VALUES (?, '', '', 'USER_CONFIRMED', 'NOT_SPONSOR', ?, 1, ?, ?)`, employerId, note ?? 'User confirmed: no Skilled Worker register entry for the employing entity.', now(), now());
    db.run("UPDATE employers SET skip_reason = 'Not on Skilled Worker register (confirmed by you)' WHERE id = ?", employerId);
  });
}

export function setEmployerEnabled(employerId: number, enabled: boolean, db: Db = getDb()) {
  db.run('UPDATE employers SET enabled = ? WHERE id = ?', enabled, employerId);
}

export async function addEmployer(input: { name: string; url?: string | null; ats?: AtsType | null; token?: string | null }, db: Db = getDb()) {
  let ats = input.ats ?? null; let token = input.token ?? null;
  if (input.url && (!ats || !token)) {
    const p = parseAtsUrl(input.url);
    if (p) { ats = p.ats; token = p.token; }
  }
  if (ats && token) {
    const listing = await listAtsJobs({ id: 0, canonical_name: input.name, ats_type: ats, ats_token: token });
    if (!listing.ok) throw new Error(`The ${ats} board "${token}" did not respond (${listing.error}). Check the careers URL.`);
    const ex = db.get<{ id: number }>('SELECT id FROM employers WHERE ats_type = ? AND ats_token = ?', ats, token);
    if (ex) return { id: ex.id, message: 'Employer already tracked.' };
    const r = db.run(`INSERT INTO employers(canonical_name, ats_type, ats_token, careers_url, provenance, first_seen_at, priority) VALUES (?, ?, ?, ?, 'user_added', ?, 80)`,
      input.name, ats, token, input.url ?? null, now());
    proposeAllMatches(db);
    return { id: r.lastInsertRowid, message: `Added ${input.name} (${ats}: ${token}, ${listing.jobs.length} live postings). Confirm its legal entity on the register to pass the sponsor gate.` };
  }
  const r = db.run(`INSERT INTO employers(canonical_name, ats_type, ats_token, careers_url, provenance, first_seen_at, priority, discovery_status) VALUES (?, 'manual', ?, ?, 'user_added', ?, 70, 'MANUAL_ONLY')`,
    input.name, exactKey(input.name) + ':' + Date.now(), input.url ?? null, now());
  proposeAllMatches(db);
  return { id: r.lastInsertRowid, message: 'Added as a watchlist employer (no public ATS API detected): open its careers page and import postings.' };
}

/** Find or create an employer row for a job imported from an ATS URL or discovered elsewhere. */
export function ensureEmployerForAts(ats: AtsType, token: string, displayName: string | null, db: Db = getDb()): number {
  const ex = db.get<{ id: number }>('SELECT id FROM employers WHERE ats_type = ? AND ats_token = ?', ats, token);
  if (ex) return ex.id;
  const r = db.run(`INSERT INTO employers(canonical_name, ats_type, ats_token, provenance, first_seen_at, priority, enabled) VALUES (?, ?, ?, 'discovered', ?, 50, 0)`,
    displayName ?? token, ats, token, now());
  proposeAllMatches(db);
  return r.lastInsertRowid;
}
