import React from 'react';
import { api, fmtDateTime, openExternal } from '../api';
import { AppCtx } from '../App';
import { Badge, ErrorBox, Modal, Spinner, useAsync } from '../components/ui';

export function Sponsors() {
  const { status, refreshStatus, toast } = React.useContext(AppCtx);
  const [tab, setTab] = React.useState<'employers' | 'register'>('employers');
  return (
    <div className="space-y-4">
      <div className="h1">Sponsors &amp; Employers</div>
      <RegisterCard snapshot={status?.snapshot} onChanged={() => { refreshStatus(); toast(); }} />
      <div className="flex gap-1 border-b border-line">
        {[['employers', 'Employers & entity mappings'], ['register', 'Search register']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${tab === k ? 'border-accent text-accent' : 'border-transparent text-mute'}`}>{l}</button>
        ))}
      </div>
      {tab === 'employers' ? <Employers /> : <RegisterSearch />}
    </div>
  );
}

function RegisterCard({ snapshot: s, onChanged }: { snapshot: any; onChanged: () => void }) {
  const files = useAsync(() => api('/api/sponsors/local-files'), []);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setMsg(null); try { const r = await fn(); setMsg(r?.message ?? (r?.rowCount ? `Imported ${r.rowCount.toLocaleString()} rows (${r.skilledWorkerCount.toLocaleString()} Skilled Worker).` : 'Done')); onChanged(); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); } };
  return (
    <div className="card p-4">
      <div className="flex flex-wrap gap-4 items-start">
        <div className="flex-1 min-w-[280px] text-sm">
          <div className="h2 mb-1">Active register snapshot</div>
          {s ? (
            <>
              <div>Published <b>{s.published_at ?? '—'}</b> · imported {fmtDateTime(s.imported_at)} · <Badge tone={s.age === 'CURRENT' ? 'ok' : s.age === 'AGING' ? 'warn' : 'bad'}>{s.age} ({s.ageDays} days)</Badge></div>
              <div className="mt-1">{s.row_count.toLocaleString()} rows · <b>{s.skilled_worker_count.toLocaleString()}</b> Skilled Worker (only these satisfy your rule; Global Business Mobility routes don't)</div>
              <div className="text-xs text-mute mt-1 font-mono">{s.source_file} · sha256 {s.sha256.slice(0, 16)}…{s.source_url ? ` · ${s.source_url}` : ''}</div>
              {s.quality?.ratings && <div className="text-xs text-mute mt-1">Skilled Worker ratings: {Object.entries(s.quality.ratings).map(([k, v]) => `${k}: ${(v as number).toLocaleString()}`).join(' · ')}</div>}
              {s.diff && <div className="text-xs mt-1">Changes vs previous: +{s.diff.added} new, −{s.diff.removed} removed, {s.diff.ratingChanged} rating changes{s.diff.affectedEmployers?.length ? ` · affects: ${s.diff.affectedEmployers.join(', ')}` : ''}</div>}
            </>
          ) : <div className="text-bad">No register imported yet.</div>}
          <div className="text-xs text-mute mt-2">A Skilled Worker licence shows the employer can sponsor generally; it is not proof that a specific vacancy offers sponsorship. B-rated sponsors cannot normally issue new CoS.</div>
        </div>
        <div className="space-y-2 text-sm">
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api('/api/sponsors/refresh', { body: {} }))}>Refresh from official GOV.UK CSV</button>
          {files.data?.map((f: any) => <div key={f.path}><button className="btn btn-sm" disabled={busy} onClick={() => run(() => api('/api/sponsors/import-local', { body: { file: f.path } }))}>Import {f.name}</button></div>)}
          <label className="btn btn-sm cursor-pointer">Upload CSV…<input type="file" accept=".csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) run(async () => api('/api/sponsors/upload', { raw: await f.text() })); }} /></label>
          <div><button className="text-xs text-accent hover:underline" onClick={() => openExternal('https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers')}>Official publication page</button></div>
        </div>
      </div>
      {busy && <Spinner label="Working (import takes ~10s)…" />}
      {msg && <div className="text-sm text-accent mt-2">{msg}</div>}
    </div>
  );
}

function Employers() {
  const { toast } = React.useContext(AppCtx);
  const { data, error, loading, reload } = useAsync(() => api('/api/employers'), []);
  const [filter, setFilter] = React.useState<'all' | 'proposed' | 'confirmed' | 'none'>('proposed');
  const [sel, setSel] = React.useState<Set<number>>(new Set());
  const [add, setAdd] = React.useState({ name: '', url: '' });
  const [pick, setPick] = React.useState<any | null>(null);
  const [busy, setBusy] = React.useState(false);
  if (loading && !data) return <Spinner />;
  const rows = (data ?? []).filter((e: any) => filter === 'all' ? true : filter === 'proposed' ? e.match_status === 'PROPOSED' : filter === 'confirmed' ? e.verified_by_user === 1 : !e.match_status);
  const confirmSel = async () => {
    if (!confirm(`Confirm ${sel.size} employer → legal entity mappings? Only do this if you checked that each register row is the actual UK employer.`)) return;
    setBusy(true);
    try { await api('/api/employers/confirm-proposed', { body: { employerIds: [...sel], acknowledgement: 'I checked these legal entities' } }); setSel(new Set()); reload(); toast('Mappings confirmed — jobs re-evaluated in the background'); } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const addEmp = async () => { try { const r = await api('/api/employers', { body: { name: add.name, url: add.url || null } }); toast(r.message); setAdd({ name: '', url: '' }); reload(); } catch (e: any) { toast(e.message); } };
  return (
    <div className="space-y-3">
      <ErrorBox error={error} />
      <div className="card p-3 text-sm">
        <div className="font-medium mb-1">Add an employer to watch</div>
        <div className="text-xs text-mute mb-2">Paste its careers/job-board URL. Greenhouse, Lever, Ashby and SmartRecruiters boards are read automatically through their public APIs; other sites become watchlist entries for manual import. The app also auto-discovers boards for register sponsors during each full scan.</div>
        <div className="flex gap-2"><input className="input" placeholder="Employer name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /><input className="input" placeholder="https://boards.greenhouse.io/… or careers URL" value={add.url} onChange={(e) => setAdd({ ...add, url: e.target.value })} /><button className="btn" disabled={!add.name} onClick={addEmp}>Add</button></div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[['proposed', 'Awaiting confirmation'], ['confirmed', 'Confirmed'], ['none', 'No register match'], ['all', 'All']].map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k as any)}>{l} ({(data ?? []).filter((e: any) => k === 'all' ? true : k === 'proposed' ? e.match_status === 'PROPOSED' : k === 'confirmed' ? e.verified_by_user === 1 : !e.match_status).length})</button>)}
        {filter === 'proposed' && <button className="btn btn-sm ml-auto" onClick={() => setSel(new Set(rows.map((r: any) => r.id)))}>Select all shown</button>}
        <button className="btn btn-sm btn-primary" disabled={!sel.size || busy} onClick={confirmSel}>Confirm selected ({sel.size})</button>
      </div>
      <div className="card overflow-auto max-h-[65vh]">
        <table className="tbl w-full text-sm">
          <thead><tr><th></th><th>Employer</th><th>Source</th><th>Register entity (Skilled Worker)</th><th>Mapping</th><th>Jobs</th><th>Last checked</th><th></th></tr></thead>
          <tbody>
            {rows.map((e: any) => (
              <tr key={e.id} className={e.enabled ? '' : 'opacity-60'}>
                <td>{e.match_status === 'PROPOSED' && <input type="checkbox" aria-label={`Select ${e.canonical_name}`} checked={sel.has(e.id)} onChange={(ev) => { const n = new Set(sel); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setSel(n); }} />}</td>
                <td><div className="font-medium">{e.canonical_name}</div><div className="text-xs text-mute">{e.sector ?? ''} · {e.provenance}</div></td>
                <td className="text-xs font-mono">{e.ats_type}{e.ats_type !== 'manual' ? `/${e.ats_token}` : ''}{e.careers_url && <div><button className="text-accent hover:underline" onClick={() => openExternal(e.careers_url)}>careers</button></div>}</td>
                <td className="text-xs">{e.register_row ? <><div className="font-mono">{e.register_row.legal_name}</div><div className="text-mute">{e.register_row.town} · {e.register_row.type_rating}</div></> : e.match_status === 'NOT_SPONSOR' ? <span className="text-bad">Confirmed not on register</span> : e.match_legal_name ? <span className="text-bad">“{e.match_legal_name}” not in current snapshot</span> : <span className="text-mute">No proposal</span>}</td>
                <td>{e.verified_by_user && e.match_status === 'CONFIRMED' ? <Badge tone="ok">Confirmed by you</Badge> : e.match_status === 'PROPOSED' ? <Badge tone="info">Proposed ({e.match_method})</Badge> : e.match_status === 'NOT_SPONSOR' ? <Badge tone="bad">Not sponsor</Badge> : <Badge>—</Badge>}</td>
                <td className="text-xs">{e.job_count} ({e.viable_count} viable)</td>
                <td className="text-xs">{fmtDateTime(e.last_checked_at)}{e.last_error && <div className="text-bad">{e.last_error}</div>}</td>
                <td className="whitespace-nowrap">
                  <button className="btn btn-sm" onClick={() => setPick(e)}>Choose entity</button>{' '}
                  <button className="btn btn-sm" onClick={async () => { await api(`/api/employers/${e.id}/enabled`, { body: { enabled: !e.enabled } }); reload(); }}>{e.enabled ? 'Pause' : 'Resume'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pick && <PickEntity emp={pick} onClose={() => { setPick(null); reload(); }} />}
    </div>
  );
}

function PickEntity({ emp, onClose }: { emp: any; onClose: () => void }) {
  const [q, setQ] = React.useState('');
  const { data, loading } = useAsync(() => api(`/api/employers/${emp.id}/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const [input, setInput] = React.useState('');
  const [evidence, setEvidence] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const confirmRow = async (id: number) => { try { await api(`/api/employers/${emp.id}/confirm`, { body: { sponsorOrgId: id, evidenceUrl: evidence || null } }); onClose(); } catch (e: any) { setMsg(e.message); } };
  return (
    <Modal title={`Legal employing entity for ${emp.canonical_name}`} onClose={onClose}>
      <div className="text-xs text-mute mb-2">Pick the register row for the entity that actually employs UK staff (check the company's careers site, privacy notice or Companies House). A parent company or a similarly-named firm is not enough.</div>
      <div className="flex gap-2"><input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search register…" /><button className="btn" onClick={() => setQ(input)}>Search</button></div>
      <input className="input mt-2" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence URL (optional, e.g. privacy notice naming the legal entity)" />
      <div className="mt-3 max-h-80 overflow-auto space-y-1">
        {loading ? <Spinner /> : (data ?? []).map((c: any) => (
          <div key={c.id} className="flex items-center gap-2 text-sm"><span className="flex-1 font-mono text-xs">{c.legal_name} · {c.town} · {c.type_rating} · {c.route}</span><button className="btn btn-sm" onClick={() => confirmRow(c.id)}>Confirm</button></div>
        ))}
        {!loading && !data?.length && <div className="text-mute text-sm">No Skilled Worker rows found.</div>}
      </div>
      <button className="btn btn-sm btn-danger mt-3" onClick={async () => { await api(`/api/employers/${emp.id}/not-sponsor`, { body: { note: 'Checked: not on register' } }); onClose(); }}>Not on the Skilled Worker register</button>
      {msg && <div className="text-bad text-sm mt-2">{msg}</div>}
    </Modal>
  );
}

function RegisterSearch() {
  const [q, setQ] = React.useState('');
  const [sub, setSub] = React.useState('');
  const { data, loading } = useAsync(() => (sub ? api(`/api/sponsors?q=${encodeURIComponent(sub)}`) : Promise.resolve({ results: [] })), [sub]);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSub(q); }}><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Exact employer or legal name" /><button className="btn">Search</button></form>
      {loading ? <Spinner /> : (
        <div className="card overflow-auto"><table className="tbl w-full text-sm"><thead><tr><th>Legal name</th><th>Town</th><th>County</th><th>Type &amp; rating</th><th>Route</th></tr></thead>
          <tbody>{data?.results?.map((r: any) => <tr key={r.id}><td className="font-mono text-xs">{r.legal_name}</td><td>{r.town}</td><td>{r.county}</td><td>{r.type_rating}</td><td>{r.route}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}
