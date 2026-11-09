import React from 'react';
import { api } from '../api';
import { AppCtx } from '../App';
import { Empty, ErrorBox, Spinner, useAsync, Badge, RoleFocusToggle } from '../components/ui';
import { JobCard } from '../components/JobCard';

export function Daily15({ tick }: { tick: number }) {
  const { openJob, toast, go, status, setRoleFocus } = React.useContext(AppCtx);
  const focus = status?.roleFocus ?? 'BOTH';
  const [verifiedOnly, setVerifiedOnly] = React.useState(() => localStorage.getItem('sf:daily:verifiedOnly') === '1');
  const { data, error, loading, reload } = useAsync(() => api('/api/daily'), [tick]);
  React.useEffect(() => { try { localStorage.setItem('sf:daily:verifiedOnly', verifiedOnly ? '1' : '0'); } catch { /* */ } }, [verifiedOnly]);
  // Saving these settings re-fills today's batch on the server.
  const saveDaily = async (patch: Record<string, unknown>) => { try { await api('/api/settings', { body: patch }); reload(); } catch (e: any) { toast(e.message); } };
  const build = async (alternateMix = false) => { try { await api('/api/daily/build', { body: { alternateMix } }); reload(); toast(alternateMix ? 'Alternate mix accepted and recorded' : 'Daily batch refreshed'); } catch (e: any) { toast(e.message); } };

  if (loading && !data) return <Spinner label="Loading…" />;
  const s = data?.summary;
  const isIntern = (j: any) => j.employmentType === 'INTERNSHIP' || j.employmentType === 'OFF_CYCLE_INTERNSHIP';
  const jobs = (data?.jobs ?? []).filter((j: any) => (!verifiedOnly || j.status === 'VERIFIED_COMPATIBLE' || (j.market && j.market !== 'UK' && j.status === 'POTENTIAL_NO_STATED_BLOCKER'))
    && (focus === 'BOTH' || (focus === 'INTERNSHIP' ? isIntern(j) : !isIntern(j))));
  const cyber = jobs.filter((j: any) => j.slot === 'CYBER_GRC');
  const it = jobs.filter((j: any) => j.slot === 'IT');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="h1 flex-1">Daily 15 · {data?.date}</div>
        <RoleFocusToggle value={focus} onChange={(f) => { setRoleFocus(f); setTimeout(() => build(false), 400); }} />
        <label className="chip"><input type="checkbox" className="mr-1" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />Verified only</label>
        <button className="btn" onClick={() => build(false)}>Fill open slots</button>
      </div>
      {data?.settings && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-mute">Countries:</span>
          {[['UK', '🇬🇧 UK'], ['UAE', '🇦🇪 UAE'], ['QATAR', '🇶🇦 Qatar'], ['SAUDI', '🇸🇦 Saudi']].map(([m, label]) => {
            const on = data.settings.markets.includes(m);
            return (
              <button key={m} className={`chip ${on ? 'chip-on' : ''}`} onClick={() => saveDaily({ daily_markets: on ? data.settings.markets.filter((x: string) => x !== m) : [...data.settings.markets, m] })}>{label}</button>
            );
          })}
          <label className="chip ml-2" title="When there aren't enough Eligible jobs, empty slots are filled with the best 'Needs review' jobs (no blocker found, one point to check) — clearly labelled.">
            <input type="checkbox" className="mr-1" checked={data.settings.fillWithReview} onChange={(e) => saveDaily({ daily_fill_with_review: e.target.checked })} />Fill empty slots with “Needs review”
          </label>
        </div>
      )}
      <ErrorBox error={error} />
      {s ? (
        <div className="card p-4">
          <div className="text-lg font-semibold">{s.message}</div>
          <div className="text-sm text-mute mt-1">Target {s.targetCyber} Security/GRC + {s.targetIt} IT/Infrastructure · selected {s.cyberSelected} + {s.itSelected}. The counter is never filled with invented or rule-breaking roles.</div>
          {s.alternateMix && <div className="text-xs text-info mt-1">{s.alternateMix}</div>}
          {s.shortfall > 0 && (s.cyberSelected < s.targetCyber) !== (s.itSelected < s.targetIt) && (
            <button className="btn btn-sm mt-2" onClick={() => build(true)}>Accept alternate mix (fill from the other category) — recorded</button>
          )}
          <div className="text-xs text-mute mt-2">“Eligible” = the full posting states no visa, right-to-work, clearance, citizenship or nationals-only restriction. “Needs review” = no blocker found, but one point is unclear (e.g. experience not stated) — check it before applying. The batch refills automatically after every scan.</div>
        </div>
      ) : (
        <Empty title="No batch for today yet">Run <button className="underline text-accent" onClick={() => go('dashboard')}>Find today's roles</button>, or press “Fill open slots” to select from jobs already analysed.</Empty>
      )}
      {[['Security / SOC / GRC', cyber, s?.targetCyber], ['IT / Infrastructure', it, s?.targetIt]].map(([title, list, target]: any) => (
        <section key={title}>
          <div className="flex items-center gap-2 mb-2"><div className="h2">{title}</div><Badge>{list.length}/{target ?? 0}</Badge></div>
          <div className="grid xl:grid-cols-2 gap-3">
            {list.map((j: any) => (
              <div key={j.id} className="relative">
                <div className="absolute -left-2 -top-2 z-10 text-[10px] bg-panel2 border border-line rounded px-1">#{j.rank}{j.addedBy === 'USER' ? ' · added by you' : ''}{j.status === 'NEEDS_REVIEW' ? ' · needs review — open "Read JD & Evidence" for the point to check' : ''}</div>
                <JobCard job={j} onOpen={openJob} onChanged={(m) => { toast(m); reload(); }} />
                <button className="btn btn-sm mt-1" onClick={async () => { await api('/api/daily/remove', { body: { jobId: j.id, note: 'Removed by user' } }); reload(); }}>Remove from today</button>
              </div>
            ))}
            {list.length === 0 && s && <div className="text-mute text-sm">No eligible roles in this category right now.</div>}
          </div>
        </section>
      ))}
      {data?.removed?.length > 0 && (
        <details className="card p-3 text-sm"><summary className="cursor-pointer text-mute">Removed / replaced today ({data.removed.length}) — audit trail</summary>
          {data.removed.map((j: any) => <div key={j.id} className="text-xs mt-1">{j.title} · {j.employer} — {j.batchNote}</div>)}
        </details>
      )}
      {data?.history?.length > 1 && (
        <details className="card p-3 text-sm"><summary className="cursor-pointer text-mute">Batch history</summary>
          {data.history.map((h: any) => <div key={h.date} className="text-xs mt-1">{h.date}: {h.summary?.message ?? '—'}</div>)}
        </details>
      )}
    </div>
  );
}
