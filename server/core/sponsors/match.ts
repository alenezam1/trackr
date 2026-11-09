// Employer identity → Skilled Worker sponsor register. Only exact legal names, register-documented
// trading names, or user-confirmed mappings can PASS the gate. Fuzzy similarity only PROPOSES.
import { getDb, type Db } from '../../db/db.js';
import type { SponsorCandidate, SponsorMatch } from '../models.js';
import { activeSnapshot } from './import.js';
import { coreKey, exactKey, looksLikeAgency } from './normalize.js';
import { getSettings } from '../../config/settings.js';

const SW = 'Skilled Worker';

/** Common graduate-employer brands whose UK legal entity differs from the brand. Each legal name was checked
 *  on the 2026-10-05 Skilled Worker register. Still labelled auto-matched (not user-confirmed). */
export const BRAND_ALIASES: Record<string, string> = {
  'ey': 'Ernst & Young', 'ernst and young': 'Ernst & Young', 'ey parthenon': 'Ernst & Young',
  'pwc': 'PricewaterhouseCoopers LLP', 'deloitte': 'Deloitte LLP', 'bdo': 'BDO LLP', 'kpmg': 'KPMG LLP',
  'accenture': 'Accenture (UK) Limited', 'arup': 'Ove Arup and Partners International Ltd', 'capgemini': 'Capgemini UK PLC',
  'grant thornton': 'Grant Thornton Services LLP', 'jpmorgan': 'JPMorgan Chase Bank, National Association', 'jp morgan': 'JPMorgan Chase Bank, National Association',
  'jpmorgan chase': 'JPMorgan Chase Bank, National Association', 'goldman sachs': 'Goldman Sachs International', 'lloyds banking': 'Lloyds Bank plc',
  'lloyds bank': 'Lloyds Bank plc', 'sigma labs': 'SIGMA LABS XYZ LTD', 'zurich': 'Zurich Insurance Group',
};

/** Brand-level key: core key without generic business words ("CGI IT UK Limited" → "cgi"). */
export function strongKey(name: string): string {
  return coreKey(name).split(' ').filter((t) => !['it', 'technologies', 'technology', 'services', 'solutions', 'consulting', 'systems', 'international', 'europe', 'emea', 'global', 'and', 'of'].includes(t)).join(' ');
}
const COLS = 'id, legal_name, town, county, route, rating, type_rating';

export function exactLookup(db: Db, snapshotId: number, name: string): SponsorCandidate[] {
  return db.all<SponsorCandidate>(`SELECT ${COLS} FROM sponsor_organisations WHERE snapshot_id = ? AND exact_key = ? AND route = ?`, snapshotId, exactKey(name), SW);
}

export function tradingLookup(db: Db, snapshotId: number, name: string): SponsorCandidate[] {
  const c = coreKey(name);
  if (!c) return [];
  return db.all<SponsorCandidate>(`SELECT ${COLS} FROM sponsor_organisations WHERE snapshot_id = ? AND route = ? AND trading_core_key = ? LIMIT 10`, snapshotId, SW, c);
}

/** Candidate proposals by core-name equality or word-prefix. Never sufficient to pass the gate. */
export function proposeCandidates(db: Db, snapshotId: number, name: string, limit = 15): SponsorCandidate[] {
  const c = coreKey(name);
  if (!c || c.length < 3) return [];
  const rows = db.all<SponsorCandidate & { core_key: string }>(
    `SELECT ${COLS}, core_key FROM sponsor_organisations WHERE snapshot_id = ? AND route = ? AND core_key >= ? AND core_key < ? LIMIT 200`,
    snapshotId, SW, c, c + '￿',
  );
  const filtered = rows.filter((r) => r.core_key === c || r.core_key.startsWith(c + ' '));
  filtered.sort((a, b) => (a.core_key === c ? 0 : 1) - (b.core_key === c ? 0 : 1) || a.core_key.length - b.core_key.length);
  const trading = tradingLookup(db, snapshotId, name);
  const seen = new Set<number>();
  return [...trading, ...filtered].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).slice(0, limit).map(({ core_key: _c, ...r }: any) => r);
}

export function searchSponsors(query: string, limit = 50, db: Db = getDb()): SponsorCandidate[] {
  const snap = activeSnapshot(db);
  if (!snap || !query.trim()) return [];
  const exact = exactLookup(db, snap.id, query);
  const proposed = proposeCandidates(db, snap.id, query, limit);
  const like = db.all<SponsorCandidate>(
    `SELECT ${COLS} FROM sponsor_organisations WHERE snapshot_id = ? AND route = ? AND legal_name LIKE ? LIMIT ?`,
    snap.id, SW, `%${query.replace(/[%_]/g, '')}%`, limit,
  );
  const seen = new Set<number>();
  return [...exact, ...proposed, ...like].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).slice(0, limit);
}

