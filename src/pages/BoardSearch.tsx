import React from 'react';
import { Globe, Sparkles } from 'lucide-react';
import { api, openExternal } from '../api';
import { AppCtx } from '../App';
import { Badge, useAsync } from '../components/ui';
import { SectionSearch } from '../components/SectionSearch';

const TONE: Record<string, any> = { CONNECTED: 'ok', LIMITED: 'info', NOT_CONFIGURED: 'mute', LOGIN_REQUIRED: 'warn', PERMISSION_REQUIRED: 'warn', AUTH_REQUIRED: 'warn', BLOCKED: 'bad', ERROR: 'bad' };
const AUTO = ['gradcracker_reader', 'nhs_jobs', 'arbeitnow', 'himalayas', 'hn_whoishiring', 'ai_web_search', 'google_jobs', 'web_search', 'reed', 'adzuna', 'jooble'];

export function BoardSearch({ tick }: { tick: number }) {
  const { go, status } = React.useContext(AppCtx);
  const sources = useAsync(() => api('/api/sources'), [tick]);
  const links = useAsync(() => api('/api/search-links?q='), []);
  const auto = (sources.data ?? []).filter((s: any) => AUTO.includes(s.id));
  const toggle = async (s: any, on: boolean) => {
    await api(`/api/sources/${encodeURIComponent(s.id)}/enabled`, { body: { enabled: on } });
    await api(`/api/sources/${encodeURIComponent(s.id)}/verify`, { body: {} }).catch(() => {});
    sources.reload();
  };
  const isOn = (s: any) => (s.id === 'gradcracker_reader' ? s.optIn : s.enabled);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2"><Globe size={18} className="text-accent" /><div className="h1">Job Board Search</div></div>
      <div className="text-sm text-mute">Searches general job boards and job APIs: Gradcracker, NHS Jobs, Arbeitnow, Himalayas, Hacker News, plus Reed/Adzuna/Jooble with free keys, and <b>AI web search</b> across LinkedIn, Indeed, Glassdoor, Totaljobs, Otta and 20+ other boards. Every result still goes through the sponsor register and your rules.</div>

      <div className="card p-4">
        <div className="h2 mb-2">Sources searched automatically (toggle on/off)</div>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
          {auto.map((s: any) => (
            <label key={s.id} className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-1" checked={isOn(s)} onChange={(e) => toggle(s, e.target.checked)} />
              <span className="flex-1">{s.name} <Badge tone={TONE[s.status] ?? 'mute'}>{s.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                <span className="block text-xs text-mute">{s.jobsFound} jobs found · {s.status === 'NOT_CONFIGURED' ? (s.notes ?? 'needs a free key in Settings') : (s.lastError ?? '')}</span></span>
            </label>
          ))}
        </div>
        <div className="text-xs text-mute mt-3 flex items-center gap-1.5"><Sparkles size={12} />AI web search needs an OpenAI key with AI switched on (Settings). {!status?.ai?.keyConfigured && <button className="underline text-accent" onClick={() => go('settings')}>Add key</button>}</div>
      </div>

      <details className="card p-4">
        <summary className="cursor-pointer font-medium">Open these boards in your browser (LinkedIn, Indeed, Bright Network, UCL Careers, Glassdoor, Totaljobs…)</summary>
        <div className="text-xs text-mute mt-2 mb-3">These boards forbid automated scraping or need your login. Open a search, then paste good links on <button className="underline text-accent" onClick={() => go('import')}>Import job</button> — the app reads the employer posting and runs all checks.</div>
        <div className="grid md:grid-cols-3 gap-3">
          {links.data?.boards?.filter((b: any) => b.links?.length).map((b: any) => (
            <div key={b.id}><div className="text-sm font-medium">{b.name}</div>{b.links.map((l: any) => <button key={l.url} className="block text-left text-xs text-accent hover:underline mt-0.5" onClick={() => openExternal(l.url)}>{l.label}</button>)}</div>
          ))}
        </div>
      </details>

      <div className="h2">Roles from job boards</div>
      <SectionSearch group="boards" scope="BOARDS" runLabel="Search all job boards" tick={tick} />
    </div>
  );
}
