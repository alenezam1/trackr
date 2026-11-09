import React from 'react';
import { api } from '../api';
import { AppCtx } from '../App';
import { ErrorBox, StatusBadge } from '../components/ui';

export function ImportJob() {
  const { openJob, toast } = React.useContext(AppCtx);
  const [f, setF] = React.useState({ url: '', text: '', title: '', employer: '', location: '' });
  const [busy, setBusy] = React.useState(false);
  const [res, setRes] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { const r = await api('/api/import', { body: { url: f.url || null, text: f.text || null, title: f.title || null, employer: f.employer || null, location: f.location || null } }); setRes(r); toast('Imported and analysed'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="h1">Import a job</div>
      <div className="text-sm text-mute">Paste a link from LinkedIn, Indeed, Bright Network, UCL Careers, Gradcracker, Prospects, targetjobs, higherin, The Trackr or any employer site.
        Public ATS links (Greenhouse, Lever, Ashby, SmartRecruiters) are read through their official API; employer pages only if robots.txt allows; job-board pages are never fetched automatically — paste the JD text for those. The text is treated as untrusted data.</div>
      <ErrorBox error={err} />
      <div className="card p-4 space-y-3">
        <label className="block"><span className="label">Job link</span><input className="input mt-0.5" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block"><span className="label">Title (optional)</span><input className="input mt-0.5" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="block"><span className="label">Employer (optional)</span><input className="input mt-0.5" value={f.employer} onChange={(e) => setF({ ...f, employer: e.target.value })} /></label>
          <label className="block"><span className="label">Location (optional)</span><input className="input mt-0.5" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
        </div>
        <label className="block"><span className="label">Full job description text (needed for board links / login pages)</span>
          <textarea className="input mt-0.5 h-48" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
        <label className="text-xs text-mute">or load a .txt file: <input type="file" accept=".txt,text/plain" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setF({ ...f, text: await fl.text() }); }} /></label>
        <button className="btn btn-primary" disabled={busy || (!f.url && !f.text)} onClick={submit}>{busy ? 'Reading & analysing…' : 'Import & analyse'}</button>
      </div>
      {res && (
        <div className="card p-4 text-sm space-y-2">
          <div>{res.message}</div>
          <div className="flex items-center gap-2"><StatusBadge status={res.status} />{res.reasons?.length > 0 && <span className="text-xs text-mute">{res.reasons.join(', ')}</span>}</div>
          <button className="btn btn-sm" onClick={() => openJob(res.jobId)}>Open job</button>
        </div>
      )}
    </div>
  );
}
