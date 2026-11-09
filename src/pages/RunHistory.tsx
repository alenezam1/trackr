import React from 'react';
import { api, fmtDateTime } from '../api';
import { AppCtx } from '../App';
import { Badge, Modal, Spinner, useAsync } from '../components/ui';
import { ScanProgress } from '../components/Scan';

export function RunHistory() {
  const { openJob, refreshStatus, status } = React.useContext(AppCtx);
  const { data, loading, reload } = useAsync(() => api('/api/runs'), [status?.scan?.runId]);
  const [open, setOpen] = React.useState<number | null>(null);
  const start = async (mode: string) => { await api('/api/scan', { body: { mode } }).catch(() => {}); refreshStatus(); setTimeout(reload, 800); };
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><div className="h1 flex-1">Run History</div>
        <button className="btn btn-sm" disabled={!!status?.scan} onClick={() => start('RETRY_FAILED')}>Retry failed sources</button>
        <button className="btn btn-sm" disabled={!!status?.scan} onClick={() => start('AUTODISCOVER')}>Discover more sponsor boards</button>
      </div>
      <div className="card overflow-auto">
        <table className="tbl w-full text-sm">
          <thead><tr><th>#</th><th>Mode</th><th>Query</th><th>Status</th><th>Started</th><th>Duration</th><th>Seen</th><th>Analysed</th><th>Viable</th><th>Review</th><th>Excluded</th><th>Errors</th><th></th></tr></thead>
          <tbody>
            {data?.map((r: any) => (
              <tr key={r.id}>
                <td>{r.id}</td><td className="text-xs">{r.mode}</td><td className="text-xs">{r.query || '—'}</td>
                <td><Badge tone={r.status === 'COMPLETED' ? 'ok' : r.status === 'RUNNING' ? 'accent' : r.status === 'PARTIAL' ? 'warn' : 'bad'}>{r.status}</Badge></td>
                <td className="text-xs">{fmtDateTime(r.started_at)}</td>
                <td className="text-xs">{r.finished_at ? `${Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)}s` : '…'}</td>
                <td>{r.counts.links_found}</td><td>{r.counts.prefilter_passed}</td><td>{(r.counts.verified ?? 0) + (r.counts.potential ?? 0)}</td><td>{r.counts.review}</td><td>{r.counts.excluded}</td><td>{r.errors.length}</td>
                <td><button className="btn btn-sm" onClick={() => setOpen(r.id)}>Details</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open != null && <RunDetail id={open} onClose={() => setOpen(null)} openJob={openJob} />}
    </div>
  );
}

function RunDetail({ id, onClose, openJob }: { id: number; onClose: () => void; openJob: (id: number) => void }) {
  const { data } = useAsync(() => api(`/api/runs/${id}`), [id]);
  return (
    <Modal title={`Run #${id}`} onClose={onClose} wide>
      {!data ? <Spinner /> : (
        <div className="space-y-3">
          <ScanProgress run={data} live={false} />
          <div className="card p-3 text-xs">
            <div className="h2 mb-1">Per-source stats &amp; queries</div>
            {Object.entries(data.sourceStats ?? {}).map(([k, v]: any) => <div key={k} className="mt-1"><b>{k}</b>: {v.links} links · {v.jobs} jobs · {v.fullJds} full JDs · {v.errors} errors{v.queries?.length ? <div className="text-mute">{v.queries.join(' | ')}</div> : null}</div>)}
          </div>
          <div className="max-h-96 overflow-auto"><table className="tbl w-full text-xs"><thead><tr><th>Result</th><th>Title</th><th>Employer</th><th>Source</th><th>Reasons</th></tr></thead>
            <tbody>{data.candidates.map((c: any) => <tr key={c.id}><td>{c.state}</td><td><button className="hover:text-accent text-left" onClick={() => c.job_id && openJob(c.job_id)}>{c.title}</button></td><td>{c.employer}</td><td>{c.source_id}</td><td>{JSON.parse(c.reason_codes_json ?? '[]').join(', ')}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </Modal>
  );
}
