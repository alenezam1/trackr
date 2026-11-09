import React from 'react';
import { ExternalLink, Copy, RefreshCw, CheckCircle2, Trash2 } from 'lucide-react';
import { api, openExternal, fmtDate, fmtDateTime } from '../api';
import { boardName } from './JobCard';
import { Badge, CAT_LABEL, Empty, ErrorBox, Modal, SponsorBadge, Spinner, StatusBadge, TYPE_LABEL, useAsync, VisaBadge } from './ui';

const STAGES = ['Discovered', 'Needs Review', 'Shortlisted', 'To Apply', 'In Progress', 'Applied', 'Assessment', 'Recruiter Screen', 'Interview', 'Offer', 'Rejected', 'Withdrawn', 'Closed / Expired', 'Archived'];

function Highlighted({ text, evidence }: { text: string; evidence: any[] }) {
  const spans = evidence.filter((e) => e.startOffset != null && e.endOffset != null && e.endOffset <= text.length)
    .sort((a, b) => a.startOffset - b.startOffset)
    .reduce<any[]>((acc, e) => { if (!acc.length || e.startOffset >= acc[acc.length - 1].endOffset) acc.push(e); return acc; }, []);
  const parts: React.ReactNode[] = []; let pos = 0;
  spans.forEach((e, i) => {
    if (e.startOffset > pos) parts.push(text.slice(pos, e.startOffset));
    const hard = /clearance_mandatory|british|permanent|disallowed|student_required|now_or_future|unpaid|experience_required/.test(e.field);
    parts.push(<mark key={i} title={`${e.field} (${e.origin}, ${e.confidence})`} className={`${hard ? 'bg-bad/25 text-ink' : 'bg-accent/20 text-ink'} rounded px-0.5`}>{text.slice(e.startOffset, e.endOffset)}</mark>);
    pos = e.endOffset;
  });
  parts.push(text.slice(pos));
  return <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink/90">{parts}</pre>;
}

