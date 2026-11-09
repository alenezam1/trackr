import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse';
import { getDb, type Db } from '../../db/db.js';
import { PARSER_VERSION } from '../models.js';
import { coreKey, exactKey, parseRating, splitTradingAs } from './normalize.js';
import { collapseWs, todayLondon, daysBetween } from '../util/text.js';
import { getSettings } from '../../config/settings.js';

export const EXPECTED_HEADER = ['organisation name', 'town/city', 'county', 'type & rating', 'route'];
const KEEP_SNAPSHOTS = 3;

export interface ImportResult {
  snapshotId: number;
  rowCount: number;
  skilledWorkerCount: number;
  routes: Record<string, number>;
  ratings: Record<string, number>;
  diff: SnapshotDiff | null;
  durationMs: number;
}
export interface SnapshotDiff {
  previousSnapshotId: number;
  added: number; removed: number; ratingChanged: number;
  sampleAdded: string[]; sampleRemoved: string[]; sampleRatingChanged: string[];
  affectedEmployers: string[];
}

function fileSha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

export function inferPublishedDate(fileName: string): string | null {
  const m = path.basename(fileName).match(/(20\d\d)-(\d\d)-(\d\d)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Stream-import a sponsor register CSV into a NEW snapshot. The previous active snapshot stays
 * active until this import fully validates; on any failure nothing is switched.
 */
export async function importSponsorCsv(file: string, opts: { sourceUrl?: string; publishedAt?: string | null; db?: Db; allowSmallFixture?: boolean } = {}): Promise<ImportResult> {
  const db = opts.db ?? getDb();
  const t0 = Date.now();
  const stat = fs.statSync(file);
  if (stat.size < 100 || (!opts.allowSmallFixture && stat.size < 1000)) throw new Error('File is too small to be a sponsor register CSV.');
  const sha = await fileSha256(file);

  const publishedAt = opts.publishedAt ?? inferPublishedDate(file);
  const snap = db.run(
    `INSERT INTO sponsor_snapshots(published_at, imported_at, source_url, source_file, sha256, row_count, skilled_worker_count, parser_version, valid, active)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, 0)`,
    publishedAt, new Date().toISOString(), opts.sourceUrl ?? null, path.basename(file), sha, PARSER_VERSION,
  );
  const snapshotId = snap.lastInsertRowid;

  const routes: Record<string, number> = {};
  const ratings: Record<string, number> = {};
  let rowCount = 0;
  let sw = 0;
  let badRows = 0;
  const insert = db.raw.prepare(
    `INSERT INTO sponsor_organisations(snapshot_id, legal_name, exact_key, core_key, trading_core_key, town, county, type_rating, rating, route, raw_record)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  try {
    const parser = fs.createReadStream(file).pipe(parse({ bom: true, relax_column_count: true, skip_empty_lines: true }));
    let header: string[] | null = null;
    let batch: string[][] = [];
    const flush = () => {
      if (!batch.length) return;
      db.tx(() => {
        for (const rec of batch) {
          const [nameRaw, townRaw, countyRaw, typeRaw, routeRaw] = rec;
          const legal = collapseWs(nameRaw ?? '');
          const route = collapseWs(routeRaw ?? '');
          if (!legal || !route) { badRows++; continue; }
          const rating = parseRating(typeRaw ?? '');
          const { trading } = splitTradingAs(legal);
          insert.run(
            snapshotId, legal, exactKey(legal), coreKey(splitTradingAs(legal).legal), trading ? coreKey(trading) : null,
            collapseWs(townRaw ?? ''), collapseWs(countyRaw ?? ''), collapseWs(typeRaw ?? ''), rating, route,
            JSON.stringify(rec),
          );
          routes[route] = (routes[route] ?? 0) + 1;
          if (route === 'Skilled Worker') { sw++; ratings[rating] = (ratings[rating] ?? 0) + 1; }
          rowCount++;
        }
      });
      batch = [];
    };
    for await (const rec of parser as AsyncIterable<string[]>) {
      if (!header) {
        header = rec.map((h) => h.trim().toLowerCase());
        const ok = EXPECTED_HEADER.every((h, i) => header![i] === h);
        if (!ok) throw new Error(`Unexpected CSV header: ${rec.join(', ')}. Expected: Organisation Name,Town/City,County,Type & Rating,Route`);
        continue;
      }
      batch.push(rec);
      if (batch.length >= 5000) flush();
    }
    flush();

    // Quality checks: plausible size and route composition.
    const quality = {
      rowCount, skilledWorkerCount: sw, badRows,
      plausibleSize: rowCount > 50000,
      hasSkilledWorker: sw > 40000,
      skilledShare: rowCount ? sw / rowCount : 0,
    };
    if (!opts.allowSmallFixture && (!quality.plausibleSize || !quality.hasSkilledWorker)) {
      throw new Error(`Sponsor CSV failed quality checks (rows=${rowCount}, skilled=${sw}). Previous snapshot kept.`);
    }

    const prev = db.get<{ id: number }>('SELECT id FROM sponsor_snapshots WHERE active = 1 ORDER BY id DESC LIMIT 1');
    const diff = prev ? diffSnapshots(db, prev.id, snapshotId) : null;

    db.tx(() => {
      db.run('UPDATE sponsor_snapshots SET active = 0 WHERE active = 1');
      db.run('UPDATE sponsor_snapshots SET row_count = ?, skilled_worker_count = ?, quality_json = ?, diff_json = ?, valid = 1, active = 1 WHERE id = ?',
        rowCount, sw, JSON.stringify({ ...quality, routes, ratings }), diff ? JSON.stringify(diff) : null, snapshotId);
      // Retain only the newest KEEP_SNAPSHOTS snapshots' organisation rows (snapshot metadata is kept).
      const old = db.all<{ id: number }>('SELECT id FROM sponsor_snapshots WHERE valid = 1 ORDER BY id DESC LIMIT -1 OFFSET ?', KEEP_SNAPSHOTS);
      for (const o of old) db.run('DELETE FROM sponsor_organisations WHERE snapshot_id = ?', o.id);
      if (diff) {
        for (const name of diff.affectedEmployers) {
          db.run('INSERT INTO alerts(at, kind, message) VALUES (?, ?, ?)', new Date().toISOString(), 'SPONSOR_CHANGE',
            `Sponsor register change affects a mapped employer: ${name}. Affected jobs will be re-evaluated.`);
        }
      }
    });
    db.exec('ANALYZE sponsor_organisations');
    return { snapshotId, rowCount, skilledWorkerCount: sw, routes, ratings, diff, durationMs: Date.now() - t0 };
  } catch (e) {
    db.run('DELETE FROM sponsor_organisations WHERE snapshot_id = ?', snapshotId);
    db.run('UPDATE sponsor_snapshots SET valid = 0, quality_json = ? WHERE id = ?', JSON.stringify({ error: String((e as Error).message) }), snapshotId);
    throw e;
  }
}

function diffSnapshots(db: Db, prevId: number, nextId: number): SnapshotDiff {
  const q = `SELECT exact_key, MAX(legal_name) AS legal_name, MAX(rating) AS rating FROM sponsor_organisations WHERE snapshot_id = ? AND route = 'Skilled Worker' GROUP BY exact_key`;
  const prev = new Map(db.all<{ exact_key: string; legal_name: string; rating: string }>(q, prevId).map((r) => [r.exact_key, r]));
  const next = new Map(db.all<{ exact_key: string; legal_name: string; rating: string }>(q, nextId).map((r) => [r.exact_key, r]));
  const added: string[] = []; const removed: string[] = []; const changed: string[] = [];
  for (const [k, r] of next) if (!prev.has(k)) added.push(r.legal_name);
  for (const [k, r] of prev) {
    const n = next.get(k);
    if (!n) removed.push(r.legal_name);
    else if (n.rating !== r.rating) changed.push(`${r.legal_name}: ${r.rating} → ${n.rating}`);
  }
  const mapped = db.all<{ exact_key: string; legal_name: string }>('SELECT DISTINCT exact_key, legal_name FROM employer_sponsor_matches WHERE active = 1');
  const affected = mapped.filter((m) => !next.has(m.exact_key) || prev.get(m.exact_key)?.rating !== next.get(m.exact_key)?.rating).map((m) => m.legal_name);
  return {
    previousSnapshotId: prevId, added: added.length, removed: removed.length, ratingChanged: changed.length,
    sampleAdded: added.slice(0, 25), sampleRemoved: removed.slice(0, 25), sampleRatingChanged: changed.slice(0, 25),
    affectedEmployers: affected,
  };
}

export interface SnapshotInfo {
  id: number; published_at: string | null; imported_at: string; source_url: string | null; source_file: string | null;
  sha256: string; row_count: number; skilled_worker_count: number; age: 'CURRENT' | 'AGING' | 'STALE'; ageDays: number | null;
  quality: any; diff: any;
}

export function activeSnapshot(db: Db = getDb()): SnapshotInfo | null {
  const r = db.get<any>('SELECT * FROM sponsor_snapshots WHERE active = 1 AND valid = 1 ORDER BY id DESC LIMIT 1');
  if (!r) return null;
  const s = getSettings();
  const ref = r.published_at ?? r.imported_at.slice(0, 10);
  const ageDays = daysBetween(ref, todayLondon());
  const age = ageDays <= s.sponsor_current_days ? 'CURRENT' : ageDays <= s.sponsor_stale_days ? 'AGING' : 'STALE';
  return {
    id: r.id, published_at: r.published_at, imported_at: r.imported_at, source_url: r.source_url, source_file: r.source_file,
    sha256: r.sha256, row_count: r.row_count, skilled_worker_count: r.skilled_worker_count, age, ageDays,
    quality: r.quality_json ? JSON.parse(r.quality_json) : null, diff: r.diff_json ? JSON.parse(r.diff_json) : null,
  };
}
