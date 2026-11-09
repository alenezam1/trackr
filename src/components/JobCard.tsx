import React from 'react';
import { ExternalLink, FileSearch, Bookmark, ThumbsDown, Plus, Trash2 } from 'lucide-react';
import { api, openExternal, fmtDate } from '../api';

/** "LinkedIn", "Indeed", "Bayt"… from a posting URL. */
export function boardName(url?: string | null): string {
  try {
    const h = new URL(url ?? '').hostname.replace(/^www\./, '');
    const known: Record<string, string> = { linkedin: 'LinkedIn', indeed: 'Indeed', glassdoor: 'Glassdoor', bayt: 'Bayt', gulftalent: 'GulfTalent', naukrigulf: 'Naukrigulf', founditgulf: 'Foundit' };
    const k = Object.keys(known).find((x) => h.includes(x));
    return k ? known[k] : h;
  } catch { return 'job board'; }
}
import { Badge, CAT_LABEL, ClearanceBadge, SponsorBadge, StatusBadge, TYPE_LABEL, VisaBadge } from './ui';

export interface JobCardProps {
  job: any;
  onOpen: (id: number) => void;
  onChanged?: (msg?: string) => void;
  showAddToDaily?: boolean;
  compact?: boolean;
}

export function JobCard({ job, onOpen, onChanged, showAddToDaily }: JobCardProps) {
  const hasJd = !job.reasons?.some((r: any) => r.code === 'FULL_JD_NOT_READ');
  const blockers = (job.reasons ?? []).filter((r: any) => r.severity === 'hard_fail');
  const uncertain = (job.reasons ?? []).filter((r: any) => r.severity === 'uncertain');
  const months = job.facts?.programmeMonths ?? job.facts?.contractMonths;
  const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); onChanged?.(msg); } catch (e: any) { onChanged?.(e.message); } };
  const [removed, setRemoved] = React.useState(false);
  if (removed) return null;

  return (
    <div className="card p-3.5 hover:border-accent/40 transition-colors">
      <div className="flex flex-wrap items-center gap-1.5">
        {job.isDemo && <Badge tone="warn">DEMO</Badge>}
        <Badge tone="accent">{TYPE_LABEL[job.employmentType] ?? 'Type not stated'}</Badge>
        <Badge>{CAT_LABEL[job.category] ?? 'Not analysed'}</Badge>
        <StatusBadge status={job.status} />
        {job.applicationStage && <Badge tone="info">Tracker: {job.applicationStage}</Badge>}
        {job.fitInfo?.visaFriendly > 0 && <Badge tone="ok" title="Other adverts from this employer explicitly offered sponsorship or accepted Graduate visas">Visa-friendly employer</Badge>}
        {job.market && job.market !== 'UK' && <Badge tone="info">{({ UAE: '🇦🇪 UAE', QATAR: '🇶🇦 Qatar', SAUDI: '🇸🇦 Saudi' } as Record<string, string>)[job.market] ?? job.market}</Badge>}
        {job.targetRole && <Badge>{job.targetRole}</Badge>}
        {job.jdMethod === 'ai_web_read' && <Badge tone="warn" title="The app could not open this page itself; OpenAI web search opened it and quoted the key sentences.">Read by AI web search</Badge>}
        {job.postedAt && <Badge>Posted {fmtDate(job.postedAt)}</Badge>}
        {job.aiRank && <Badge tone={job.aiRank.overall >= 70 ? 'ok' : job.aiRank.overall >= 50 ? 'info' : 'warn'} title={job.aiRank.one_line_summary}>AI {job.aiRank.overall}/100 · {String(job.aiRank.recommendation).replace('_', ' ').toLowerCase()}</Badge>}
        <div className="ml-auto text-sm font-semibold text-accent">{job.fit != null ? `Fit ${job.fit}/100` : ''}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4">
        <button className="text-left text-[15px] font-semibold hover:text-accent" onClick={() => onOpen(job.id)}>{job.title}</button>
        <div className="text-mute">{job.employer ?? 'Employer not stated'}{job.legalEmployer && job.legalEmployer !== job.employer ? <span className="text-xs"> · legal: {job.legalEmployer}</span> : null}</div>
      </div>
      <div className="text-xs text-mute mt-1">
        {job.location ?? 'Location not stated'} · {job.facts?.isPaid === true ? (job.salaryText ?? 'Paid') : job.facts?.isPaid === false ? 'Unpaid' : 'Pay not stated'}
        {months ? ` · ${months} months` : ''} · {job.applyUrlKind === 'EMPLOYER_ATS' || job.applyUrlKind === 'EMPLOYER_SITE' ? 'Employer careers site' : job.applyUrlKind === 'BOARD' ? 'No employer careers page found — job-board posting' : 'No apply link'}
        {' · '}Source: {job.sourceId}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <SponsorBadge s={job.sponsor} />
        <VisaBadge m={job.matrix} />
        <ClearanceBadge f={job.facts} hasJd={hasJd} />
        <Badge>Experience: {job.facts?.requiredExperienceYears != null ? `${job.facts.requiredExperienceYears}y ${job.facts.experienceRequirement?.toLowerCase()}` : 'not stated'}</Badge>
        <Badge>Last checked: {fmtDate(job.lastCheckedAt)}</Badge>
        {job.deadline && <Badge tone="warn">Closes {fmtDate(job.deadline)}</Badge>}
      </div>
      {blockers.length > 0 && <div className="mt-2 text-xs text-bad">✕ {blockers.map((b: any) => b.message).slice(0, 2).join(' · ')}</div>}
      {uncertain.length > 0 && <div className="mt-1 text-xs text-warn">? {uncertain.map((b: any) => b.message).slice(0, 2).join(' · ')}</div>}
      {job.fitInfo?.whyItFits?.length > 0 && <div className="mt-1 text-xs text-mute">Why it fits: {job.fitInfo.whyItFits.slice(0, 2).join(' ')}</div>}
      {job.aiRank && (
        <div className="mt-1 text-xs">
          {job.aiRank.strengths?.length > 0 && <div className="text-ok">AI strengths: {job.aiRank.strengths.slice(0, 2).join('; ')}</div>}
          {job.aiRank.gaps?.length > 0 && <div className="text-warn">AI gaps: {job.aiRank.gaps.slice(0, 2).join('; ')}</div>}
          {job.aiRank.deal_breakers?.length > 0 && <div className="text-bad">AI deal-breaker: {job.aiRank.deal_breakers[0].issue} — “{job.aiRank.deal_breakers[0].quote}”</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-3">
        <button className="btn btn-sm" onClick={() => onOpen(job.id)}><FileSearch size={13} />Read JD &amp; Evidence</button>
        <button className="btn btn-sm btn-primary" disabled={!job.applyUrl} onClick={() => openExternal(job.applyUrl)} title="Opens in your browser. Does not mark the job as applied."><ExternalLink size={13} />{job.applyUrlKind === 'BOARD' ? `Open posting on ${boardName(job.applyUrl)}` : 'Apply on careers site'}</button>
        <button className="btn btn-sm" onClick={() => act(() => api(`/api/jobs/${job.id}/stage`, { body: { stage: 'Shortlisted' } }), 'Saved to tracker (Shortlisted)')}><Bookmark size={13} />Save</button>
        {showAddToDaily && ['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER'].includes(job.status) && (
          <button className="btn btn-sm" onClick={() => act(() => api('/api/daily/add', { body: { jobId: job.id, note: 'Added from Search' } }), "Added to today's queue")}><Plus size={13} />Add to Daily 15</button>
        )}
        <button className="btn btn-sm" onClick={() => act(() => api(`/api/jobs/${job.id}/feedback`, { body: { notInterested: true } }), 'Marked not interested')}><ThumbsDown size={13} />Not interested</button>
        <button className="btn btn-sm text-bad ml-auto" title="Deletes this job everywhere (dashboard, sections, Daily 15, tracker). Later scans will not add it again."
          onClick={() => { if (confirm(`Remove "${job.title}" for good? It will be deleted and future scans will skip it.`)) act(async () => { await api(`/api/jobs/${job.id}/remove`, { body: {} }); setRemoved(true); }, 'Job removed'); }}><Trash2 size={13} />Remove</button>
      </div>
    </div>
  );
}
