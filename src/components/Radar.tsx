import React from 'react';
import { CalendarClock } from 'lucide-react';
import { api, fmtDate, openExternal } from '../api';
import { StatusBadge, useAsync } from './ui';

export function DeadlineRadar({ onOpen, tick }: { onOpen: (id: number) => void; tick?: number }) {
  const { data } = useAsync(() => api('/api/radar'), [tick]);
  if (!data) return null;
  return (
    <div className="card p-4">
      <div className="h2 mb-2 flex items-center gap-2"><CalendarClock size={14} />Deadline radar · next {data.windowDays} days</div>
      {data.visaCutoff && (
        <div className="card p-2.5 mb-3 border-warn/50 text-warn text-sm">
          Graduate visa: <b>{data.visaCutoff.daysLeft} days</b> left to apply for the 24-month version. {data.visaCutoff.note}
        </div>
      )}
      {data.jobs.length === 0 ? <div className="text-sm text-mute">No tracked or eligible roles close in this window.</div> : (
        <div className="space-y-1.5 max-h-80 overflow-auto">
          {data.jobs.map((j: any) => (
            <div key={j.id} className="flex items-center gap-2 text-sm">
              <span className={`w-16 shrink-0 text-xs font-semibold ${j.daysLeft <= 3 ? 'text-bad' : j.daysLeft <= 7 ? 'text-warn' : 'text-mute'}`}>{j.daysLeft === 0 ? 'Today' : `${j.daysLeft}d`} · {fmtDate(j.deadline).slice(0, 6)}</span>
              <button className="flex-1 text-left truncate hover:text-accent" onClick={() => onOpen(j.id)}>{j.title} <span className="text-mute">· {j.employer}</span></button>
              <StatusBadge status={j.status} />
              <button className="btn btn-sm" disabled={!j.applyUrl} onClick={() => openExternal(j.applyUrl)}>Apply</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
