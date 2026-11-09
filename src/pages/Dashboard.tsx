import React from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import { api, fmtDateTime } from '../api';
import { AppCtx } from '../App';
import { Badge, ErrorBox, RoleFocusToggle, Spinner, Stat } from '../components/ui';
import { FilterTrace, ScanProgress } from '../components/Scan';
import { DeadlineRadar } from '../components/Radar';

export function Dashboard() {
  const { status: s, refreshStatus, go, toast, setRoleFocus, openJob } = React.useContext(AppCtx);
  const [err, setErr] = React.useState<string | null>(null);
  if (!s) return <Spinner label="Loading…" />;
  const start = async (mode: string) => {
    setErr(null);
    try { await api('/api/scan', { body: { mode } }); refreshStatus(); toast('Scan started'); } catch (e: any) { setErr(e.message); }
  };
  const d = s.daily;
  const funnel = Object.fromEntries((s.funnel ?? []).map((f: any) => [f.stage, f.n]));
  const health = (s.sources ?? []).reduce((acc: any, x: any) => { acc[x.status] = (acc[x.status] ?? 0) + 1; return acc; }, {});
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="h1 flex-1">Today · {s.today}</div>
        <RoleFocusToggle value={s.roleFocus ?? 'BOTH'} onChange={setRoleFocus} />
        {s.scan ? (
          <button className="btn btn-danger" onClick={async () => { await api(`/api/scan/${s.scan.runId}/cancel`, { body: {} }); refreshStatus(); }}><Square size={14} />Cancel scan</button>
        ) : (
          <>
            <button className="btn" onClick={() => start('RECHECK')}><RefreshCw size={14} />Re-check saved jobs</button>
            <button className="btn btn-primary text-[14px] px-4 py-2" disabled={!s.snapshot} onClick={() => start('MANUAL_FULL')}><Play size={15} />Find today's roles</button>
          </>
        )}
      </div>
      <ErrorBox error={err} />
      {!s.snapshot && <div className="card p-4 border-warn/50 text-warn">No sponsor register imported. Go to <button className="underline" onClick={() => go('sponsors')}>Sponsors</button> to import the CSV — every search is gated on it.</div>}
      {s.employers?.proposed > 0 && (
        <div className="card p-4 border-info/40 text-sm">
          <b className="text-info">{s.employers.proposed} employer → legal-entity mappings await your confirmation.</b> Jobs from those employers stay in <i>Needs Review</i> until you confirm the
          register row is the actual employer. <button className="underline text-accent" onClick={() => go('sponsors')}>Review mappings</button>
        </div>
      )}
      {s.permission?.currentRightToWork !== 'CONFIRMED' && (
        <div className="card p-3 text-xs text-mute">Work permission not confirmed in Settings ({s.permission?.estimateBasis}) — matches can be at most <i>Potential</i>, never <i>Verified</i>. <button className="underline text-accent" onClick={() => go('settings')}>Update visa details</button></div>
      )}
      {s.permission?.rulesStale && <div className="card p-3 border-bad/50 text-bad text-sm">Graduate visa rule cache is stale: {s.permission.rulesNote}</div>}

      <ScanProgress run={s.scan ? s.lastRun : s.lastRun} live={!!s.scan} />

      <DeadlineRadar onOpen={openJob} tick={s.lastRun?.id} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Daily 15 progress" value={d ? `${d.total}/${d.targetCyber + d.targetIt}` : '0/15'} sub={d ? d.message : 'No batch yet today — run a scan'} tone="text-accent" />
        <Stat label="Viable now" value={(s.trace?.verified ?? 0) + (s.trace?.potential ?? 0)} sub={`${s.trace?.verified ?? 0} verified · ${s.trace?.potential ?? 0} potential (unconfirmed)`} />
        <Stat label="Sponsor register" value={s.snapshot ? s.snapshot.skilled_worker_count.toLocaleString() : '—'} sub={s.snapshot ? `Skilled Worker rows · ${s.snapshot.published_at} · ${s.snapshot.age} (${s.snapshot.ageDays}d)` : 'Not imported'} tone={s.snapshot?.age === 'STALE' ? 'text-bad' : ''} />
        <Stat label="Employers tracked" value={s.employers?.total ?? 0} sub={`${s.employers?.confirmed ?? 0} confirmed · ${s.employers?.proposed ?? 0} proposed · ${s.autoDiscovery?.probed ?? 0} sponsors probed, ${s.autoDiscovery?.found ?? 0} boards found`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="h2 mb-3">Filter trace (all stored discoveries)</div>
          <FilterTrace t={s.trace} />
          <div className="flex gap-2 mt-3">
            <button className="btn btn-sm" onClick={() => go('daily')}>Open Daily 15</button>
            <button className="btn btn-sm" onClick={() => go('review')}>Review queue ({s.trace?.review ?? 0})</button>
            <button className="btn btn-sm" onClick={() => go('rejected')}>Rejected ({s.trace?.hardExclusions ?? 0})</button>
          </div>
        </div>
        <div className="card p-4">
          <div className="h2 mb-3">Application funnel</div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {['Shortlisted', 'To Apply', 'Applied', 'Assessment', 'Interview', 'Offer', 'Rejected', 'Withdrawn'].map((k) => (
              <div key={k} className="card p-2"><div className="label">{k}</div><div className="text-lg font-semibold">{funnel[k] ?? 0}</div></div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <div className="h2 mb-3">Connection health</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(health).map(([k, v]) => <Badge key={k} tone={k === 'CONNECTED' ? 'ok' : k === 'LIMITED' ? 'info' : k === 'NOT_CONFIGURED' ? 'mute' : 'warn'}>{k}: {String(v)}</Badge>)}
          </div>
          <button className="btn btn-sm mt-3" onClick={() => go('sources')}>Open Sources</button>
        </div>
        <div className="card p-4 text-sm">
          <div className="h2 mb-3">Schedule &amp; AI</div>
          <div>Weekday scan: {s.schedule?.enabled ? `${s.schedule.time} Europe/London` : 'off'} · {s.schedule?.ranToday ? `ran today (#${s.schedule.todayRun?.id})` : 'not run today'}{s.schedule?.missedToday ? ' · MISSED' : ''}</div>
          <div className="text-xs text-mute mt-1">{s.schedule?.note}</div>
          {s.schedule?.lastNote && <div className="text-xs text-mute">{s.schedule.lastNote}</div>}
          <div className="mt-2">OpenAI: {s.ai?.enabled ? `on (${s.ai.model})` : 'off — rules-only analysis'} · key {s.ai?.keyConfigured ? 'saved' : 'not set'} · today ${s.ai?.spentTodayUsd?.toFixed(3)} / ${s.ai?.budgetUsd}</div>
          <div className="text-xs text-mute mt-1">Last scan: {s.lastRun ? `#${s.lastRun.id} ${s.lastRun.status} · ${fmtDateTime(s.lastRun.started_at)}` : 'never'}</div>
        </div>
      </div>
    </div>
  );
}
