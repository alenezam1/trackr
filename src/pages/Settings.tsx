import React from 'react';
import { api, fmtDateTime, openExternal } from '../api';
import { AppCtx } from '../App';
import { Badge, ErrorBox, Spinner, useAsync } from '../components/ui';

const SECRET_LABELS: Record<string, [string, string]> = {
  dataforseo_login: ['DataForSEO API login (Google search, ~$2 per 1,000)', 'https://app.dataforseo.com/api-access'],
  dataforseo_password: ['DataForSEO API password', 'https://app.dataforseo.com/api-access'],
  jina_api_key: ['Jina key (page reader + search, ~$0.50 per 1,000)', 'https://jina.ai/api-dashboard'],
  serpapi_api_key: ['SerpApi — Google Jobs (optional)', 'https://serpapi.com/users/sign_up'],
  exa_api_key: ['Exa web search (optional backup)', 'https://dashboard.exa.ai/api-keys'],
  reed_api_key: ['Reed jobs API (free)', 'https://www.reed.co.uk/developers/jobseeker'],
  adzuna_app_id: ['Adzuna app id (free)', 'https://developer.adzuna.com/signup'],
  adzuna_app_key: ['Adzuna app key (free)', 'https://developer.adzuna.com/signup'],
  jooble_api_key: ['Jooble API key (free)', 'https://jooble.org/api/about'],
  openai_api_key: ['OpenAI (paid — AI features)', 'https://platform.openai.com/api-keys'],
};

