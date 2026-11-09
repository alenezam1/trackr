import React from 'react';
import { api, openExternal } from '../api';

const STAGES = ['PLAN', 'SOURCE', 'SEARCH', 'FILTER', 'OPEN', 'CAREERS', 'AI', 'GRADE', 'SKIP', 'SUMMARY', 'ERROR'] as const;
const STAGE_HELP: Record<string, string> = {
  PLAN: 'What the scan is about to do', SOURCE: 'Each source / employer board', SEARCH: 'Every search sent and what came back',
  FILTER: 'Postings dropped and why', OPEN: 'Postings opened to check they are live', CAREERS: "Looking for the employer's own careers page",
  AI: 'OpenAI reader confirming postings', GRADE: 'Final decision per job', SKIP: 'Skipped to save credits', SUMMARY: 'Totals', ERROR: 'Problems',
};
const STAGE_TONE: Record<string, string> = {
  PLAN: 'text-accent', SOURCE: 'text-info', SEARCH: 'text-info', FILTER: 'text-mute', OPEN: 'text-ink', CAREERS: 'text-ok',
  AI: 'text-accent', GRADE: 'text-ok', SKIP: 'text-mute', SUMMARY: 'text-accent', ERROR: 'text-bad',
};

/** Live log of what the search algorithm is doing during a scan (polls new lines every 1.5 s while the scan runs). */
export function ScanConsole({ runId, live }: { runId: number; live: boolean }) {
  const [events, setEvents] = React.useState<any[]>([]);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [follow, setFollow] = React.useState(true);
  const [q, setQ] = React.useState('');
  const lastId = React.useRef(0);
  const box = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setEvents([]); lastId.current = 0;
    let alive = true;
    const tick = async () => {
      try {
        for (let i = 0; i < 6; i++) { // catch up quickly on long logs
          const r: any[] = await api(`/api/runs/${runId}/events?after=${lastId.current}&limit=500`);
          if (!alive || !r.length) break;
          lastId.current = r[r.length - 1].id;
          setEvents((e) => [...e, ...r].slice(-4000));
          if (r.length < 500) break;
        }
      } catch { /* keep polling */ }
    };
    tick();
    const t = live ? setInterval(tick, 1500) : null;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [runId, live]);

  React.useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [events, follow]);

  const counts: Record<string, number> = {};
  for (const e of events) counts[e.stage] = (counts[e.stage] ?? 0) + 1;
  const shown = events.filter((e) => !hidden.has(e.stage) && (!q || e.msg.toLowerCase().includes(q.toLowerCase())));
  const toggle = (s: string) => setHidden((h) => { const n = new Set(h); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5 text-xs">
        <span className="font-semibold mr-1">Scan console</span>
        {STAGES.filter((s) => counts[s]).map((s) => (
          <button key={s} title={STAGE_HELP[s]} onClick={() => toggle(s)} className={`px-1.5 py-0.5 rounded border border-line ${hidden.has(s) ? 'opacity-40' : ''} ${STAGE_TONE[s]}`}>{s} {counts[s]}</button>
        ))}
        <input className="input h-6 text-xs w-40 ml-auto" placeholder="Filter text…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow</label>
      </div>
      <div ref={box} className="h-80 overflow-auto rounded border border-line bg-black/80 p-2 font-mono text-[11px] leading-[1.45]" aria-label="Scan console">
        {shown.length === 0 && <div className="text-mute">{live ? 'Waiting for the first steps…' : 'No console lines recorded for this scan (scans before this version had none).'}</div>}
        {shown.map((e) => (
          <div key={e.id} className="whitespace-pre-wrap break-words">
            <span className="text-mute">{e.at.slice(11, 19)} </span>
            <span className={`${STAGE_TONE[e.stage] ?? ''} font-semibold`}>{e.stage.padEnd(7)}</span>{' '}
            <span className="text-[#e6e6e6]">{e.msg}</span>
            {e.data?.url && <button className="ml-1 underline text-info" onClick={() => openExternal(e.data.url)}>open</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Per search engine and per site: did the searches find real, gradeable roles? */
export function SearchEfficacy({ runId, live }: { runId: number; live: boolean }) {
  const [data, setData] = React.useState<any>(null);
  React.useEffect(() => {
    let alive = true;
    const load = () => api(`/api/runs/${runId}/efficacy`).then((d) => alive && setData(d)).catch(() => {});
    load();
    const t = live ? setInterval(load, 8000) : null;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [runId, live]);
  if (!data || (!data.sites.length && !Object.keys(data.providers).length)) return null;
  const verdict = (r: any) => r.searches >= 3 && r.graded === 0 && r.kept === 0 ? ['Not finding postings', 'text-bad']
    : r.searches >= 3 && r.graded === 0 ? ['Finds links, none live/relevant', 'text-warn']
    : r.eligible > 0 ? ['Finding eligible roles', 'text-ok'] : r.graded > 0 ? ['Finding roles', 'text-info'] : ['—', 'text-mute'];
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold mb-1">Search engine efficacy (this scan)</div>
      <div className="flex flex-wrap gap-3 text-xs mb-1.5">
        {Object.entries(data.providers).map(([p, v]: any) => (
          <span key={p} className="px-2 py-0.5 rounded border border-line"><b>{p}</b>: {v.searches} searches · {v.results} results · {v.kept} postings kept · {v.relevant ?? 0} on-target{v.failed ? ` · ${v.failed} failed` : ''}{v.searches ? ` · ${((v.relevant ?? 0) / v.searches).toFixed(2)} on-target per search` : ''}</span>
        ))}
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="tbl w-full text-xs">
          <thead><tr><th>Site</th><th>Searches</th><th>Results</th><th>Postings kept</th><th>On-target</th><th>Closed / old / unreadable</th><th>Graded</th><th>Eligible</th><th>Verdict</th></tr></thead>
          <tbody>{data.sites.map((r: any) => { const [v, tone] = verdict(r); return (
            <tr key={r.site}><td className="font-mono">{r.site}</td><td>{r.searches || '—'}</td><td>{r.results || '—'}</td><td>{r.kept || '—'}{r.keptPerSearch != null ? <span className="text-mute"> ({r.keptPerSearch}/search)</span> : null}</td>
              <td>{r.relevant || '—'}</td>
              <td>{r.dead || '—'}</td><td>{r.graded || '—'}</td><td className="text-ok">{r.eligible || '—'}</td><td className={tone}>{v}</td></tr>
          ); })}</tbody>
        </table>
      </div>
    </div>
  );
}
