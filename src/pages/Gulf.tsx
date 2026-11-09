import React from 'react';
import { Globe2 } from 'lucide-react';
import { api, openExternal } from '../api';
import { useAsync } from '../components/ui';
import { SectionSearch } from '../components/SectionSearch';

const TABS: Array<[string, string]> = [['UAE', '🇦🇪 UAE'], ['QATAR', '🇶🇦 Qatar'], ['SAUDI', '🇸🇦 Saudi Arabia']];

export function GulfPage({ tick }: { tick: number }) {
  const [tab, setTab] = React.useState<string>(() => { try { return localStorage.getItem('sf:gulfTab') || 'UAE'; } catch { return 'UAE'; } });
  React.useEffect(() => { try { localStorage.setItem('sf:gulfTab', tab); } catch { /* ignore */ } }, [tab]);
  const markets = useAsync(() => api('/api/gulf/markets'), [tick]);
  const st = useAsync(() => api('/api/settings'), [tick]);
  const [days, setDays] = React.useState<number | null>(null);
  React.useEffect(() => { if (st.data && days === null) setDays(st.data.settings.max_posting_age_days); }, [st.data, days]);
  const saveDays = async (v: number) => { setDays(v); await api('/api/settings', { body: { max_posting_age_days: v } }).catch(() => {}); };
  const m = markets.data?.find((x: any) => x.id === tab);
  const nat = tab === 'UAE' ? 'UAE / Emirati' : tab === 'QATAR' ? 'Qatari' : 'Saudi';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Globe2 size={18} className="text-accent" /><div className="h1">Gulf jobs</div></div>
      <div className="flex gap-1 border-b border-line" role="tablist">
        {TABS.map(([k, l]) => {
          const c = markets.data?.find((x: any) => x.id === k)?.counts;
          return (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-accent text-accent' : 'border-transparent text-mute hover:text-ink'}`}>
              {l} {c?.eligible ? <span className="ml-1 text-xs text-ok">{c.eligible}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="card p-4 text-sm space-y-2">
        <div className="h2">Rules for {m?.name ?? tab}</div>
        <ul className="list-disc ml-5 text-mute space-y-0.5">
          <li><b className="text-ink">Any cyber role</b>: SOC analyst, GRC, information security, security engineer, threat intel, vulnerability, privacy (plus your own security roles from My Search &amp; Rules).</li>
          <li><b className="text-ink">Entry level only</b>: graduate, intern, junior or entry roles; <b className="text-ink">no more than 1 year</b> of required experience; senior/lead/manager titles excluded (AI also reads the full posting for level).</li>
          <li><b className="text-ink">Not reserved for {nat} nationals</b>: “nationals only”, localisation roles (Emiratisation / Qatarisation / Saudisation) are excluded; “nationals preferred” goes to review.</li>
          <li>The full posting must be read; listing pages, teaser links and scam red flags are dropped. The UK sponsor register does not apply here.</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-ink">Only postings from the last</span>
          {[7, 14, 30, 60].map((d) => <button key={d} className={`chip ${days === d ? 'chip-on' : ''}`} onClick={() => saveDays(d)}>{d} days</button>)}
          <input className="input w-20 py-1" type="number" min={1} max={365} value={days ?? 30} onChange={(e) => setDays(Number(e.target.value))} onBlur={(e) => saveDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))} aria-label="Posting age window in days" />
          <span className="text-xs text-mute">(applies to every search; older postings are hidden)</span>
        </div>
        <div className="text-xs text-mute">Searched with: Google Jobs (SerpApi key), Jooble, AI-steered web search (DataForSEO / Jina) across Bayt, NaukriGulf, GulfTalent, LinkedIn and Indeed, AI web search (OpenAI), and careers pages of Gulf employers.</div>
        {m && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {m.boards.map((b: any) => <button key={b.url} className="text-xs text-accent hover:underline" onClick={() => openExternal(b.url)}>{b.name}</button>)}
          </div>
        )}
      </div>

      <SectionSearch key={tab} group={null} scope="GULF" market={tab} runLabel={`Search ${TABS.find((t) => t[0] === tab)?.[1].slice(5) ?? tab} cyber jobs`} tick={tick} />
    </div>
  );
}
