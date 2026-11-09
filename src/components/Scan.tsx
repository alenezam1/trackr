import React from 'react';
import { api, fmtDateTime } from '../api';
import { Square } from 'lucide-react';
import { Spinner } from './ui';
import { ScanConsole, SearchEfficacy } from './ScanConsole';

export function FilterTrace({ t, compact }: { t: any; compact?: boolean }) {
  if (!t) return null;
  const steps: Array<[string, number, string?]> = [
    ['Stored discoveries', t.discoveries],
    ['Sponsor matches (verified entity)', t.sponsorMatches],
    ['Full JDs read', t.fullJds],
    ['Hard exclusions', t.hardExclusions, 'text-bad'],
    ['Needs review', t.review, 'text-warn'],
    ['Viable (verified + potential)', (t.verified ?? 0) + (t.potential ?? 0), 'text-accent'],
  ];
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'text-xs' : 'text-sm'}`} aria-label="Filter trace">
      {steps.map(([l, v, cls], i) => (
        <React.Fragment key={l}>
          {i > 0 && <span className="text-mute">→</span>}
          <span className={`whitespace-nowrap ${cls ?? ''}`}><b>{v ?? 0}</b> <span className="text-mute">{l}</span></span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function ScanProgress({ run, live }: { run: any; live: boolean }) {
  const [showConsole, setShowConsole] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  React.useEffect(() => { if (!live) setStopping(false); }, [live]);
  if (!run) return null;
  const c = run.counts ?? {};
  return (
    <div className={`card p-4 ${live ? 'border-accent/50' : ''}`}>
      <div className="flex items-center gap-3 mb-2">
        <div className="h2">{live ? 'Scan in progress' : 'Last scan'}</div>
        {live && <Spinner label={run.phase} />}
        {!live && <span className="text-xs text-mute">#{run.id} · {run.mode} · {run.status} · {fmtDateTime(run.started_at)} → {fmtDateTime(run.finished_at)}</span>}
        {run.budget?.elapsedMs != null && <span className="text-xs text-mute ml-auto">Elapsed {(run.budget.elapsedMs / 1000).toFixed(0)}s · AI jobs left {run.budget.aiJobsLeft}</span>}
        {live && (
          <button className={`btn btn-sm btn-danger ${run.budget?.elapsedMs == null ? 'ml-auto' : ''}`} disabled={stopping}
            title="Stops after the current step finishes (a few seconds; an AI call in progress is allowed to finish). Everything found so far is kept."
            onClick={async () => { setStopping(true); try { await api(`/api/scan/${run.id ?? run.runId}/cancel`, { body: {} }); } catch { setStopping(false); } }}>
            <Square size={13} />{stopping ? 'Stopping…' : 'Stop scan'}
          </button>
        )}
      </div>
      {c.target > 0 && (
        <div className="mb-2">
          <div className="flex justify-between text-sm"><span><b>{(c.graded ?? 0) + (c.regraded ?? 0)}</b> roles graded with your current rules (full posting read) · target {c.target}</span><span className="text-xs text-mute">{c.regraded ? `${c.graded} new/updated + ${c.regraded} re-graded` : ''}</span></div>
          <div className="h-1.5 rounded bg-line mt-1"><div className="h-1.5 rounded bg-accent" style={{ width: `${Math.min(100, (((c.graded ?? 0) + (c.regraded ?? 0)) / c.target) * 100)}%` }} /></div>
        </div>
      )}
      <div className="text-sm flex flex-wrap gap-x-4 gap-y-1">
        {(c.page_reads || c.expired_skipped || c.known_skipped || c.dismissed_skipped) ? <span>Postings opened &amp; confirmed live <b>{c.page_reads ?? 0}</b> · expired dropped <b>{c.expired_skipped ?? 0}</b> · already graded (not re-read) <b>{c.known_skipped ?? 0}</b> · removed by you <b>{c.dismissed_skipped ?? 0}</b></span> : null}
        <span className="text-mute">Skipped: <b>{c.too_old ?? 0}</b> older than your window · <b>{c.listing_skipped ?? 0}</b> listing pages · <b>{c.unreadable_skipped ?? 0}</b> links with no readable posting{c.board_links_resolved ? ` · ${c.board_links_resolved} board links resolved to the employer posting` : ''}{c.ai_read ? ` · ${c.ai_read} postings read by AI (${c.queued_ai_read ?? 0} links sent to the AI reader)` : ''}</span>
        <span>Sponsors probed for boards <b>{c.sponsors_probed ?? 0}</b> (found <b>{c.boards_autodiscovered ?? 0}</b>)</span>
        <span>Employer boards scanned <b>{c.employers_scanned ?? 0}</b></span>
        <span>Postings seen <b>{c.links_found ?? 0}</b></span>
        <span>Out of scope <b>{c.prefilter_out_of_scope ?? 0}</b></span>
        <span>Non-UK <b>{c.prefilter_non_uk ?? 0}</b></span>
        <span>Analysed <b>{c.prefilter_passed ?? 0}</b> (new {c.new_jobs ?? 0})</span>
        <span>Full JDs <b>{c.full_jds ?? 0}</b></span>
        <span className="text-ok">Verified <b>{c.verified ?? 0}</b></span>
        <span className="text-info">Potential <b>{c.potential ?? 0}</b></span>
        <span className="text-warn">Review <b>{c.review ?? 0}</b></span>
        <span className="text-bad">Excluded <b>{c.excluded ?? 0}</b></span>
        <span>Closed detected <b>{c.closed_detected ?? 0}</b></span>
        <span>AI calls <b>{c.ai_calls ?? 0}</b>{c.ai_errors ? ` (${c.ai_errors} errors)` : ''}</span>
      </div>
      {run.errors?.length > 0 && <details className="mt-2 text-xs text-warn"><summary>{run.errors.length} source errors (provider errors are NOT “no jobs”)</summary>{run.errors.slice(0, 30).map((e: string, i: number) => <div key={i}>{e}</div>)}</details>}
      {(run.id ?? run.runId) && (
        <details open={live || showConsole} onToggle={(e) => setShowConsole((e.target as HTMLDetailsElement).open)} className="mt-2">
          <summary className="text-sm cursor-pointer select-none">{live ? 'Live: what the search is doing' : 'What the search did (console + efficacy)'}</summary>
          <ScanConsole runId={run.id ?? run.runId} live={live} />
          <SearchEfficacy runId={run.id ?? run.runId} live={live} />
        </details>
      )}
    </div>
  );
}
