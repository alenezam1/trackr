import React from 'react';
import { LayoutDashboard, ListChecks, Search, AlertTriangle, XCircle, KanbanSquare, Radio, Building2, Settings as Cog, History, Download, Bell, SlidersHorizontal, Globe, Globe2 } from 'lucide-react';
import { GulfPage } from './pages/Gulf';
import { RulesPage } from './pages/Rules';
import { RegistrySearch } from './pages/RegistrySearch';
import { BoardSearch } from './pages/BoardSearch';
import { api } from './api';
import { Toast } from './components/ui';
import { JobDetail } from './components/JobDetail';
import { Dashboard } from './pages/Dashboard';
import { Daily15 } from './pages/Daily15';
import { Explore } from './pages/Explore';
import { ReviewPage, RejectedPage } from './pages/Queues';
import { Applications } from './pages/Applications';
import { Sources } from './pages/Sources';
import { Sponsors } from './pages/Sponsors';
import { SettingsPage } from './pages/Settings';
import { RunHistory } from './pages/RunHistory';
import { ImportJob } from './pages/ImportJob';
import { Alerts } from './pages/Alerts';

export type Page = 'dashboard' | 'daily' | 'explore' | 'review' | 'rejected' | 'applications' | 'sources' | 'sponsors' | 'settings' | 'runs' | 'import' | 'alerts' | 'rules' | 'registry' | 'boards' | 'gulf';
const NAV: Array<[Page, string, React.ReactNode]> = [
  ['dashboard', 'Dashboard', <LayoutDashboard size={16} />],
  ['daily', 'Daily 15', <ListChecks size={16} />],
  ['registry', 'Sponsor Registry Search', <Building2 size={16} />],
  ['boards', 'Job Board Search', <Globe size={16} />],
  ['gulf', 'Gulf: UAE · Qatar · Saudi', <Globe2 size={16} />],
  ['rules', 'My Search & Rules', <SlidersHorizontal size={16} />],
  ['explore', 'All results', <Search size={16} />],
  ['review', 'Needs Review', <AlertTriangle size={16} />],
  ['rejected', 'Rejected', <XCircle size={16} />],
  ['applications', 'Applications', <KanbanSquare size={16} />],
  ['import', 'Import job', <Download size={16} />],
  ['sources', 'Sources', <Radio size={16} />],
  ['sponsors', 'Sponsors & Employers', <Building2 size={16} />],
  ['runs', 'Run History', <History size={16} />],
  ['alerts', 'Alerts', <Bell size={16} />],
  ['settings', 'Settings', <Cog size={16} />],
];

export interface Ctx {
  status: any; refreshStatus: () => void; setRoleFocus: (f: 'BOTH' | 'INTERNSHIP' | 'GRADUATE') => void; openJob: (id: number) => void; go: (p: Page, q?: string) => void; toast: (m?: string) => void; navQuery: string;
}
export const AppCtx = React.createContext<Ctx>(null as any);

