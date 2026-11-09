import React from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, ShieldAlert, XCircle, Clock } from 'lucide-react';

export const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  VERIFIED_COMPATIBLE: { label: 'Verified (evidence-based)', cls: 'border-ok/50 text-ok bg-ok/10', icon: <CheckCircle2 size={12} /> },
  POTENTIAL_NO_STATED_BLOCKER: { label: 'Eligible · no restrictions stated in full JD', cls: 'border-info/50 text-info bg-info/10', icon: <CircleHelp size={12} /> },
  NEEDS_REVIEW: { label: 'Needs review', cls: 'border-warn/50 text-warn bg-warn/10', icon: <AlertTriangle size={12} /> },
  EXCLUDED: { label: 'Excluded', cls: 'border-bad/50 text-bad bg-bad/10', icon: <XCircle size={12} /> },
  STALE: { label: 'Stale / closed', cls: 'border-mute/40 text-mute bg-mute/10', icon: <Clock size={12} /> },
};

export function StatusBadge({ status }: { status: string | null }) {
  const m = STATUS_META[status ?? ''] ?? { label: status ?? 'Not analysed', cls: 'border-line text-mute', icon: null };
  return <span className={`badge ${m.cls}`}>{m.icon}{m.label}</span>;
}

export const CAT_LABEL: Record<string, string> = { SOC_SECURITY: 'Security / SOC', GRC_RISK_AUDIT: 'GRC / Risk / Audit', IT_TECHNICAL: 'IT / Infrastructure', OTHER: 'Out of scope', UNKNOWN: 'Category unclear' };
export const TYPE_LABEL: Record<string, string> = { OFF_CYCLE_INTERNSHIP: 'Off-cycle internship', INTERNSHIP: 'Internship', FIXED_TERM: 'Fixed-term', PERMANENT: 'Permanent', GRADUATE_PROGRAMME: 'Graduate programme', UNKNOWN: 'Type not stated' };

export function Badge({ children, tone = 'mute', title }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'mute'; title?: string }) {
  const cls = { ok: 'border-ok/40 text-ok', warn: 'border-warn/40 text-warn', bad: 'border-bad/40 text-bad', info: 'border-info/40 text-info', accent: 'border-accent/50 text-accent', mute: 'border-line text-mute' }[tone];
  return <span className={`badge ${cls}`} title={title}>{children}</span>;
}

export function SponsorBadge({ s }: { s: any }) {
  if (!s?.status) return <Badge>Sponsor: not checked</Badge>;
  if (s.status === 'VERIFIED_EXACT' || s.status === 'VERIFIED_ALIAS') {
    const rated = s.rating === 'A' ? 'A-rated' : `${s.rating}-rated`;
    return <Badge tone={s.rating === 'A' ? 'ok' : 'warn'} title={s.note}>Sponsor: MATCHED ({rated} Skilled Worker) · {s.legalName}</Badge>;
  }
  if (s.status === 'NOT_FOUND') return <Badge tone="bad" title={s.note}>Sponsor: NOT on Skilled Worker register</Badge>;
  if (s.status === 'EMPLOYER_UNKNOWN') return <Badge tone="warn" title={s.note}>Sponsor: actual employer unknown</Badge>;
  return <Badge tone="warn" title={s.note}>Sponsor: {s.status === 'PROPOSED' ? 'proposed match — confirm' : 'ambiguous'}</Badge>;
}

export function VisaBadge({ m }: { m: any }) {
  if (!m) return null;
  const gv = m.role_accepts_graduate_visa;
  if (gv === 'EXPLICIT_YES') return <Badge tone="ok">Graduate visa: explicitly accepted in JD</Badge>;
  if (gv === 'EXPLICIT_NO') return <Badge tone="bad">Graduate visa: explicitly NOT accepted</Badge>;
  if (gv === 'NO_STATED_BLOCKER') return <Badge tone="info">Graduate visa: NO STATED BLOCKER (not confirmed)</Badge>;
  return <Badge tone="warn">Graduate visa: unknown</Badge>;
}

export function ClearanceBadge({ f, hasJd }: { f: any; hasJd: boolean }) {
  if (!hasJd) return <Badge tone="warn">Clearance: full JD not read</Badge>;
  if (f?.mandatoryClearances?.length) return <Badge tone="bad">Clearance: {f.mandatoryClearances.join('/')} mandatory</Badge>;
  const extra = f?.backgroundChecks?.length ? ` (${f.backgroundChecks.join(', ')} only)` : '';
  return <Badge tone="mute">Clearance: no mandatory SC/DV/CTC in full JD{extra}</Badge>;
}

export function RoleFocusToggle({ value, onChange }: { value: string; onChange: (v: 'BOTH' | 'INTERNSHIP' | 'GRADUATE') => void }) {
  const opts: Array<['BOTH' | 'INTERNSHIP' | 'GRADUATE', string]> = [['INTERNSHIP', 'Internships'], ['GRADUATE', 'Graduate / entry-level'], ['BOTH', 'Both']];
  return (
    <div role="radiogroup" aria-label="Role type" className="inline-flex rounded-md border border-line overflow-hidden">
      {opts.map(([k, l]) => (
        <button key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`px-3 py-1.5 text-[13px] ${value === k ? 'bg-accent/90 text-[#04131a] font-semibold' : 'bg-panel2 text-mute hover:text-ink'}`}>{l}</button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-mute"><Loader2 size={14} className="animate-spin" />{label}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="card p-8 text-center"><div className="text-ink font-medium">{title}</div>{children && <div className="text-mute mt-2 text-sm max-w-xl mx-auto">{children}</div>}</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="card border-bad/50 bg-bad/5 p-3 text-bad text-sm flex gap-2"><ShieldAlert size={16} className="shrink-0 mt-0.5" />{error}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="card p-3">
      <div className="label">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tone ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-mute mt-1">{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-6 overflow-auto" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className={`card w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} p-5 mt-6`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-base">{title}</div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, set] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true }));
    fn().then((d) => alive && set({ data: d, error: null, loading: false })).catch((e) => alive && set({ data: null, error: String(e.message ?? e), loading: false }));
    return () => { alive = false; };
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

export function Toast({ msg, onDone }: { msg: string | null; onDone: () => void }) {
  React.useEffect(() => { if (msg) { const t = setTimeout(onDone, 4500); return () => clearTimeout(t); } }, [msg, onDone]);
  if (!msg) return null;
  return <div className="fixed bottom-4 right-4 z-[60] card px-4 py-2.5 text-sm border-accent/50 max-w-md shadow-xl">{msg}</div>;
}
