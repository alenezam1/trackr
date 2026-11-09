import React from 'react';
import { Building2, Sparkles, RefreshCw } from 'lucide-react';
import { api, fmtDateTime } from '../api';
import { AppCtx } from '../App';
import { Badge, Stat, useAsync } from '../components/ui';
import { SectionSearch } from '../components/SectionSearch';

const STATUS_LABEL: Record<string, [string, any]> = {
  BOARD_FOUND: ['Careers board found', 'ok'], BOARD_FOUND_REGISTER_UNCLEAR: ['Board found · entity unclear', 'warn'],
  ON_REGISTER_NO_PUBLIC_BOARD: ['On register · no public board', 'info'], ON_REGISTER: ['On register', 'info'],
  REGISTER_UNCLEAR: ['Register match unclear', 'warn'], NOT_ON_REGISTER: ['Not on register', 'bad'],
};

export function RegistrySearch({ tick }: { tick: number }) {
  const { status, refreshStatus, toast } = React.useContext(AppCtx);
  const companies = useAsync(() => api('/api/companies'), [tick, status?.lastRun?.id]);
  const progress = useAsync(() => api('/api/registry/progress'), [tick, status?.lastRun?.id, status?.scan?.counts?.sponsors_probed]);
  const [useAi, setUseAi] = React.useState(true);
  const [limit, setLimit] = React.useState(400);
  const [extra, setExtra] = React.useState('');
  const [showList, setShowList] = React.useState(false);
  const snap = status?.snapshot;

  const start = async (body: any, msg: string) => {
    try { await api('/api/scan', { body }); refreshStatus(); toast(msg); } catch (e: any) { toast(e.message); }
  };
  const findCompanies = () => start({
    mode: 'COMPANY_DISCOVERY', scope: 'REGISTRY', companyOptions: {
      useAi, limit, extra: extra.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, url] = l.split(/\s*[,|]\s*/); return { name, careersUrl: url && /^https?:/.test(url) ? url : null }; }),
    },
  }, 'Finding companies and their careers pages…');
  const by = companies.data?.byStatus ?? {};

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2"><Building2 size={18} className="text-accent" /><div className="h1">Sponsor Registry Search</div></div>
      <div className="text-sm text-mute">Searches the <b>careers pages of licensed sponsors only</b>: employers on the Skilled Worker register whose public job boards (Greenhouse, Lever, Ashby, Workable, Teamtailor, Personio, Recruitee, SmartRecruiters) the app reads directly — full job descriptions, straight from the employer.</div>

      <div className="grid md:grid-cols-4 gap-3">
        <Stat label="Sponsor register" value={snap ? snap.skilled_worker_count.toLocaleString() : '—'} sub={snap ? `Skilled Worker · ${snap.published_at} · ${snap.age}` : 'Not imported'} />
        <Stat label="Careers boards tracked" value={status?.employers?.total ?? 0} sub={`${status?.employers?.confirmed ?? 0} confirmed by you`} />
        <Stat label="Sponsors checked for boards" value={(status?.autoDiscovery?.probed ?? 0).toLocaleString()} sub={`${status?.autoDiscovery?.found ?? 0} boards found`} />
        <Stat label="Fintech / startup list" value={Object.values(by).reduce((a: number, b: any) => a + b, 0)} sub={`${(by.BOARD_FOUND ?? 0) + (by.BOARD_FOUND_REGISTER_UNCLEAR ?? 0)} with careers boards`} />
      </div>

      {progress.data && (() => {
        const p = progress.data;
        const pct = p.totalSponsors ? Math.min(100, (p.sponsorsChecked / p.totalSponsors) * 100) : 0;
        return (
          <div className="card p-4 text-sm space-y-2">
            <div className="h2">Progress through the register</div>
            <div className="flex justify-between"><span><b>{p.sponsorsChecked.toLocaleString()}</b> of {p.totalSponsors.toLocaleString()} A-rated Skilled Worker sponsors checked for a careers board</span><span className="text-mute">{p.sponsorsLeft.toLocaleString()} left</span></div>
            <div className="h-1.5 rounded bg-line"><div className="h-1.5 rounded bg-accent" style={{ width: `${pct}%` }} /></div>
            <div className="text-mute">
              {p.boards} careers boards tracked ({p.boardsFromRegister} found from the register) · <b>{p.scanned24h}</b> scanned in the last 24h · <b>{p.dueNow}</b> due now{p.nextDue ? ` · next one due ${fmtDateTime(p.nextDue)}` : ''}.
              {' '}Each scan reads the boards that are due, then moves on to the <b>next unchecked sponsors</b>. Boards scanned in the last 20 hours are skipped, and sponsors already checked aren't checked again for 90 days.
            </div>
          </div>
        );
      })()}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4 space-y-2 text-sm">
          <div className="h2">1 · Keep the register up to date</div>
          <div className="text-mute">Downloads the newest official CSV from GOV.UK and re-checks every job against it.</div>
          <button className="btn" onClick={async () => { const r = await api('/api/sponsors/refresh', { body: {} }); toast(r.message); refreshStatus(); }}><RefreshCw size={14} />Update sponsor register now</button>
          <div className="h2 pt-3">2 · Find more sponsor careers pages</div>
          <div className="text-mute">Checks the next batch of register sponsors (London + tech/finance names first) for a public careers board.</div>
          <button className="btn" disabled={!!status?.scan} onClick={() => start({ mode: 'AUTODISCOVER', scope: 'REGISTRY' }, 'Checking 150 more sponsors for careers boards…')}>Check 150 more sponsors</button>
        </div>
        <div className="card p-4 space-y-2 text-sm">
          <div className="h2 flex items-center gap-1.5"><Sparkles size={13} />3 · Top UK fintech &amp; startup careers pages</div>
          <div className="text-mute">Uses the built-in list of ~250 UK fintech, cyber and startup employers{useAi ? ' + an AI-generated list (OpenAI web search)' : ''}. Each company is matched to the sponsor register, then its careers page / ATS board is found and added.</div>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />Ask AI for more companies</label>
            <label className="flex items-center gap-1.5">Up to <input className="input w-20" type="number" min={10} max={600} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /> companies</label>
          </div>
          <textarea className="input h-16 text-xs" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={'Optional — add your own, one per line: Company name, https://careers-page'} />
          <button className="btn btn-primary" disabled={!!status?.scan} onClick={findCompanies}>Find companies &amp; careers pages</button>
          {!status?.ai?.keyConfigured && useAi && <div className="text-xs text-warn">No OpenAI key saved — the built-in list will be used.</div>}
        </div>
      </div>

      <div className="card p-4">
        <button className="h2 w-full text-left" onClick={() => setShowList(!showList)}>{showList ? '▾' : '▸'} Company list results ({Object.entries(by).map(([k, v]) => `${STATUS_LABEL[k]?.[0] ?? k}: ${v}`).join(' · ') || 'none yet'})</button>
        {showList && (
          <div className="max-h-96 overflow-auto mt-2">
            <table className="tbl w-full text-xs"><thead><tr><th>Company</th><th>Source</th><th>Register entity</th><th>Status</th><th>Boards</th><th>Checked</th></tr></thead>
              <tbody>{companies.data?.companies?.map((c: any) => (
                <tr key={c.id}><td>{c.name}<div className="text-mute">{c.sector}</div></td><td>{c.source}</td><td className="font-mono">{c.legal_name ?? '—'}</td>
                  <td><Badge tone={STATUS_LABEL[c.status]?.[1] ?? 'mute'}>{STATUS_LABEL[c.status]?.[0] ?? c.status}</Badge></td>
                  <td className="font-mono">{JSON.parse(c.boards_json ?? '[]').map((b: any) => `${b.ats}/${b.token}`).join(', ') || '—'}</td><td>{fmtDateTime(c.checked_at)}</td></tr>
              ))}</tbody></table>
          </div>
        )}
      </div>

      <div className="h2">Roles from sponsor careers pages</div>
      <SectionSearch group="registry" scope="REGISTRY" runLabel="Search all sponsor careers pages" tick={tick} />
    </div>
  );
}
