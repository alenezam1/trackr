import React from 'react';
import { api } from '../api';
import { AppCtx } from '../App';
import { ErrorBox, Spinner, useAsync } from '../components/ui';

type Sw = { key: string; label: string; help: string; source?: 'profile' | 'settings'; invert?: boolean };

const SECTIONS: Array<{ title: string; items: Sw[] }> = [
  {
    title: 'Employer & sponsorship',
    items: [
      { key: 'requires_sponsor_licensed_employer', label: 'Employer must be on the Skilled Worker sponsor register', help: 'Off = employers not on the register are shown too (with a note).' },
      { key: 'exclude_b_rated_sponsors', label: 'Exclude B-rated sponsors', help: 'B-rated sponsors cannot normally issue new Certificates of Sponsorship.', source: 'settings' },
      { key: 'auto_accept_strong_sponsor_matches', label: 'Auto-accept strong sponsor name matches', help: 'Off = every employer → legal entity link waits for your confirmation.', source: 'settings' },
      { key: 'needs_eventual_skilled_worker_transition', label: 'Exclude "no sponsorship now or in the future" jobs', help: 'Off = keep them (you could still work on your Graduate visa).' },
      { key: 'require_explicit_role_sponsorship', label: 'Only jobs that explicitly offer sponsorship (very strict)', help: 'On = jobs that are silent about sponsorship go to review.' },
    ],
  },
  {
    title: 'Visa & right to work',
    items: [
      { key: 'exclude_graduate_visa_bans', label: 'Exclude jobs that refuse Graduate / time-limited visas', help: 'e.g. "We cannot accept time-limited work visas".' },
      { key: 'exclude_permanent_rtw_required', label: 'Exclude jobs requiring permanent / unrestricted / settled right to work', help: '"Right to work in the UK" alone is never treated as a blocker.' },
      { key: 'exclude_citizenship_restricted', label: 'Exclude citizenship / nationality / residency-restricted jobs', help: 'e.g. "British nationals only", "5 years UK residency".' },
      { key: 'allow_long_programme_exception', label: 'Allow 3-year programmes that state sponsorship (to review)', help: 'Off = 3-year schemes without a stated transition are excluded.' },
    ],
  },
  {
    title: 'Security vetting',
    items: [
      { key: 'review_ambiguous_vetting', label: 'Send unclear vetting wording to review', help: 'Off = "may require security screening" style wording is shown as info only.' },
    ],
  },
  {
    title: 'Role level, pay & students',
    items: [
      { key: 'exclude_senior_roles', label: 'Exclude senior / lead / manager titles', help: '' },
      { key: 'accept_only_paid_roles', label: 'Paid roles only', help: '' },
      { key: 'allow_student_only_placements', label: 'Include student-only placements', help: 'Usually closed to graduates — off by default.' },
      { key: 'review_unclear_location', label: 'Send unclear locations (e.g. "Remote", "EMEA") to review', help: 'Off = shown with a note instead.' },
    ],
  },
];

const CATS: Array<[string, string]> = [['SOC_SECURITY', 'Security / SOC'], ['GRC_RISK_AUDIT', 'GRC / Risk / Audit'], ['IT_TECHNICAL', 'IT / Infrastructure']];

