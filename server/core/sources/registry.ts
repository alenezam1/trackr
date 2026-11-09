import { getDb } from '../../db/db.js';
import type { JobSourceAdapter, SourceAccessResult } from './types.js';
import { boardAdapters } from './boards.js';
import { adzunaAdapter, joobleAdapter, reedAdapter } from './apis.js';
import { googleJobsAdapter, siteSearchAdapter } from './websearch.js';
import { listAtsJobs, type AtsType } from './ats.js';
import { gradcrackerAdapter } from './gradcracker.js';
import { arbeitnowAdapter, himalayasAdapter, hnAdapter, nhsAdapter } from './feeds.js';
import { aiWebSearchAdapter } from '../ai/webSearch.js';

const PROBES: Record<AtsType, string> = { greenhouse: 'monzo', lever: 'zopa', ashby: 'faculty', smartrecruiters: 'Visa', recruitee: 'bunq', personio: 'personio', teamtailor: 'career', workable: 'flo-health' };

function atsAdapter(ats: AtsType, name: string, docs: string): JobSourceAdapter {
  return {
    id: `ats_${ats}`, displayName: `${name} public job boards`, sourceHomepage: docs, mode: 'PUBLIC_ATS', kind: 'ATS',
    description: `Documented public ${name} job-board API used by employers for their own careers pages. Full job descriptions are read from it for every tracked employer on ${name}.`,
    async verifyAccess(): Promise<SourceAccessResult> {
      const r = await listAtsJobs({ id: 0, canonical_name: PROBES[ats], ats_type: ats, ats_token: PROBES[ats] });
      return r.ok ? { status: 'CONNECTED', message: `Probe board "${PROBES[ats]}" returned ${r.jobs.length} postings.` } : { status: r.blocked ? 'BLOCKED' : 'ERROR', message: r.error ?? 'Probe failed' };
    },
  };
}

const manualAdapter: JobSourceAdapter = {
  id: 'user_link', displayName: 'Paste link / JD text (any site)', sourceHomepage: '', mode: 'MANUAL_IMPORT', kind: 'MANUAL',
  description: 'Import any posting by URL or pasted text. Public ATS links are read via their API; employer pages only when robots.txt allows; board pages are never fetched automatically.',
  async verifyAccess() { return { status: 'CONNECTED', message: 'Always available.' }; },
};

export function allAdapters(): JobSourceAdapter[] {
  return [
    ...boardAdapters(),
    gradcrackerAdapter,
    atsAdapter('greenhouse', 'Greenhouse', 'https://developers.greenhouse.io/job-board.html'),
    atsAdapter('lever', 'Lever', 'https://github.com/lever/postings-api'),
    atsAdapter('ashby', 'Ashby', 'https://developers.ashbyhq.com/docs/public-job-posting-api'),
    atsAdapter('smartrecruiters', 'SmartRecruiters', 'https://developers.smartrecruiters.com/docs/posting-api'),
    atsAdapter('recruitee', 'Recruitee', 'https://docs.recruitee.com/reference/offers'),
    atsAdapter('personio', 'Personio', 'https://support.personio.de/hc/en-us/articles/207576365'),
    atsAdapter('teamtailor', 'Teamtailor', 'https://www.teamtailor.com/'),
    atsAdapter('workable', 'Workable', 'https://help.workable.com/hc/en-us/articles/115012771647'),
    {
      id: 'ats_workday', displayName: 'Workday careers sites', sourceHomepage: 'https://www.workday.com/', mode: 'UNAVAILABLE', kind: 'ATS',
      description: 'Workday has no documented public job-posting API; the app does not call undocumented endpoints. Use Import with a posting link (read only if robots.txt allows) or paste the JD.',
      async verifyAccess() { return { status: 'PERMISSION_REQUIRED', message: 'No documented public API — manual import only.' }; },
    },
    reedAdapter, adzunaAdapter, joobleAdapter, nhsAdapter, arbeitnowAdapter, himalayasAdapter, hnAdapter, aiWebSearchAdapter, googleJobsAdapter, siteSearchAdapter, manualAdapter,
  ];
}

export function getAdapter(id: string) { return allAdapters().find((a) => a.id === id) ?? null; }

export function ensureSourceRows() {
  const db = getDb();
  for (const a of allAdapters()) {
    db.run(`INSERT INTO source_connections(source_id, capability_mode, status) VALUES (?, ?, 'NOT_CONFIGURED')
            ON CONFLICT(source_id) DO UPDATE SET capability_mode = excluded.capability_mode`, a.id, a.mode);
  }
}

export function recordSourceResult(sourceId: string, r: { ok: boolean; status?: string; error?: string | null; links?: number; fullJds?: number }) {
  const db = getDb();
  const t = new Date().toISOString();
  db.run(`UPDATE source_connections SET last_attempt_at = ?, last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
            last_error = CASE WHEN ? THEN NULL ELSE ? END, status = COALESCE(?, status),
            links_found = links_found + ?, full_jds = full_jds + ?, failures = CASE WHEN ? THEN 0 ELSE failures + 1 END WHERE source_id = ?`,
    t, r.ok, t, r.ok, r.error ?? null, r.status ?? null, r.links ?? 0, r.fullJds ?? 0, r.ok, sourceId);
}

export async function verifySource(id: string) {
  const a = getAdapter(id);
  if (!a) throw new Error('Unknown source');
  const r = await a.verifyAccess();
  const db = getDb();
  db.run('UPDATE source_connections SET status = ?, notes = ?, last_attempt_at = ?, last_error = ? WHERE source_id = ?',
    r.status, r.message, new Date().toISOString(), ['ERROR', 'BLOCKED', 'AUTH_REQUIRED'].includes(r.status) ? r.message : null, id);
  if (r.status === 'CONNECTED') db.run('UPDATE source_connections SET last_success_at = ? WHERE source_id = ?', new Date().toISOString(), id);
  return r;
}
