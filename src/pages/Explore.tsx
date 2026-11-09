import React from 'react';
import { Search as SearchIcon, Globe, Play } from 'lucide-react';
import { api, openExternal } from '../api';
import { AppCtx } from '../App';
import { Empty, ErrorBox, RoleFocusToggle, Spinner, useAsync } from '../components/ui';
import { JobCard } from '../components/JobCard';
import { FilterTrace } from '../components/Scan';

const MODES: Array<[string, string]> = [['ALL', 'All 3 Disciplines'], ['SOC', 'SOC / Technical Cyber'], ['GRC', 'GRC / Non-Technical Cyber'], ['IT', 'IT / Infrastructure'], ['INTERNSHIPS', 'Internships Only'], ['OFFCYCLE', 'Off-Cycle Internships Only'], ['FIXED12', 'Fixed-Term <=12 Months'], ['CUSTOM', 'Custom']];
const EXAMPLES = ['6-month GRC off-cycle internships in London', 'IT support anywhere in the UK', 'remote SOC', 'non-technical cyber audit', 'IT helpdesk jobs in universities', 'graduate cybersecurity roles anywhere in the UK'];

function load<T>(k: string, d: T): T { try { const v = localStorage.getItem('sf:explore:' + k); return v ? JSON.parse(v) : d; } catch { return d; } }
function store(k: string, v: unknown) { try { localStorage.setItem('sf:explore:' + k, JSON.stringify(v)); } catch { /* */ } }

