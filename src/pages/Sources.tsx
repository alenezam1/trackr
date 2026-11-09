import React from 'react';
import { api, fmtDateTime, openExternal } from '../api';
import { AppCtx } from '../App';
import { Badge, ErrorBox, Spinner, useAsync } from '../components/ui';

const STATUS_TONE: Record<string, any> = { CONNECTED: 'ok', LIMITED: 'info', NOT_CONFIGURED: 'mute', LOGIN_REQUIRED: 'warn', AUTH_REQUIRED: 'warn', PERMISSION_REQUIRED: 'warn', BLOCKED: 'bad', ERROR: 'bad' };
const STATUS_LABEL: Record<string, string> = { CONNECTED: 'Connected', LIMITED: 'Limited', NOT_CONFIGURED: 'Not Configured', LOGIN_REQUIRED: 'Login Required', AUTH_REQUIRED: 'Auth Required', PERMISSION_REQUIRED: 'Permission Required', BLOCKED: 'Blocked', ERROR: 'Error' };

export function Sources() {
  const { toast, go } = React.useContext(AppCtx);
  const { data, error, loading, reload } = useAsync(() => api('/api/sources'), []);
  const [busy, setBusy] = React.useState<string | null>(null);
  const verify = async (id: string) => { setBusy(id); try { await api(`/api/sources/${encodeURIComponent(id)}/verify`, { body: {} }); reload(); } catch (e: any) { toast(e.message); } finally { setBusy(null); } };
  const verifyAll = async () => { setBusy('all'); try { await api('/api/sources/verify-all', { body: {} }); reload(); } finally { setBusy(null); } };
  if (loading && !data) return <Spinner />;
  const groups: Array<[string, string]> = [['BOARD', 'Your named job boards'], ['ATS', 'Employer applicant-tracking systems (public APIs)'], ['API', 'Official job-search APIs (aggregate many boards)'], ['SEARCH', 'Licensed search provider'], ['MANUAL', 'Manual import']];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><div className="h1 flex-1">Sources</div><button className="btn" disabled={!!busy} onClick={verifyAll}>{busy === 'all' ? 'Checking…' : 'Check all connections'}</button></div>
      <div className="text-sm text-mute">No source is shown as a live feed unless it actually is one. Boards that forbid automated access are <b>Limited</b>: use their search links and paste listings into <button className="underline text-accent" onClick={() => go('import')}>Import</button>. To search “every board”, add free keys for Reed, Adzuna and Jooble (they aggregate most UK boards) and a Brave Search key for <code>site:</code> discovery — in Settings.</div>
      <ErrorBox error={error} />
      {groups.map(([kind, title]) => (
        <section key={kind}>
          <div className="h2 mb-2">{title}</div>
          <div className="card overflow-auto">
            <table className="tbl w-full text-sm">
              <thead><tr><th>Source</th><th>Mode</th><th>Status</th><th>Last attempt</th><th>Last success</th><th>Links</th><th>Jobs</th><th>Full JDs</th><th>Notes / last error</th><th></th></tr></thead>
              <tbody>
                {data.filter((s: any) => s.kind === kind).map((s: any) => (
                  <tr key={s.id}>
                    <td className="min-w-[180px]"><div className="font-medium">{s.name}</div>{s.homepage && <button className="text-xs text-accent hover:underline" onClick={() => openExternal(s.homepage)}>{s.homepage.replace(/^https:\/\//, '').slice(0, 40)}</button>}</td>
                    <td className="font-mono text-xs">{s.mode}</td>
                    <td><Badge tone={STATUS_TONE[s.status] ?? 'mute'}>{STATUS_LABEL[s.status] ?? s.status}</Badge></td>
                    <td className="text-xs">{fmtDateTime(s.lastAttemptAt)}</td><td className="text-xs">{fmtDateTime(s.lastSuccessAt)}</td>
                    <td>{s.linksFound}</td><td>{s.jobsFound}</td><td>{s.fullJds}</td>
                    <td className="text-xs text-mute max-w-md">{s.lastError ? <span className="text-bad">{s.lastError}</span> : (s.notes ?? s.description)}
                      {s.searchLinks?.length > 0 && <div className="mt-1 flex flex-wrap gap-x-3">{s.searchLinks.map((l: any) => <button key={l.url} className="text-accent hover:underline" onClick={() => openExternal(l.url)}>{l.label}</button>)}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => verify(s.id)}>{busy === s.id ? '…' : 'Check'}</button>
                      {['PERMITTED_PUBLIC_HTML', 'OFFICIAL_API', 'SEARCH_INDEX_DISCOVERY', 'AUTHORISED_FEED'].includes(s.mode) && (
                        <label className="flex items-center gap-1 text-xs mt-1"><input type="checkbox" checked={s.id === 'gradcracker_reader' ? s.optIn : s.enabled}
                          onChange={async (e) => { await api(`/api/sources/${encodeURIComponent(s.id)}/enabled`, { body: { enabled: e.target.checked } }); await verify(s.id); }} />Enabled</label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