export function JobDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged?: (m?: string) => void }) {
  const { data: d, error, loading, reload } = useAsync(() => api(`/api/jobs/${id}`), [id]);
  const [tab, setTab] = React.useState<'decision' | 'jd' | 'sponsor' | 'track' | 'draft'>('decision');
  const [paste, setPaste] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [cands, setCands] = React.useState<any[] | null>(null);
  const [candQ, setCandQ] = React.useState('');
  const [draft, setDraft] = React.useState<string>('');

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); reload(); onChanged?.(); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  if (loading && !d) return <Modal title="Job" onClose={onClose} wide><Spinner label="Loading…" /></Modal>;
  if (error || !d) return <Modal title="Job" onClose={onClose} wide><ErrorBox error={error ?? 'Not found'} /></Modal>;

  const reasons: any[] = d.reasons ?? [];
  const hard = reasons.filter((r) => r.severity === 'hard_fail');
  const unc = reasons.filter((r) => r.severity === 'uncertain');
  const adv = reasons.filter((r) => r.severity === 'advisory');
  const m = d.matrix ?? {};
  const evidence = d.facts?.evidence ?? [];
  const app = d.application;

  const loadCandidates = async (q?: string) => {
    const empId = d.sponsorMatch?.candidates?.length ? null : null;
    void empId;
    const res = await api(`/api/sponsors?q=${encodeURIComponent(q ?? d.employer ?? '')}`);
    setCands(res.results);
  };

  return (
    <Modal title={d.title} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-1.5 -mt-1 mb-3">
        {d.isDemo && <Badge tone="warn">DEMO — synthetic</Badge>}
        <StatusBadge status={d.status} />
        <Badge tone="accent">{TYPE_LABEL[d.employmentType] ?? '—'}</Badge>
        <Badge>{CAT_LABEL[d.category] ?? '—'}</Badge>
        <SponsorBadge s={d.sponsor} />
        <VisaBadge m={m} />
        <span className="ml-auto text-accent font-semibold">{d.fit != null ? `Fit ${d.fit}/100` : 'No fit score (excluded/stale)'}</span>
      </div>
      <div className="text-sm text-mute mb-3">
        {d.employer ?? 'Employer not stated'} · {d.location ?? 'Location not stated'} · {d.salaryText ?? 'Salary not stated'} · Posted {fmtDate(d.postedAt)} · Data last refreshed {fmtDateTime(d.lastCheckedAt)} · Evidence checked {fmtDateTime(d.decidedAt)}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <button className="btn btn-primary" disabled={!d.applyUrl} onClick={() => openExternal(d.applyUrl)}><ExternalLink size={14} />{d.applyUrlKind === 'BOARD' ? `Open posting on ${boardName(d.applyUrl)} (no employer careers page found)` : 'Apply on employer careers site'}</button>
        <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/jobs/${id}/reanalyse`, { body: { allowAi: true } }), 'Re-analysed')}><RefreshCw size={14} />Re-analyse</button>
        <button className="btn" onClick={() => run(() => api(`/api/jobs/${id}/stage`, { body: { stage: 'Shortlisted' } }), 'Saved (Shortlisted)')}>Save</button>
        <button className="btn" onClick={() => {
          if (confirm('Only confirm if you have actually SUBMITTED this application. Mark as Applied?')) run(() => api(`/api/jobs/${id}/stage`, { body: { stage: 'Applied', confirmSubmitted: true } }), 'Marked applied');
        }}><CheckCircle2 size={14} />Mark applied</button>
        {d.sources?.filter((s: any) => s.board_url).map((s: any, i: number) => <button key={i} className="btn" onClick={() => openExternal(s.board_url)}>Open on {s.source_id}</button>)}
        <button className="btn text-bad" onClick={async () => {
          if (!confirm(`Remove "${d.title}" for good? It will be deleted everywhere and future scans will skip it.`)) return;
          try { await api(`/api/jobs/${id}/remove`, { body: {} }); onChanged?.('Job removed'); onClose(); } catch (e: any) { onChanged?.(e.message); }
        }}><Trash2 size={14} />Remove job</button>
      </div>
      {msg && <div className="text-sm text-accent mb-2">{msg}</div>}

      <div className="flex gap-1 border-b border-line mb-3">
        {[['decision', 'Decision & evidence'], ['jd', 'Full JD'], ['sponsor', 'Sponsor match'], ['track', 'Tracker'], ['draft', 'Drafts & questions']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${tab === k ? 'border-accent text-accent' : 'border-transparent text-mute hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {tab === 'decision' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {Object.entries(m).map(([k, v]) => <div key={k} className="card p-2"><div className="text-mute">{k.replace(/_/g, ' ')}</div><div className="font-mono mt-0.5">{String(v)}</div></div>)}
          </div>
          {d.permissionNote && <div className="text-xs text-mute">{d.permissionNote}</div>}
          {[['Hard blockers (rejection proof)', hard, 'text-bad'], ['Needs checking', unc, 'text-warn'], ['Advisory', adv, 'text-mute']].map(([title, list, cls]: any) => list.length > 0 && (
            <div key={title}>
              <div className="h2 mb-1.5">{title}</div>
              <div className="space-y-1.5">
                {list.map((r: any, i: number) => (
                  <div key={i} className="card p-2.5 text-sm">
                    <div className={cls}><span className="font-mono text-xs mr-2">{r.code}</span>{r.message}</div>
                    {r.evidence?.quote && <div className="mt-1 text-xs border-l-2 border-line pl-2 text-ink/80">“{r.evidence.quote}” <span className="text-mute">— {r.evidence.origin ?? 'RULES'}, {r.evidence.sourceUrl ? <button className="underline" onClick={() => openExternal(r.evidence.sourceUrl)}>source</button> : 'source'}</span></div>}
                    {r.profileSetting && <div className="text-xs text-mute mt-0.5">Profile setting: {r.profileSetting} · rules {d.decisionHistory?.[0]?.rules_version}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {d.status === 'VERIFIED_COMPATIBLE' && <div className="text-xs text-mute">"Verified" means every configured gate has supporting evidence. It is not a legal guarantee or employer confirmation.</div>}
          {d.fitInfo && (
            <div>
              <div className="h2 mb-1.5">Fit ({d.fit}/100)</div>
              <div className="text-xs text-mute font-mono">{Object.entries(d.fitInfo.components).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
              <ul className="list-disc ml-5 text-sm mt-1">{d.fitInfo.whyItFits.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
              {d.fitInfo.gaps.length > 0 && <ul className="list-disc ml-5 text-sm mt-1 text-warn">{d.fitInfo.gaps.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>}
            </div>
          )}
          <div className="card p-3">
            <div className="h2 mb-2">Manual review / dispute</div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" disabled={hard.length > 0} title={hard.length ? 'Hard blockers cannot be overridden — correct the source data (e.g. sponsor entity) instead.' : ''} onClick={() => run(() => api(`/api/jobs/${id}/feedback`, { body: { reviewVerdict: 'CONFIRMED_ELIGIBLE', note: 'Checked manually' } }), 'Marked confirmed eligible (by you)')}>Confirmed eligible</button>
              <button className="btn btn-sm" onClick={() => run(() => api(`/api/jobs/${id}/feedback`, { body: { reviewVerdict: 'CONFIRMED_INELIGIBLE' } }), 'Marked confirmed ineligible')}>Confirmed ineligible</button>
              <button className="btn btn-sm" onClick={() => run(() => api(`/api/jobs/${id}/feedback`, { body: { reviewVerdict: 'UNKNOWN', note: 'Disputed — needs manual review' } }), 'Flagged for manual review')}>Dispute / mark for review</button>
              <button className="btn btn-sm" onClick={() => run(() => api(`/api/jobs/${id}/feedback`, { body: { strongFit: true } }), 'Marked strong fit')}>Strong fit</button>
            </div>
          </div>
          <div className="text-xs text-mute">Decision history: {d.decisionHistory?.slice(0, 5).map((h: any) => `${h.status} @ ${fmtDateTime(h.created_at)}`).join(' → ')}</div>
        </div>
      )}

      {tab === 'jd' && (
        <div className="space-y-3">
          {d.jd ? (
            <>
              <div className="text-xs text-mute">
                {d.jd.complete ? 'Full JD' : 'INCOMPLETE JD (snippet)'} · method {d.jd.extraction_method} · {d.jd.access_mode} · fetched {fmtDateTime(d.jd.fetched_at)} · hash {d.jd.hash.slice(0, 12)} · versions {d.jdVersions.length}
                {d.analysisMeta?.model ? ` · AI ${d.analysisMeta.model} (${d.analysisMeta.prompt_version})` : ' · rules-only analysis'}{d.analysisMeta?.ai_error ? ` · AI error: ${d.analysisMeta.ai_error}` : ''}
              </div>
              <div className="card p-3 max-h-[55vh] overflow-auto"><Highlighted text={d.jd.text} evidence={evidence} /></div>
            </>
          ) : <Empty title="Full JD not read">This listing is only a link/snippet. Open it in your browser, then paste the full job description below.</Empty>}
          <div>
            <div className="label mb-1">Paste / replace JD text (treated as untrusted data)</div>
            <textarea className="input h-28" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste the complete job description…" />
            <div className="flex gap-2 mt-2">
              <button className="btn btn-sm" disabled={paste.trim().length < 50 || busy} onClick={() => run(() => api(`/api/jobs/${id}/paste-jd`, { body: { text: paste } }), 'JD saved and re-analysed')}>Save &amp; re-analyse</button>
              {d.applyUrl && <button className="btn btn-sm" onClick={() => openExternal(d.applyUrl)}>Open in browser</button>}
            </div>
          </div>
        </div>
      )}

      {tab === 'sponsor' && (
        <div className="space-y-3 text-sm">
          <div className="card p-3">
            <div>Status: <span className="font-mono">{d.sponsorMatch?.status}</span> · method <span className="font-mono">{d.sponsorMatch?.method}</span> · snapshot {d.sponsorMatch?.snapshotDate} ({d.sponsorMatch?.snapshotAge})</div>
            <div className="text-mute mt-1">{d.sponsorMatch?.note}</div>
            {d.sponsorMatch?.matched && (
              <div className="mt-2 font-mono text-xs">Matched CSV row: {d.sponsorMatch.matched.legal_name} | {d.sponsorMatch.matched.town} | {d.sponsorMatch.matched.county || '—'} | {d.sponsorMatch.matched.type_rating} | {d.sponsorMatch.matched.route}</div>
            )}
            {d.sponsorMatch?.candidates?.length > 0 && !d.sponsorMatch?.matched && (
              <div className="mt-2"><div className="label">Candidates (not proof):</div>
                {d.sponsorMatch.candidates.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 mt-1 text-xs"><span className="font-mono">{c.legal_name} · {c.town} · {c.type_rating}</span>
                    <button className="btn btn-sm" onClick={() => run(() => api(`/api/jobs/${id}/correct-employer`, { body: { sponsorOrgId: c.id } }), 'Entity confirmed; jobs re-evaluated')}>This is the employer</button></div>
                ))}
              </div>
            )}
          </div>
          <div className="card p-3">
            <div className="h2 mb-2">Correct entity match</div>
            <div className="flex gap-2"><input className="input" value={candQ} onChange={(e) => setCandQ(e.target.value)} placeholder={`Search register (e.g. ${d.employer ?? 'legal name'})`} />
              <button className="btn" onClick={() => loadCandidates(candQ || d.employer)}>Search</button></div>
            {cands && (cands.length ? cands.map((c) => (
              <div key={c.id} className="flex items-center gap-2 mt-1.5 text-xs"><span className="font-mono flex-1">{c.legal_name} · {c.town} · {c.type_rating} · {c.route}</span>
                <button className="btn btn-sm" onClick={() => run(() => api(`/api/jobs/${id}/correct-employer`, { body: { sponsorOrgId: c.id } }), 'Entity confirmed; jobs re-evaluated')}>Confirm</button></div>
            )) : <div className="text-mute text-xs mt-2">No Skilled Worker register rows found.</div>)}
            <button className="btn btn-sm btn-danger mt-3" onClick={() => run(() => api(`/api/jobs/${id}/correct-employer`, { body: { sponsorOrgId: null, notSponsor: true } }), 'Marked as not a sponsor')}>Employer is NOT on the register</button>
          </div>
          <div className="text-xs text-mute">A licence on the register shows the employer can sponsor in general; it does not mean this vacancy offers sponsorship.</div>
        </div>
      )}

      {tab === 'track' && <TrackerPanel id={id} app={app} events={d.applicationEvents} onSaved={() => { reload(); onChanged?.(); }} />}

      {tab === 'draft' && (
        <div className="space-y-3">
          <div className="h2">Recruiter questions</div>
          {d.recruiterQuestions.length ? d.recruiterQuestions.map((q: string, i: number) => (
            <div key={i} className="card p-2.5 text-sm flex gap-2"><div className="flex-1">{q}</div><button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(q)}><Copy size={12} />Copy</button></div>
          )) : <div className="text-mute text-sm">No open eligibility questions.</div>}
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={async () => setDraft((await api(`/api/drafts/${id}?kind=cover`)).text)}>Draft cover note from profile facts</button>
          </div>
          {draft && <textarea className="input h-56 font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} />}
          <div className="text-xs text-mute">Drafts are never sent automatically and use only facts from your profile.</div>
        </div>
      )}
    </Modal>
  );
}

function TrackerPanel({ id, app, events, onSaved }: { id: number; app: any; events: any[]; onSaved: () => void }) {
  const [f, setF] = React.useState<any>({ cv_version: app?.cv_version ?? '', cover_letter_version: app?.cover_letter_version ?? '', followup_at: app?.followup_at ?? '', interview_at: app?.interview_at ?? '', recruiter: app?.recruiter ?? '', notes: app?.notes ?? '', qa_notes: app?.qa_notes ?? '', tags: (app?.tags ?? []).join(', ') });
  const [msg, setMsg] = React.useState('');
  const save = async () => {
    try {
      await api(`/api/jobs/${id}/application`, { body: { ...f, tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean) } });
      setMsg('Saved'); onSaved();
    } catch (e: any) { setMsg(e.message); }
  };
  const stage = async (s: string) => {
    try {
      const confirmSubmitted = s === 'Applied' ? confirm('Confirm you actually submitted this application.') : undefined;
      if (s === 'Applied' && !confirmSubmitted) return;
      await api(`/api/jobs/${id}/stage`, { body: { stage: s, confirmSubmitted } }); onSaved();
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2"><span className="label">Stage</span>
        <select className="input w-56" value={app?.stage ?? ''} onChange={(e) => stage(e.target.value)}>
          <option value="" disabled>Not tracked</option>{STAGES.map((s) => <option key={s}>{s}</option>)}
        </select>
        {app?.applied_at && <span className="text-mute text-xs">Applied {fmtDate(app.applied_at)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[['cv_version', 'CV variant (e.g. Cyber/SOC, GRC, IT)'], ['cover_letter_version', 'Cover letter version'], ['recruiter', 'Recruiter / contact'], ['tags', 'Tags (off-cycle, high priority, university, ask recruiter about visa)']].map(([k, l]) => (
          <label key={k} className="block"><span className="label">{l}</span><input className="input mt-0.5" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
        ))}
        <label className="block"><span className="label">Follow-up date</span><input type="date" className="input mt-0.5" value={f.followup_at?.slice(0, 10) ?? ''} onChange={(e) => setF({ ...f, followup_at: e.target.value })} /></label>
        <label className="block"><span className="label">Interview date/time</span><input type="datetime-local" className="input mt-0.5" value={f.interview_at?.slice(0, 16) ?? ''} onChange={(e) => setF({ ...f, interview_at: e.target.value })} /></label>
      </div>
      <label className="block"><span className="label">Notes / interview notes</span><textarea className="input h-24 mt-0.5" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <label className="block"><span className="label">Application Q&amp;A</span><textarea className="input h-20 mt-0.5" value={f.qa_notes} onChange={(e) => setF({ ...f, qa_notes: e.target.value })} /></label>
      <div className="flex items-center gap-2"><button className="btn btn-primary" onClick={save}>Save tracker details</button><span className="text-accent text-xs">{msg}</span></div>
      {events?.length > 0 && <div><div className="h2 mb-1">History</div>{events.map((e) => <div key={e.id} className="text-xs text-mute">{fmtDateTime(e.at)} · {e.from_stage ?? '—'} → {e.to_stage}{e.note ? ` · ${e.note}` : ''}</div>)}</div>}
    </div>
  );
}