export function Explore({ tick }: { tick: number }) {
  const { openJob, toast, refreshStatus, status, setRoleFocus } = React.useContext(AppCtx);
  const focus = status?.roleFocus ?? 'BOTH';
  const [q, setQ] = React.useState<string>(() => load('q', ''));
  const [submitted, setSubmitted] = React.useState(q);
  const [mode, setMode] = React.useState<string>(() => load('mode', 'ALL'));
  const [chips, setChips] = React.useState<Record<string, boolean>>(() => load('chips', { potential: true, london: false, internship: false, offcycle: false, verifiedOnly: false, remote: false }));
  const [sort, setSort] = React.useState<string>(() => load('sort', 'fit'));
  React.useEffect(() => { store('q', submitted); store('mode', mode); store('chips', chips); store('sort', sort); }, [submitted, mode, chips, sort]);

  const statuses = chips.verifiedOnly ? 'VERIFIED_COMPATIBLE' : chips.potential ? 'VERIFIED_COMPATIBLE,POTENTIAL_NO_STATED_BLOCKER' : 'VERIFIED_COMPATIBLE';
  const params = new URLSearchParams({ q: submitted, mode, statuses, sort, ...(chips.internship || focus === 'INTERNSHIP' ? { internship: '1' } : {}), ...(focus === 'GRADUATE' ? { graduate: '1' } : {}), ...(chips.offcycle ? { offcycle: '1' } : {}), ...(chips.london ? { location: 'LONDON' } : chips.remote ? { location: 'REMOTE' } : {}) });
  const { data, error, loading, reload } = useAsync(() => api(`/api/jobs?${params}`), [params.toString(), tick, focus]);
  const links = useAsync(() => api(`/api/search-links?q=${encodeURIComponent(submitted)}&mode=${mode}`), [submitted, mode]);

  const runLive = async () => {
    try { await api('/api/scan', { body: { mode: 'KEYWORD', query: submitted, searchMode: mode } }); refreshStatus(); toast('Live search started — results appear here as they are analysed'); } catch (e: any) { toast(e.message); }
  };
  const chip = (k: string, label: string) => <button key={k} className={`chip ${chips[k] ? 'chip-on' : ''}`} aria-pressed={!!chips[k]} onClick={() => setChips({ ...chips, [k]: !chips[k] })}>{label}</button>;

  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }}>
        <div className="relative flex-1">
          <SearchIcon size={15} className="absolute left-2.5 top-2.5 text-mute" />
          <input className="input pl-8 py-2 text-[14px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder='Try “off-cycle internships London”, “IT”, “GRC no coding”, “remote security analyst”' aria-label="Search jobs" />
        </div>
        <button className="btn btn-primary" type="submit">Search saved results</button>
        <button className="btn" type="button" disabled={!!status?.scan} onClick={runLive} title="Runs discovery across all enabled sources for this query"><Play size={14} />Search live sources</button>
      </form>
      <div className="flex flex-wrap gap-1.5 items-center">
        <RoleFocusToggle value={focus} onChange={setRoleFocus} />
        {MODES.map(([k, l]) => <button key={k} className={`chip ${mode === k ? 'chip-on' : ''}`} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {chip('internship', 'Internship')}{chip('offcycle', 'Off-cycle')}{chip('london', 'London')}{chip('remote', 'Remote/Hybrid')}{chip('verifiedOnly', 'Verified only')}{chip('potential', 'Include jobs with no stated restrictions')}
        <span className="chip chip-on cursor-default" title="Always enforced">Paid only · 0–2 years · Sponsor-licensed · No SC/DV/CTC</span>
        <select className="input w-40 ml-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="fit">Sort: fit</option><option value="recent">Sort: newest</option><option value="deadline">Sort: deadline</option></select>
      </div>
      {!submitted && <div className="flex flex-wrap gap-1.5 text-xs text-mute">Examples: {EXAMPLES.map((e) => <button key={e} className="underline hover:text-accent" onClick={() => { setQ(e); setSubmitted(e); }}>{e}</button>)}</div>}
      {data?.policyWarnings?.map((w: string, i: number) => <div key={i} className="card p-3 border-warn/50 text-warn text-sm">{w}</div>)}
      {data?.intent && submitted && <div className="text-xs text-mute">Interpreted as: {data.intent.categories.join(', ')}{data.intent.offCycleOnly ? ' · off-cycle only' : data.intent.internshipsOnly ? ' · internships only' : ''}{data.intent.location ? ` · ${data.intent.location}` : ''}{data.intent.maxContractMonths ? ` · ≤${data.intent.maxContractMonths} months` : ''}{data.intent.keywords.length ? ` · keywords: ${data.intent.keywords.join(', ')}` : ''} — hard eligibility rules always apply.</div>}
      <div className="card p-3"><FilterTrace t={data?.trace} compact /></div>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner label="Searching…" /> : data?.jobs?.length ? (
        <>
          <div className="text-sm text-mute">{data.total} matching viable roles</div>
          <div className="grid xl:grid-cols-2 gap-3">{data.jobs.map((j: any) => <JobCard key={j.id} job={j} onOpen={openJob} showAddToDaily onChanged={(m) => { toast(m); reload(); }} />)}</div>
        </>
      ) : <Empty title="No viable roles match yet">Try “Search live sources”, widen the filters, or check the Needs Review queue. Jobs awaiting sponsor-entity confirmation appear there, not here.</Empty>}

      <details className="card p-4" open={false}>
        <summary className="cursor-pointer font-medium flex items-center gap-2"><Globe size={14} />Open this search on the job boards (in your browser)</summary>
        <div className="text-xs text-mute mt-2 mb-3">These boards don't allow automated crawling or need your login. Open them, then paste interesting links on the Import page — the app reads the employer posting and runs all checks.</div>
        <div className="grid md:grid-cols-2 gap-3">
          {links.data?.boards?.map((b: any) => (
            <div key={b.id}><div className="text-sm font-medium">{b.name}</div>{b.links.map((l: any) => <button key={l.url} className="block text-left text-xs text-accent hover:underline mt-0.5" onClick={() => openExternal(l.url)}>{l.label}</button>)}</div>
          ))}
          <div><div className="text-sm font-medium">Google (manual, opens in browser)</div>{links.data?.google?.map((l: any) => <button key={l.url} className="block text-left text-xs text-accent hover:underline mt-0.5" onClick={() => openExternal(l.url)}>{l.label}</button>)}</div>
        </div>
      </details>
    </div>
  );
}
