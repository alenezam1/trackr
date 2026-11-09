// Refresh the sponsor register from the OFFICIAL GOV.UK publication. Uses the public GOV.UK Content API
// to find the current CSV attachment instead of a hard-coded file name.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb } from '../../db/db.js';
import { importSponsorCsv, type ImportResult } from './import.js';
import { politeFetch } from '../sources/http.js';

const CONTENT_API = 'https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers';

export interface RefreshOutcome {
  status: 'IMPORTED' | 'UNCHANGED' | 'FAILED';
  message: string;
  attachmentUrl?: string;
  publishedAt?: string | null;
  result?: ImportResult;
}

export async function findOfficialCsv(): Promise<{ url: string; publishedAt: string | null; title: string }> {
  const res = await politeFetch(CONTENT_API, { sourceId: 'govuk', accept: 'application/json' });
  if (!res.ok) throw new Error(`GOV.UK content API returned HTTP ${res.status}`);
  const body = JSON.parse(res.text);
  const attachments: any[] = body?.details?.attachments ?? [];
  const csv = attachments.find((a) => /csv/i.test(a.content_type ?? '') || /\.csv($|\?)/i.test(a.url ?? ''));
  if (!csv?.url) throw new Error('No CSV attachment found on the official publication page.');
  const url = new URL(csv.url, 'https://www.gov.uk').toString();
  if (!/^https:\/\/(assets\.publishing\.service\.gov\.uk|www\.gov\.uk)\//.test(url)) throw new Error(`Unexpected attachment host: ${url}`);
  const fromName = url.match(/(20\d\d-\d\d-\d\d)/)?.[1] ?? null;
  const publishedAt = fromName ?? (body.public_updated_at ? String(body.public_updated_at).slice(0, 10) : null);
  return { url, publishedAt, title: csv.title ?? 'Register of licensed sponsors' };
}

export async function refreshFromOfficial(): Promise<RefreshOutcome> {
  try {
    const { url, publishedAt } = await findOfficialCsv();
    const db = getDb();
    const res = await politeFetch(url, { sourceId: 'govuk', accept: 'text/csv', timeoutMs: 120000, maxBytes: 80 * 1024 * 1024, binary: true });
    if (!res.ok || !res.buffer) throw new Error(`Download failed: HTTP ${res.status}`);
    if (res.buffer.length < 1_000_000) throw new Error(`Downloaded file is implausibly small (${res.buffer.length} bytes).`);
    const dir = path.join(dataDir(), 'sponsor-downloads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `register-${publishedAt ?? Date.now()}.csv`);
    fs.writeFileSync(file, res.buffer);
    const { sha256 } = await import('../util/text.js');
    const hash = sha256(res.buffer);
    const same = db.get('SELECT id FROM sponsor_snapshots WHERE sha256 = ? AND valid = 1 AND active = 1', hash);
    if (same) return { status: 'UNCHANGED', message: 'Official CSV is identical to the active snapshot.', attachmentUrl: url, publishedAt };
    const result = await importSponsorCsv(file, { sourceUrl: url, publishedAt });
    return { status: 'IMPORTED', message: `Imported ${result.rowCount} rows (${result.skilledWorkerCount} Skilled Worker).`, attachmentUrl: url, publishedAt, result };
  } catch (e) {
    return { status: 'FAILED', message: `Refresh failed; previous snapshot kept and marked by age. ${(e as Error).message}` };
  }
}