export function SettingsPage() {
  const { toast, refreshStatus } = React.useContext(AppCtx);
  const st = useAsync(() => api('/api/settings'), []);
  const pr = useAsync(() => api('/api/profile'), []);
  const backups = useAsync(() => api('/api/backups'), []);
  const [p, setP] = React.useState<any>(null);
  const [s, setS] = React.useState<any>(null);
  const [secretVals, setSecretVals] = React.useState<Record<string, string>>({});
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (pr.data) setP(pr.data.profile); }, [pr.data]);
  React.useEffect(() => { if (st.data) setS(st.data.settings); }, [st.data]);
  if (!p || !s) return <Spinner />;

  const saveProfile = async (ack = false) => {
    setErr(null);
    try { await api('/api/profile', { body: { profile: p, acknowledgeProtectedChange: ack } }); toast('Profile saved — all jobs are being re-evaluated'); pr.reload(); refreshStatus(); }
    catch (e: any) {
      if (/Protected eligibility settings/.test(e.message) && confirm(`${e.message}\n\nThis changes which jobs are excluded. Continue?`)) return saveProfile(true);
      setErr(e.message);
    }
  };
  const saveSettings = async () => { setErr(null); try { await api('/api/settings', { body: s }); toast('Settings saved'); st.reload(); refreshStatus(); } catch (e: any) { setErr(e.message); } };
  const field = (k: string, label: string, type = 'text') => (
    <label className="block"><span className="label">{label}</span>
      <input className="input mt-0.5" type={type} value={p[k] ?? ''} onChange={(e) => setP({ ...p, [k]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || null) })} /></label>
  );
  const check = (obj: any, set: (v: any) => void, k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!obj[k]} onChange={(e) => set({ ...obj, [k]: e.target.checked })} />{label}</label>
  );
  const list = (k: string, label: string) => (
    <label className="block"><span className="label">{label} (one per line)</span>
      <textarea className="input mt-0.5 h-20 text-xs" value={(p[k] ?? []).join('\n')} onChange={(e) => setP({ ...p, [k]: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></label>
  );

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="h1">Settings</div>
      <ErrorBox error={err} />

      <section className="card p-4 space-y-3">
        <div className="h2">Candidate profile &amp; visa (private, local only)</div>
        <div className="text-xs text-mute">These are your personal search filters, not legal statements. The app never assumes a visa grant: “Verified” matches require a confirmed grant and checked evidence.</div>
        <div className="grid md:grid-cols-3 gap-3">
          {field('name', 'Name (used only in drafts)')}
          {field('nationality', 'Nationality')}
          <label className="block"><span className="label">UK visa status</span>
            <select className="input mt-0.5" value={p.uk_visa_status} onChange={(e) => setP({ ...p, uk_visa_status: e.target.value })}>
              {['student', 'graduate_planned', 'graduate_applied', 'graduate_granted', 'skilled_worker', 'other'].map((x) => <option key={x}>{x}</option>)}
            </select></label>
          {field('graduate_application_date', 'Graduate visa application date', 'date')}
          {field('graduate_visa_grant_date', 'Graduate visa grant date', 'date')}
          {field('graduate_visa_expiry_date', 'Graduate visa expiry date', 'date')}
          {field('earliest_available_start_date', 'Earliest available start', 'date')}
          {field('graduation_year', 'Graduation year', 'number')}
          {field('uk_residency_years', 'Years of UK residency', 'number')}
        </div>
        <div className="flex flex-wrap gap-4">
          {check(p, setP, 'work_permission_evidence_checked', 'I have checked my BRP/eVisa evidence (permission confirmed)')}
          {check(p, setP, 'currently_enrolled', 'Currently enrolled as a student')}
        </div>
        <div className="text-xs text-mute">{st.data?.settings?.graduate_visa_rules && `Rule source: ${st.data.settings.graduate_visa_rules.source} (verified ${st.data.settings.graduate_visa_rules.last_verified_at}): 24 months if applied on/before 31 Dec 2026, 18 months from 1 Jan 2027. Starts on approval; cannot be extended.`}</div>
        <div className="grid md:grid-cols-2 gap-3">
          {list('education', 'Education')}{list('experience', 'Experience')}{list('skills', 'Skills (used for fit scoring)')}{list('certifications_in_progress', 'Certifications IN PROGRESS')}
        </div>
      </section>

      <section className="card p-4 space-y-3 border-warn/30">
        <div className="h2">Protected eligibility rules</div>
        <div className="text-xs text-mute">Changes here require explicit confirmation and re-evaluate every job. The search bar can never change them.</div>
        <div className="grid md:grid-cols-2 gap-2">
          <div className="text-sm"><Badge tone="ok">Always on</Badge> Employer must be on the Skilled Worker register</div>
          {check(p, setP, 'needs_eventual_skilled_worker_transition', 'I need a future Skilled Worker route (strict “no sponsorship now or future” excludes)')}
          {check(p, setP, 'require_explicit_role_sponsorship', 'Extra-strict: require the vacancy to explicitly offer sponsorship')}
          {check(p, setP, 'accept_only_paid_roles', 'Paid roles only')}
          {check(p, setP, 'allow_student_only_placements', 'Allow student-only placements')}
          {check(p, setP, 'allow_long_programme_exception', 'Allow review of 3-year programmes that state sponsorship (never auto-approved)')}
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <label className="block"><span className="label">Excluded mandatory clearances</span>
            <div className="flex gap-3 mt-1">{['SC', 'DV', 'CTC'].map((c) => <label key={c} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={p.disallow_mandatory_clearance.includes(c)} onChange={(e) => setP({ ...p, disallow_mandatory_clearance: e.target.checked ? [...p.disallow_mandatory_clearance, c] : p.disallow_mandatory_clearance.filter((x: string) => x !== c) })} />{c}</label>)}</div></label>
          {field('max_required_relevant_experience_years', 'Max mandatory experience (years)', 'number')}
          <label className="block"><span className="label">Daily quota (cyber/GRC + IT)</span>
            <div className="flex gap-2 mt-0.5"><input className="input" type="number" value={p.daily_quota.cyber_grc} onChange={(e) => setP({ ...p, daily_quota: { ...p.daily_quota, cyber_grc: Number(e.target.value) } })} /><input className="input" type="number" value={p.daily_quota.it_technical} onChange={(e) => setP({ ...p, daily_quota: { ...p.daily_quota, it_technical: Number(e.target.value) } })} /></div></label>
        </div>
        <button className="btn btn-primary" onClick={() => saveProfile(false)}>Save profile &amp; re-evaluate</button>
      </section>

      <section className="card p-4 space-y-3">
        <div className="h2">API keys (encrypted with Windows DPAPI, never shown again)</div>
        <div className="text-xs text-mute">Keys and all your work are saved in <code>{st.data?.dataDir ?? '…'}</code> and reloaded every time you open the app. A saved key is used automatically (saving an OpenAI key switches AI on).</div>
        <div className="text-xs text-mute"><b>Recommended:</b> DataForSEO (real Google results, pay-as-you-go, no monthly cap) for searching + Jina (opens and reads postings, renders JavaScript) for reading pages — a typical scan costs about $0.50. Jina alone also works for both. Click a name to sign up. DataForSEO's API login and password are on its “API Access” page (not your website login).</div>
        {Object.entries(SECRET_LABELS).map(([k, [label, link]]) => (
          <div key={k} className="flex items-center gap-2">
            <button className="w-72 text-sm text-left hover:text-accent underline-offset-2 hover:underline" onClick={() => openExternal(link)} title={link}>{label}</button>
            <Badge tone={st.data?.secrets?.[k] ? 'ok' : 'mute'}>{st.data?.secrets?.[k] ? 'Saved' : 'Not set'}</Badge>
            <input type="password" autoComplete="off" className="input w-72" value={secretVals[k] ?? ''} onChange={(e) => setSecretVals({ ...secretVals, [k]: e.target.value })} placeholder="Paste to set/replace" />
            <button className="btn btn-sm" disabled={!secretVals[k]} onClick={async () => { try { await api(`/api/secrets/${k}`, { body: { value: secretVals[k] } }); setSecretVals({ ...secretVals, [k]: '' }); st.reload(); toast('Key saved (encrypted)'); } catch (e: any) { toast(e.message); } }}>Save</button>
            {st.data?.secrets?.[k] && <button className="btn btn-sm btn-danger" onClick={async () => { await api(`/api/secrets/${k}`, { method: 'DELETE' }); st.reload(); }}>Delete</button>}
            {k === 'openai_api_key' && st.data?.secrets?.[k] && <button className="btn btn-sm" onClick={async () => toast((await api('/api/ai/test', { body: {} })).message)}>Test API key</button>}
          </div>
        ))}
        <div className="grid md:grid-cols-3 gap-3 pt-2">
          <div className="block md:col-span-2"><span className="label">Web-search providers (used in this order; falls back when one runs out)</span>
            <div className="flex flex-wrap gap-3 mt-1">{['dataforseo', 'jina', 'searxng', 'exa'].map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.search_providers.includes(p)} onChange={(e) => setS({ ...s, search_providers: e.target.checked ? [...s.search_providers, p] : s.search_providers.filter((x: string) => x !== p) })} />{p}</label>
            ))}
            <button className="btn btn-sm" onClick={async () => { try { const r = await api('/api/sources/web_search/verify', { body: {} }); toast(`${r.status}: ${r.message}`); } catch (e: any) { toast(e.message); } }}>Test search</button></div></div>
          <label className="block"><span className="label">SearXNG instance URL (optional, free, no key)</span><input className="input mt-0.5" value={s.searxng_url} placeholder="http://localhost:8080" onChange={(e) => setS({ ...s, searxng_url: e.target.value })} /></label>
          <label className="block"><span className="label">Google Jobs searches per scan</span><input className="input mt-0.5" type="number" value={s.google_jobs_queries_per_run} onChange={(e) => setS({ ...s, google_jobs_queries_per_run: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">Max search/API queries per run</span><input className="input mt-0.5" type="number" value={s.search_max_queries_per_run} onChange={(e) => setS({ ...s, search_max_queries_per_run: Number(e.target.value) })} /></label>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div className="h2">OpenAI analysis (optional)</div>
        <div className="text-xs text-mute">AI only extracts facts with quotes; every quote is checked against the JD and the deterministic rules decide. If AI fails, jobs stay in review.</div>
        <div className="card p-3 text-xs"><div className="font-medium mb-1">Data sent to OpenAI when enabled:</div><ul className="list-disc ml-4">{st.data?.aiDisclosure?.map((d: string) => <li key={d}>{d}</li>)}</ul></div>
        <div className="grid md:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.ai_enabled} onChange={(e) => setS({ ...s, ai_enabled: e.target.checked })} />Enable AI (extraction, ranking, web search)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.ai_web_search_enabled} onChange={(e) => setS({ ...s, ai_web_search_enabled: e.target.checked })} />AI web search across job boards</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.ai_rank_after_scan} onChange={(e) => setS({ ...s, ai_rank_after_scan: e.target.checked })} />AI-rank the shortlist after each scan</label>
          <label className="block"><span className="label">AI web search results per run</span><input className="input mt-0.5" type="number" value={s.ai_web_search_max_results} onChange={(e) => setS({ ...s, ai_web_search_max_results: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">Model</span><input className="input mt-0.5" value={s.openai_model} onChange={(e) => setS({ ...s, openai_model: e.target.value })} /></label>
          <label className="block"><span className="label">Daily budget (USD)</span><input className="input mt-0.5" type="number" step="0.1" value={s.ai_daily_budget_usd} onChange={(e) => setS({ ...s, ai_daily_budget_usd: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">Max AI jobs per run</span><input className="input mt-0.5" type="number" value={s.ai_max_jobs_per_run} onChange={(e) => setS({ ...s, ai_max_jobs_per_run: Number(e.target.value) })} /></label>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div className="h2">Scanning</div>
        <div className="grid md:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.schedule_enabled} onChange={(e) => setS({ ...s, schedule_enabled: e.target.checked })} />Weekday scan while app is open</label>
          <label className="block"><span className="label">Time (Europe/London)</span><input className="input mt-0.5" type="time" value={s.schedule_time_london} onChange={(e) => setS({ ...s, schedule_time_london: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.schedule_catch_up} onChange={(e) => setS({ ...s, schedule_catch_up: e.target.checked })} />Catch up when reopened</label>
          <label className="block"><span className="label">Only postings from the last N days</span><input className="input mt-0.5" type="number" min={1} max={365} value={s.max_posting_age_days} onChange={(e) => setS({ ...s, max_posting_age_days: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">Google Jobs searches per Gulf scan</span><input className="input mt-0.5" type="number" value={s.gulf_google_queries_per_run} onChange={(e) => setS({ ...s, gulf_google_queries_per_run: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm" title="OpenAI writes test searches, scores them on real results, then plans and adapts the full search run."><input type="checkbox" checked={s.ai_search_planner} onChange={(e) => setS({ ...s, ai_search_planner: e.target.checked })} />AI-steered search (OpenAI plans, DataForSEO / Jina search)</label>
          <label className="block"><span className="label">AI planner: test searches before planning</span><input className="input mt-0.5" type="number" min={6} max={60} value={s.ai_search_probe_size} onChange={(e) => setS({ ...s, ai_search_probe_size: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">AI planner: re-plans during a scan</span><input className="input mt-0.5" type="number" min={0} max={5} value={s.ai_search_replans} onChange={(e) => setS({ ...s, ai_search_replans: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.ai_read_fallback} onChange={(e) => setS({ ...s, ai_read_fallback: e.target.checked })} />Let AI web search read postings the app can’t open (labelled)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.auto_accept_strong_sponsor_matches} onChange={(e) => setS({ ...s, auto_accept_strong_sponsor_matches: e.target.checked })} />Auto-accept strong sponsor name matches</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.exclude_b_rated_sponsors} onChange={(e) => setS({ ...s, exclude_b_rated_sponsors: e.target.checked })} />Exclude B-rated sponsors</label>
          <label className="block"><span className="label">Visa-friendly employer boost (fit points)</span><input className="input mt-0.5" type="number" value={s.visa_friendly_boost} onChange={(e) => setS({ ...s, visa_friendly_boost: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">Deadline radar window (days)</span><input className="input mt-0.5" type="number" value={s.deadline_radar_days} onChange={(e) => setS({ ...s, deadline_radar_days: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.daily_include_potential} onChange={(e) => setS({ ...s, daily_include_potential: e.target.checked })} />Daily 15 includes potential matches (labelled)</label>
          {[['gulf_eligible_min_score', 'Gulf: entry-level score needed for Eligible (0–100)'], ['quality_spot_checks', 'After each scan, re-check N Eligible jobs are still open'], ['gulf_web_queries_per_run', 'Web searches per Gulf scan'], ['web_queries_per_run', 'Web searches per UK scan'], ['ai_link_reads_per_run', 'Links the AI reader may open per scan'], ['board_page_reads_per_run', 'Postings opened to confirm they are live (Jina reader)'], ['scan_time_budget_minutes', 'Scan time limit (minutes)'], ['max_employers_per_run', 'Employer boards per run'], ['ats_autodiscover_per_run', 'Sponsors probed for new boards per run'], ['max_jobs_per_run', 'Max jobs analysed per run'], ['global_concurrency', 'Concurrency'], ['per_source_delay_ms', 'Delay between requests per source (ms)'], ['request_timeout_ms', 'Request timeout (ms)'], ['sponsor_current_days', 'Register CURRENT ≤ days'], ['sponsor_stale_days', 'Register STALE > days']].map(([k, l]) => (
            <label key={k} className="block"><span className="label">{l}</span><input className="input mt-0.5" type="number" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} /></label>
          ))}
        </div>
        <button className="btn btn-primary" onClick={saveSettings}>Save settings</button>
      </section>

      <section className="card p-4 space-y-2">
        <div className="h2">Backup</div>
        <div className="text-xs text-mute">Creates a full database copy plus a settings/profile export (API keys excluded) in your data folder.</div>
        <button className="btn" onClick={async () => { const r = await api('/api/backup', { body: {} }); toast(`Backup written: ${r.file}`); backups.reload(); }}>Back up now</button>
        <div className="text-xs text-mute">{backups.data?.slice(0, 5).map((b: any) => <div key={b.name}>{b.name} · {(b.size / 1e6).toFixed(1)} MB · {fmtDateTime(b.at)}</div>)}</div>
        <div className="text-xs text-mute">To restore: close the app and copy a backup over <code>trackr.sqlite</code> in the data folder (see USER_GUIDE).</div>
      </section>
    </div>
  );
}