function dedupeByLegal(rows: SponsorCandidate[]): SponsorCandidate[] {
  const m = new Map<string, SponsorCandidate>();
  for (const r of rows) if (!m.has(exactKey(r.legal_name) + '|' + r.town.toLowerCase())) m.set(exactKey(r.legal_name) + '|' + r.town.toLowerCase(), r);
  return [...m.values()];
}

export function matchEmployer(input: {
  employerId?: number | null; advertisedEmployer: string | null; legalEmployer?: string | null; evidenceUrl?: string | null;
}, db: Db = getDb()): SponsorMatch {
  const snap = activeSnapshot(db);
  const auto = getSettings().auto_accept_strong_sponsor_matches;
  const base = {
    snapshotId: snap?.id ?? null, snapshotDate: snap?.published_at ?? snap?.imported_at?.slice(0, 10) ?? null,
    snapshotAge: (snap?.age ?? 'NONE') as SponsorMatch['snapshotAge'], evidenceUrl: input.evidenceUrl ?? null,
  };
  if (!snap) return { ...base, status: 'AMBIGUOUS', method: 'NO_SNAPSHOT', matched: null, candidates: [], note: 'No sponsor register snapshot imported.' };

  // 1. Employer-level mapping (user-confirmed or proposed)
  if (input.employerId) {
    const m = db.get<any>('SELECT * FROM employer_sponsor_matches WHERE employer_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', input.employerId);
    if (m) {
      if (m.status === 'NOT_SPONSOR' && m.verified_by_user) {
        return { ...base, status: 'NOT_FOUND', method: 'USER_CONFIRMED_NOT_SPONSOR', matched: null, candidates: [], note: 'You confirmed this employer is not on the Skilled Worker register.' };
      }
      const rows = db.all<SponsorCandidate>(`SELECT ${COLS} FROM sponsor_organisations WHERE snapshot_id = ? AND exact_key = ? AND route = ?`, snap.id, m.exact_key, SW);
      const row = rows.find((r) => !m.town || r.town.toLowerCase() === String(m.town).toLowerCase()) ?? rows[0];
      if (m.verified_by_user) {
        if (!row) return { ...base, status: 'NOT_FOUND', method: 'USER_CONFIRMED_MAPPING', matched: null, candidates: [], note: `Confirmed legal entity "${m.legal_name}" is NOT in the current Skilled Worker register snapshot (removed or renamed).` };
        return { ...base, status: 'VERIFIED_ALIAS', method: 'USER_CONFIRMED_MAPPING', matched: row, candidates: [row], evidenceUrl: m.evidence_url ?? base.evidenceUrl, note: `Employer brand mapped to legal entity "${row.legal_name}" and confirmed by you${m.verified_at ? ' on ' + String(m.verified_at).slice(0, 10) : ''}.` };
      }
      if (row && auto && ['SEEDED_LEGAL_NAME', 'EXACT_BRAND_NAME'].includes(m.match_method)) {
        return { ...base, status: 'VERIFIED_ALIAS', method: 'AUTO_STRONG_MATCH', matched: row, candidates: [row], note: `Auto-matched to register entry "${row.legal_name}" (${row.town}) from a checked name mapping. Not yet confirmed by you.` };
      }
      if (row && auto && m.match_method === 'NAME_SIMILARITY' && strongKey(row.legal_name) === strongKey(input.advertisedEmployer ?? '')) {
        return { ...base, status: 'VERIFIED_ALIAS', method: 'AUTO_STRONG_MATCH', matched: row, candidates: [row], note: `Auto-matched: "${input.advertisedEmployer}" uniquely matches register entry "${row.legal_name}". Not yet confirmed by you.` };
      }
      if (row) return { ...base, status: 'PROPOSED', method: m.match_method, matched: null, candidates: [row], note: `Proposed legal entity "${row.legal_name}" (${row.town}) awaits your confirmation. A brand/register name similarity is not proof of the employing entity.` };
    }
  }

  // 2. Legal employer explicitly stated in the posting
  if (input.legalEmployer) {
    const ex = dedupeByLegal(exactLookup(db, snap.id, input.legalEmployer));
    if (ex.length >= 1) return { ...base, status: 'VERIFIED_EXACT', method: 'EXACT_LEGAL_NAME_IN_POSTING', matched: ex[0], candidates: ex, note: `Posting names "${input.legalEmployer}", exactly matching register entry "${ex[0].legal_name}".` };
  }

  const adv = input.advertisedEmployer?.trim();
  if (!adv) return { ...base, status: 'EMPLOYER_UNKNOWN', method: 'NONE', matched: null, candidates: [], note: 'The actual employing entity is not identified.' };
  if (looksLikeAgency(adv)) {
    return { ...base, status: 'EMPLOYER_UNKNOWN', method: 'AGENCY', matched: null, candidates: [], note: `"${adv}" appears to be a recruiter/agency; the actual employer must be identified before the sponsor gate can pass.` };
  }

  // 3. Exact advertised name
  const ex = dedupeByLegal(exactLookup(db, snap.id, adv));
  if (ex.length >= 1) return { ...base, status: 'VERIFIED_EXACT', method: 'EXACT_REGISTER_NAME', matched: ex[0], candidates: ex, note: `Advertised employer "${adv}" exactly matches register entry "${ex[0].legal_name}".` };

  // 4. User-verified alias table
  const alias = db.get<any>('SELECT * FROM employer_aliases WHERE normalized_alias = ? AND verified = 1 ORDER BY id DESC LIMIT 1', exactKey(adv));
  if (alias) {
    const rows = exactLookup(db, snap.id, alias.legal_name);
    if (rows.length) return { ...base, status: 'VERIFIED_ALIAS', method: 'VERIFIED_ALIAS_TABLE', matched: rows[0], candidates: rows, evidenceUrl: alias.evidence_url, note: `Alias "${adv}" → "${rows[0].legal_name}" (verified alias).` };
  }

  // 4b. Checked brand aliases (e.g. EY → Ernst & Young)
  const ba = BRAND_ALIASES[coreKey(adv)] ?? BRAND_ALIASES[strongKey(adv)];
  if (ba && auto) {
    const rows = dedupeByLegal(exactLookup(db, snap.id, ba));
    if (rows.length) return { ...base, status: 'VERIFIED_ALIAS', method: 'AUTO_STRONG_MATCH', matched: rows[0], candidates: rows, note: `Auto-matched: "${adv}" is the brand of register entry "${rows[0].legal_name}" (checked alias). Not yet confirmed by you.` };
  }

  // 5. Register-documented trading names ("X Ltd t/a Brand")
  const tr = dedupeByLegal(tradingLookup(db, snap.id, adv));
  if (tr.length === 1 && auto) return { ...base, status: 'VERIFIED_ALIAS', method: 'AUTO_STRONG_MATCH', matched: tr[0], candidates: tr, note: `Auto-matched: the register lists "${tr[0].legal_name}" trading as "${adv}". Not yet confirmed by you.` };
  if (tr.length === 1) return { ...base, status: 'PROPOSED', method: 'REGISTER_TRADING_NAME', matched: null, candidates: tr, note: `Register lists "${tr[0].legal_name}" — confirm that this legal entity employs the role.` };

  // 6. Fuzzy proposals
  const prop = dedupeByLegal(proposeCandidates(db, snap.id, adv));
  const strong = prop.filter((p) => strongKey(p.legal_name) === strongKey(adv));
  // Auto-accept only when exactly ONE distinct legal entity has the same brand-level name.
  if (auto && strong.length && new Set(strong.map((p) => exactKey(p.legal_name))).size === 1) {
    return { ...base, status: 'VERIFIED_ALIAS', method: 'AUTO_STRONG_MATCH', matched: strong[0], candidates: prop, note: `Auto-matched: "${adv}" uniquely matches register entry "${strong[0].legal_name}". Not yet confirmed by you.` };
  }
  // 7. Brand appears as a whole word inside a legal name ("Arup" in "Ove Arup and Partners ...").
  const ck = coreKey(adv);
  if (!prop.length && ck.length >= 4 && !ck.includes(' ')) {
    const rows = dedupeByLegal(db.all<SponsorCandidate & { core_key: string }>(
      `SELECT ${COLS}, core_key FROM sponsor_organisations WHERE snapshot_id = ? AND route = ? AND (' ' || core_key || ' ') LIKE ? LIMIT 20`,
      snap.id, SW, `% ${ck} %`).map(({ core_key: _c, ...r }: any) => r));
    if (rows.length) {
      return { ...base, status: rows.length === 1 ? 'PROPOSED' : 'AMBIGUOUS', method: 'WORD_IN_LEGAL_NAME', matched: null, candidates: rows, note: `"${adv}" appears in ${rows.length} register legal name(s) — confirm which entity employs this role.` };
    }
  }
  if (prop.length) {
    return { ...base, status: prop.length === 1 ? 'PROPOSED' : 'AMBIGUOUS', method: 'NAME_SIMILARITY', matched: null, candidates: prop, note: `${prop.length} similar register name(s) for "${adv}". Similarity alone never passes the sponsor gate — confirm the legal employer.` };
  }
  return { ...base, status: 'NOT_FOUND', method: 'NO_REGISTER_MATCH', matched: null, candidates: [], note: `No Skilled Worker register entry matches "${adv}" exactly or by similar name in snapshot ${base.snapshotDate}. Use "Correct entity match" if the legal employer has a different name.` };
}