export function App() {
  const [page, setPage] = React.useState<Page>(() => {
    const fromHash = location.hash.slice(1) as Page;
    if (fromHash) return fromHash;
    try { return (localStorage.getItem('sf:lastPage') as Page) || 'dashboard'; } catch { return 'dashboard'; }
  });
  React.useEffect(() => { try { localStorage.setItem('sf:lastPage', page); } catch { /* ignore */ } }, [page]);
  const [status, setStatus] = React.useState<any>(null);
  const [jobId, setJobId] = React.useState<number | null>(null);
  const [toastMsg, setToast] = React.useState<string | null>(null);
  const [navQuery, setNavQuery] = React.useState('');
  const [tick, setTick] = React.useState(0);

  const refreshStatus = React.useCallback(() => { api('/api/status').then(setStatus).catch(() => {}); }, []);
  React.useEffect(() => { refreshStatus(); const t = setInterval(refreshStatus, status?.scan ? 3000 : 15000); return () => clearInterval(t); }, [refreshStatus, !!status?.scan]);
  React.useEffect(() => { location.hash = page; }, [page]);
  React.useEffect(() => { const h = () => setPage((location.hash.slice(1) as Page) || 'dashboard'); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);

  const ctx: Ctx = {
    status, refreshStatus, navQuery,
    setRoleFocus: (f) => { setStatus((s: any) => ({ ...s, roleFocus: f })); api('/api/role-focus', { body: { focus: f } }).then(() => { refreshStatus(); setTick((x) => x + 1); }).catch(() => {}); },
    openJob: (id) => setJobId(id),
    go: (p, q) => { setNavQuery(q ?? ''); setPage(p); },
    toast: (m) => { if (m) setToast(m); setTick((x) => x + 1); refreshStatus(); },
  };
  const snap = status?.snapshot;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="flex h-full">
        <aside className="w-56 shrink-0 border-r border-line bg-[#0a0f17] flex flex-col">
          <div className="px-4 py-4">
            <div className="font-semibold tracking-tight text-[15px]">SponsorFirst <span className="text-accent">· Daily 15</span></div>
            <div className="text-[11px] text-mute mt-0.5">Local, personal job hunter</div>
          </div>
          <nav className="flex-1 px-2 space-y-0.5" aria-label="Main">
            {NAV.map(([k, label, icon]) => (
              <button key={k} onClick={() => ctx.go(k)} className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] ${page === k ? 'bg-accent/15 text-accent' : 'text-mute hover:text-ink hover:bg-panel'}`}>
                {icon}<span className="flex-1 text-left">{label}</span>
                {k === 'alerts' && status?.alertsUnread > 0 && <span className="text-[10px] bg-bad/80 text-white rounded-full px-1.5">{status.alertsUnread}</span>}
                {k === 'review' && status?.trace?.review > 0 && <span className="text-[10px] text-warn">{status.trace.review}</span>}
              </button>
            ))}
          </nav>
          <div className="p-3 text-[11px] text-mute border-t border-line space-y-1">
            <div>Register: {snap ? <span className={snap.age === 'CURRENT' ? 'text-ok' : snap.age === 'AGING' ? 'text-warn' : 'text-bad'}>{snap.published_at ?? snap.imported_at.slice(0, 10)} · {snap.age}</span> : <span className="text-bad">not imported</span>}</div>
            <div>{status?.scan ? <span className="text-accent">Scan #{status.scan.runId} running…</span> : 'No scan running'}</div>
          </div>
        </aside>
        <main className="flex-1 overflow-auto">
          <div className="max-w-[1400px] mx-auto p-5" key={page}>
            {page === 'dashboard' && <Dashboard />}
            {page === 'daily' && <Daily15 tick={tick} />}
            {page === 'explore' && <Explore tick={tick} />}
            {page === 'review' && <ReviewPage tick={tick} />}
            {page === 'rejected' && <RejectedPage tick={tick} />}
            {page === 'applications' && <Applications tick={tick} />}
            {page === 'sources' && <Sources />}
            {page === 'sponsors' && <Sponsors />}
            {page === 'settings' && <SettingsPage />}
            {page === 'runs' && <RunHistory />}
            {page === 'import' && <ImportJob />}
            {page === 'alerts' && <Alerts />}
            {page === 'rules' && <RulesPage />}
            {page === 'registry' && <RegistrySearch tick={tick} />}
            {page === 'boards' && <BoardSearch tick={tick} />}
            {page === 'gulf' && <GulfPage tick={tick} />}
          </div>
        </main>
      </div>
      {jobId != null && <JobDetail id={jobId} onClose={() => setJobId(null)} onChanged={(m) => ctx.toast(m)} />}
      <Toast msg={toastMsg} onDone={() => setToast(null)} />
    </AppCtx.Provider>
  );
}
