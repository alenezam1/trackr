import React from 'react';
import { api, fmtDateTime } from '../api';
import { AppCtx } from '../App';
import { Badge, Empty, Spinner, useAsync } from '../components/ui';

export function Alerts() {
  const { openJob, refreshStatus } = React.useContext(AppCtx);
  const { data, loading, reload } = useAsync(() => api('/api/alerts'), []);
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex items-center"><div className="h1 flex-1">Alerts</div><button className="btn btn-sm" onClick={async () => { await api('/api/alerts/read', { body: {} }); reload(); refreshStatus(); }}>Mark all read</button></div>
      <div className="text-sm text-mute">Sponsor removals/downgrades, closed jobs, JD clause changes, eligibility changes and interviews.</div>
      {!data?.length ? <Empty title="No alerts" /> : (
        <div className="space-y-2">
          {data.map((a: any) => (
            <div key={a.id} className={`card p-3 text-sm flex gap-3 items-start ${a.read ? 'opacity-70' : ''}`}>
              <Badge tone={a.kind === 'ELIGIBILITY_CHANGED' || a.kind === 'SPONSOR_CHANGE' ? 'warn' : 'info'}>{a.kind}</Badge>
              <div className="flex-1">{a.message}<div className="text-xs text-mute">{fmtDateTime(a.at)}</div></div>
              {a.job_id && <button className="btn btn-sm" onClick={() => openJob(a.job_id)}>Open job</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
