import React from 'react';
import { Download, Upload } from 'lucide-react';
import { api, fmtDate, openExternal } from '../api';
import { AppCtx } from '../App';
import { Badge, Empty, ErrorBox, Modal, Spinner, StatusBadge, useAsync } from '../components/ui';

const BOARD_STAGES = ['Shortlisted', 'To Apply', 'In Progress', 'Applied', 'Assessment', 'Recruiter Screen', 'Interview', 'Offer', 'Rejected', 'Withdrawn'];

export function Applications({ tick }: { tick: number }) {
  const { openJob, toast } = React.useContext(AppCtx);
  const [view, setView] = React.useState<'kanban' | 'table'>(() => (localStorage.getItem('sf:apps:view') as any) ?? 'kanban');
  const [sortKey, setSortKey] = React.useState('updated_at');
  const [importOpen, setImportOpen] = React.useState(false);
  const { data, error, loading, reload } = useAsync(() => api('/api/applications'), [tick]);
  React.useEffect(() => { try { localStorage.setItem('sf:apps:view', view); } catch { /* */ } }, [view]);
  const move = async (jobId: number, stage: string) => {
    try {
      const confirmSubmitted = stage === 'Applied' ? confirm('Confirm you actually submitted this application.') : undefined;
      if (stage === 'Applied' && !confirmSubmitted) return;
      await api(`/api/jobs/${jobId}/stage`, { body: { stage, confirmSubmitted } }); reload();
    } catch (e: any) { toast(e.message); }
  };
  if (loading && !data) return <Spinner />;
  const apps: any[] = data?.applications ?? [];
  const sorted = [...apps].sort((a, b) => String(b[sortKey] ?? '').localeCompare(String(a[sortKey] ?? '')));
  const dueFollowups = apps.filter((a) => a.followup_at && a.followup_at.slice(0, 10) <= new Date().toISOString().slice(0, 10) && !['Rejected', 'Withdrawn', 'Offer', 'Archived'].includes(a.stage));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="h1 flex-1">Applications</div>
        <button className={`chip ${view === 'kanban' ? 'chip-on' : ''}`} onClick={() => setView('kanban')}>Kanban</button>
        <button className={`chip ${view === 'table' ? 'chip-on' : ''}`} onClick={() => setView('table')}>Table</button>
        <a className="btn btn-sm" href="/api/applications/export?format=csv"><Download size={13} />CSV</a>
        <a className="btn btn-sm" href="/api/applications/export?format=json"><Download size={13} />JSON</a>
        <button className="btn btn-sm" onClick={() => setImportOpen(true)}><Upload size={13} />Import log CSV</button>
      </div>
      <ErrorBox error={error} />
      <div className="text-xs text-mute">A shortlist is not an application: a job only counts as Applied when you confirm you submitted it. Opening an apply link never marks it applied.</div>
      {dueFollowups.length > 0 && <div className="card p-3 border-warn/50 text-sm text-warn">Follow-ups due: {dueFollowups.map((a) => `${a.title} (${a.advertised_employer})`).join(' · ')}</div>}
      {!apps.length ? <Empty title="No tracked applications yet">Use “Save” on any job card to start tracking it.</Empty> : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {BOARD_STAGES.map((stage) => (
            <div key={stage} className="w-64 shrink-0" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = Number(e.dataTransfer.getData('text/plain')); if (id) move(id, stage); }}>
              <div className="h2 mb-2 flex justify-between"><span>{stage}</span><span>{apps.filter((a) => a.stage === stage).length}</span></div>
              <div className="space-y-2 min-h-[120px] rounded-lg bg-panel/40 p-1.5 border border-dashed border-line">
                {apps.filter((a) => a.stage === stage).map((a) => (
                  <div key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(a.job_id))} className="card p-2.5 cursor-grab text-sm">
                    <button className="font-medium text-left hover:text-accent" onClick={() => openJob(a.job_id)}>{a.title}</button>
                    <div className="text-xs text-mute">{a.advertised_employer}</div>
                    <div className="flex flex-wrap gap-1 mt-1">{a.is_demo ? <Badge tone="warn">DEMO</Badge> : null}{(a.tags ?? []).map((t: string) => <Badge key={t}>{t}</Badge>)}</div>
                    {a.followup_at && <div className="text-[11px] text-warn mt-1">Follow up {fmtDate(a.followup_at)}</div>}
                    <select className="input mt-1.5 text-xs py-1" value={a.stage} onChange={(e) => move(a.job_id, e.target.value)} aria-label="Change stage">
                      {data.stages.map((s: string) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-auto max-h-[70vh]">
          <table className="tbl w-full text-sm">
            <thead><tr>{[['title', 'Role'], ['advertised_employer', 'Employer'], ['stage', 'Stage'], ['current_status', 'Eligibility'], ['applied_at', 'Applied'], ['followup_at', 'Follow-up'], ['interview_at', 'Interview'], ['cv_version', 'CV'], ['updated_at', 'Updated']].map(([k, l]) => (
              <th key={k}><button onClick={() => setSortKey(k)} className={sortKey === k ? 'text-accent' : ''}>{l}</button></th>))}<th></th></tr></thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id}>
                  <td><button className="hover:text-accent text-left" onClick={() => openJob(a.job_id)}>{a.title}</button></td>
                  <td>{a.advertised_employer}</td>
                  <td><select className="input py-0.5 text-xs" value={a.stage} onChange={(e) => move(a.job_id, e.target.value)}>{data.stages.map((s: string) => <option key={s}>{s}</option>)}</select></td>
                  <td><StatusBadge status={a.current_status} /></td>
                  <td>{a.applied_at ? fmtDate(a.applied_at) : '—'}</td><td>{a.followup_at ? fmtDate(a.followup_at) : '—'}</td><td>{a.interview_at ? fmtDate(a.interview_at) : '—'}</td>
                  <td>{a.cv_version ?? '—'}</td><td>{fmtDate(a.updated_at)}</td>
                  <td><button className="btn btn-sm" disabled={!a.apply_url} onClick={() => openExternal(a.apply_url)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {importOpen && <ImportCsv onClose={() => { setImportOpen(false); reload(); }} />}
    </div>
  );
}

function ImportCsv({ onClose }: { onClose: () => void }) {
  const [csv, setCsv] = React.useState('');
  const [preview, setPreview] = React.useState<any[] | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const run = async (commit: boolean) => {
    try { const r = await api('/api/applications/import', { body: { csv, commit } }); setPreview(r.preview); if (commit) setMsg(`Imported ${r.imported} applications.`); } catch (e: any) { setMsg(e.message); }
  };
  return (
    <Modal title="Import application log (CSV)" onClose={onClose} wide>
      <div className="text-xs text-mute mb-2">Columns: title/role, employer/company, optional url, stage/status, applied date, notes, location. Preview shows duplicates before anything is written.</div>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
      <textarea className="input h-32 mt-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="…or paste CSV here" />
      <div className="flex gap-2 mt-2"><button className="btn" disabled={!csv} onClick={() => run(false)}>Preview</button><button className="btn btn-primary" disabled={!preview} onClick={() => run(true)}>Import</button></div>
      {msg && <div className="text-accent text-sm mt-2">{msg}</div>}
      {preview && (
        <div className="max-h-72 overflow-auto mt-3"><table className="tbl w-full text-xs"><thead><tr><th>Title</th><th>Employer</th><th>Stage</th><th>Duplicate?</th></tr></thead>
          <tbody>{preview.map((p, i) => <tr key={i}><td>{p.title}</td><td>{p.employer}</td><td>{p.stage}</td><td>{p.duplicateOfJobId ? `matches job #${p.duplicateOfJobId}` : 'new'}</td></tr>)}</tbody></table></div>
      )}
    </Modal>
  );
}
