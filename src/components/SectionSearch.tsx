import React from 'react';
import { Play, Search as SearchIcon, Sparkles } from 'lucide-react';
import { api } from '../api';
import { AppCtx } from '../App';
import { Empty, ErrorBox, RoleFocusToggle, Spinner, useAsync } from './ui';
import { JobCard } from './JobCard';
import { ScanProgress } from './Scan';

/** Search + results panel scoped to one section: 'registry' (sponsor careers pages) or 'boards' (job boards). */
export function SectionSearch({ group, scope, runLabel, tick, market }: { group: 'registry' | 'boards' | null; scope: 'REGISTRY' | 'BOARDS' | 'GULF'; runLabel: string; tick: number; market?: string }) {
  const { openJob, toast, refreshStatus, status, setRoleFocus } = React.useContext(AppCtx);
  const focus = status?.roleFocus ?? 'BOTH';
  const [q, setQ] = React.useState('');
  const [submitted, setSubmitted] = React.useState('');
  const [statuses, setStatuses] = React.useState<string>('VERIFIED_COMPATIBLE,POTENTIAL_NO_STATED_BLOCKER');
  const [sort, setSort] = React.useState('fit');
  const [london, setLondon] = React.useState(false);
  const [limit, setLimit] = React.useState(40);
  const params = new URLSearchParams({ ...(group ? { group } : {}), ...(market ? { market } : {}), q: submitted, statuses, sort, limit: String(limit), demo: '0',
    ...(market ? {} : focus === 'INTERNSHIP' ? { internship: '1' } : focus === 'GRADUATE' ? { graduate: '1' } : {}), ...(london && !market ? { location: 'LONDON' } : {}) });
  const { data, error, loading, reload } = useAsync(() => api(`/api/jobs?${params}`), [params.toString(), tick]);
  const sameSection = status?.lastRun?.intent?.scope === scope && (!market || status?.lastRun?.intent?.market === market);
  const live = !!status?.scan && sameSection;

  const run = async () => {
    try { await api('/api/scan', { body: { mode: 'KEYWORD', query: submitted, scope, market, roleFocus: focus } }); refreshStatus(); toast(`${runLabel} started`); }
    catch (e: any) { toast(e.message); }
  };
  const aiRank = async () => {
    try { const r = await api('/api/ai/rank', { body: { jobIds: (data?.jobs ?? []).slice(0, 25).map((j: any) => j.id) } }); toast(`AI ranked ${r.ranked} job(s)${r.errors?.length ? ` — ${r.errors[0]}` : ''}`); reload(); }
    catch (e: any) { toast(e.message); }
  };
  const statusChip = (v: string, label: string) => <button className={`chip ${statuses === v ? 'chip-on' : ''}`} onClick={() => setStatuses(v)}>{label}</button>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!market && <RoleFocusToggle value={focus} onChange={setRoleFocus} />}
        <form className="flex-1 flex gap-2 min-w-[320px]" onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }}>
          <div className="relative flex-1">
            <SearchIcon size={15} className="absolute left-2.5 top-2.5 text-mute" />
            <input className="input pl-8 py-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Optional: type role types, e.g. “cloud security”, “IT audit”, “SOC”…" aria-label="Search" />
          </div>
          <button className="btn" type="submit">Filter results</button>
        </form>
        <button className="btn btn-primary" disabled={!!status?.scan} onClick={run}><Play size={14} />{runLabel}</button>
      </div>
      {sameSection && <ScanProgress run={status.lastRun} live={live} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {statusChip('VERIFIED_COMPATIBLE,POTENTIAL_NO_STATED_BLOCKER', 'Eligible')}
        {statusChip('NEEDS_REVIEW', 'Needs review')}
        {statusChip('EXCLUDED,STALE', 'Rejected')}
        {statusChip('VERIFIED_COMPATIBLE,POTENTIAL_NO_STATED_BLOCKER,NEEDS_REVIEW,EXCLUDED,STALE', 'Everything')}
        {!market && <button className={`chip ${london ? 'chip-on' : ''}`} onClick={() => setLondon(!london)}>London only</button>}
        <select className="input w-44 ml-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="fit">Sort: fit score</option><option value="ai">Sort: AI rank</option><option value="recent">Sort: newest</option><option value="deadline">Sort: deadline</option>
        </select>
        <button className="btn btn-sm" onClick={aiRank} title="Score the shown jobs with AI on 5 dimensions (needs OpenAI key)"><Sparkles size={13} />AI rank these</button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner label="Loading…" /> : data?.jobs?.length ? (
        <>
          <div className="text-sm text-mute">{data.total} jobs</div>
          <div className="grid xl:grid-cols-2 gap-3">{data.jobs.map((j: any) => <JobCard key={j.id} job={j} onOpen={openJob} showAddToDaily onChanged={(m) => { toast(m); reload(); }} />)}</div>
          {data.total > limit && <button className="btn" onClick={() => setLimit(limit + 40)}>Load more</button>}
        </>
      ) : <Empty title="No jobs here yet">Press “{runLabel}”. Searches use your target roles and rules from My Search &amp; Rules.</Empty>}
    </div>
  );
}