function TargetRoles({ p, setP }: { p: any; setP: (x: any) => void }) {
  const [label, setLabel] = React.useState('');
  const [cat, setCat] = React.useState('SOC_SECURITY');
  const [open, setOpen] = React.useState<string | null>(null);
  const roles: any[] = p.target_roles ?? [];
  const upd = (id: string, patch: any) => setP({ ...p, target_roles: roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const add = () => {
    const words = label.split(',').map((w) => w.trim()).filter(Boolean);
    if (!words.length) return;
    setP({ ...p, target_roles: [...roles, { id: `custom-${Date.now()}`, label: words[0], category: cat, keywords: words.map((w) => w.toLowerCase()), enabled: true, custom: true }] });
    setLabel('');
  };
  return (
    <section className="card p-4 space-y-3">
      <div className="h2">Roles I want</div>
      <div className="text-xs text-mute">Tick the role types to search for. A job title must contain one of a role's keywords. Click a role to edit its keywords, or type your own role types below.</div>
      <div className="grid md:grid-cols-2 gap-2">
        {roles.map((r) => (
          <div key={r.id} className={`rounded-md border p-2 ${r.enabled ? 'border-accent/50 bg-accent/5' : 'border-line opacity-70'}`}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={r.enabled} onChange={(e) => upd(r.id, { enabled: e.target.checked })} aria-label={`Search for ${r.label}`} />
              <button className="flex-1 text-left text-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{r.label} <span className="text-xs text-mute">· {CATS.find((c) => c[0] === r.category)?.[1]}{r.custom ? ' · yours' : ''}</span></button>
              {r.custom && <button className="text-xs text-bad" onClick={() => setP({ ...p, target_roles: roles.filter((x) => x.id !== r.id) })}>Remove</button>}
            </div>
            {open === r.id && (
              <textarea className="input mt-2 h-20 text-xs" value={r.keywords.join(', ')} onChange={(e) => upd(r.id, { keywords: e.target.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean) })} aria-label="Keywords" />
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input flex-1 min-w-[260px]" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a role type, e.g. “Cloud Security Analyst, cloud security, CSPM”" />
        <select className="input w-48" value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn" onClick={add}>Add role</button>
        <button className="btn btn-sm" onClick={() => setP({ ...p, target_roles: roles.map((r) => ({ ...r, enabled: true })) })}>All on</button>
        <button className="btn btn-sm" onClick={() => setP({ ...p, target_roles: roles.map((r) => ({ ...r, enabled: false })) })}>All off</button>
      </div>
    </section>
  );
}

const KIND_LABEL: Record<string, string> = { exclude_title: 'Exclude if the job TITLE contains', exclude_text: 'Exclude if the JOB DESCRIPTION mentions', require_text: 'Only keep jobs that MENTION', exclude_employer: 'Exclude these EMPLOYERS' };

function CustomRestrictions({ p, setP }: { p: any; setP: (x: any) => void }) {
  const rules: any[] = p.custom_restrictions ?? [];
  const [kind, setKind] = React.useState('exclude_text');
  const [terms, setTerms] = React.useState('');
  const [action, setAction] = React.useState('exclude');
  const add = () => {
    const t = terms.split(',').map((x) => x.trim()).filter(Boolean);
    if (!t.length) return;
    setP({ ...p, custom_restrictions: [...rules, { id: `r-${Date.now()}`, label: `${KIND_LABEL[kind]}: ${t.join(', ')}`.slice(0, 120), kind, terms: t, action, enabled: true }] });
    setTerms('');
  };
  const upd = (id: string, patch: any) => setP({ ...p, custom_restrictions: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  return (
    <section className="card p-4 space-y-3">
      <div className="h2">My own restrictions</div>
      <div className="text-xs text-mute">Add any rule you like — e.g. exclude “on-call”, “driving licence”, “night shifts”; only keep jobs mentioning “hybrid”; exclude an employer. Each match is quoted on the job.</div>
      {rules.length === 0 && <div className="text-sm text-mute">No custom restrictions yet.</div>}
      {rules.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={r.enabled} onChange={(e) => upd(r.id, { enabled: e.target.checked })} aria-label="Enabled" />
          <span className="flex-1">{KIND_LABEL[r.kind]}: <b>{r.terms.join(', ')}</b></span>
          <select className="input w-36 py-1 text-xs" value={r.action} onChange={(e) => upd(r.id, { action: e.target.value })}><option value="exclude">Exclude</option><option value="review">Send to review</option></select>
          <button className="text-xs text-bad" onClick={() => setP({ ...p, custom_restrictions: rules.filter((x) => x.id !== r.id) })}>Delete</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 items-center pt-1">
        <select className="input w-72" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input flex-1 min-w-[220px]" value={terms} onChange={(e) => setTerms(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Words or phrases, comma-separated" />
        <select className="input w-36" value={action} onChange={(e) => setAction(e.target.value)}><option value="exclude">Exclude</option><option value="review">Send to review</option></select>
        <button className="btn" onClick={add}>Add restriction</button>
      </div>
    </section>
  );
}

export function RulesPage() {
  const { toast, refreshStatus } = React.useContext(AppCtx);
  const pr = useAsync(() => api('/api/profile'), []);
  const st = useAsync(() => api('/api/settings'), []);
  const [p, setP] = React.useState<any>(null);
  const [s, setS] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (pr.data) setP(pr.data.profile); }, [pr.data]);
  React.useEffect(() => { if (st.data) setS(st.data.settings); }, [st.data]);
  if (!p || !s) return <Spinner />;

  const val = (it: Sw) => (it.source === 'settings' ? s[it.key] : p[it.key]);
  const set = (it: Sw, v: any) => (it.source === 'settings' ? setS({ ...s, [it.key]: v }) : setP({ ...p, [it.key]: v }));
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api('/api/settings', { body: { exclude_b_rated_sponsors: s.exclude_b_rated_sponsors, auto_accept_strong_sponsor_matches: s.auto_accept_strong_sponsor_matches } });
      await api('/api/profile', { body: { profile: p, acknowledgeProtectedChange: true } });
      toast('Rules saved — every job is being re-checked with your new rules');
      refreshStatus();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="h1 flex-1">My Search &amp; Rules</div>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save & re-check all jobs'}</button>
      </div>
      <div className="text-sm text-mute">Choose the roles you want, switch restrictions on or off, or add your own. Switched-off rules still show the matching sentence on each job as information.</div>
      <ErrorBox error={err} />
      <TargetRoles p={p} setP={setP} />
      <CustomRestrictions p={p} setP={setP} />
      {SECTIONS.map((sec) => (
        <section key={sec.title} className="card p-4">
          <div className="h2 mb-3">{sec.title}</div>
          <div className="space-y-3">
            {sec.items.map((it) => (
              <label key={it.key} className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#2fb7d8]" checked={!!val(it)} onChange={(e) => set(it, e.target.checked)} />
                <span><span className="text-sm">{it.label}</span>{it.help && <span className="block text-xs text-mute">{it.help}</span>}</span>
              </label>
            ))}
          </div>
        </section>
      ))}
      <section className="card p-4 space-y-3">
        <div className="h2">Numbers &amp; lists</div>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="block"><span className="label">Excluded mandatory clearances</span>
            <div className="flex gap-4 mt-1.5">{['SC', 'DV', 'CTC'].map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={p.disallow_mandatory_clearance.includes(c)} onChange={(e) => setP({ ...p, disallow_mandatory_clearance: e.target.checked ? [...p.disallow_mandatory_clearance, c] : p.disallow_mandatory_clearance.filter((x: string) => x !== c) })} />{c}</label>
            ))}</div></label>
          <label className="block"><span className="label">Max mandatory experience (years)</span>
            <input className="input mt-1" type="number" min={0} max={15} value={p.max_required_relevant_experience_years} onChange={(e) => setP({ ...p, max_required_relevant_experience_years: Number(e.target.value) })} /></label>
          <label className="block"><span className="label">Role categories</span>
            <div className="flex flex-col gap-1 mt-1.5">{[['SOC_SECURITY', 'Security / SOC'], ['GRC_RISK_AUDIT', 'GRC / Risk / Audit'], ['IT_TECHNICAL', 'IT / Infrastructure']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={p.enabled_categories.includes(k)} onChange={(e) => setP({ ...p, enabled_categories: e.target.checked ? [...p.enabled_categories, k] : p.enabled_categories.filter((x: string) => x !== k) })} />{l}</label>
            ))}</div></label>
          <label className="block"><span className="label">Daily 15 split (Security/GRC + IT)</span>
            <div className="flex gap-2 mt-1"><input className="input" type="number" min={0} value={p.daily_quota.cyber_grc} onChange={(e) => setP({ ...p, daily_quota: { ...p.daily_quota, cyber_grc: Number(e.target.value) } })} />
              <input className="input" type="number" min={0} value={p.daily_quota.it_technical} onChange={(e) => setP({ ...p, daily_quota: { ...p.daily_quota, it_technical: Number(e.target.value) } })} /></div></label>
        </div>
      </section>
      <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save & re-check all jobs'}</button>
    </div>
  );
}
