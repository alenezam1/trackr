// Daily 15 selection (spec §13.2). Never invents roles, never relaxes rules to fill the quota,
// never includes EXCLUDED/STALE jobs, and records every manual change.
import { getDb, j, type Db } from '../../db/db.js';
import { getProfile, getSettings } from '../../config/settings.js';
import { todayLondon } from '../util/text.js';
import { priorityBucket } from './score.js';

const DONE_STAGES = ['Applied', 'Assessment', 'Recruiter Screen', 'Interview', 'Offer', 'Rejected', 'Withdrawn', 'Closed / Expired', 'Archived'];

export interface DailySummary {
  date: string; targetCyber: number; targetIt: number; cyberSelected: number; itSelected: number;
  verified: number; potential: number; total: number; shortfall: number; message: string; alternateMix: string | null;
}

function slotOf(category: string | null): 'CYBER_GRC' | 'IT' | null {
  if (category === 'SOC_SECURITY' || category === 'GRC_RISK_AUDIT') return 'CYBER_GRC';
  if (category === 'IT_TECHNICAL') return 'IT';
  return null;
}

function closingSoon(r: any): boolean {
  if (!r.deadline_at) return false;
  const days = (Date.parse(r.deadline_at) - Date.parse(todayLondon())) / 86400000;
  return days >= 0 && days <= 7;
}

function eligibleCandidates(db: Db, batchId: number, statuses: string[]) {
  const s = getSettings();
  const markets = s.daily_markets.length ? s.daily_markets : ['UK'];
  // Only postings inside your date window (older ones are not shown anywhere else either).
  const cutoff = new Date(Date.now() - s.max_posting_age_days * 86400000).toISOString().slice(0, 10);
  const rows = db.all<any>(`
    SELECT j.*, d.reasons_json FROM jobs j
    JOIN job_decisions d ON d.job_id = j.id AND d.active = 1
    WHERE j.current_status IN (${statuses.map(() => '?').join(',')})
      AND j.is_demo = 0 AND j.user_hidden = 0 AND j.listing_state = 'OPEN' AND j.apply_url IS NOT NULL
      AND j.market IN (${markets.map(() => '?').join(',')})
      AND (j.posted_at IS NULL OR substr(j.posted_at, 1, 10) >= ?)
      AND j.id NOT IN (SELECT job_id FROM applications WHERE stage IN (${DONE_STAGES.map(() => '?').join(',')}))
      AND j.id NOT IN (SELECT job_id FROM user_feedback WHERE not_interested = 1)
      AND j.id NOT IN (SELECT job_id FROM daily_batch_jobs WHERE batch_id = ?)`,
    ...statuses, ...markets, cutoff, ...DONE_STAGES, batchId);
  return rows.map((r) => {
    const facts = j<any>(r.reasons_json, {}).facts ?? {};
    return { ...r, bucket: priorityBucket(r.employment_type, facts.contractMonths ?? null), slot: slotOf(r.category) };
  }).filter((r) => r.slot)
    .filter((r) => {
      const focus = getSettings().role_focus;
      const intern = r.employment_type === 'INTERNSHIP' || r.employment_type === 'OFF_CYCLE_INTERNSHIP';
      return focus === 'BOTH' || (focus === 'INTERNSHIP' ? intern : !intern);
    })
    .sort((a, b) =>
      // Deadline radar: roles closing within 7 days jump ahead within the same eligibility tier.
      (closingSoon(a) ? 0 : 1) - (closingSoon(b) ? 0 : 1)
      || a.bucket - b.bucket
      || (a.current_status === 'VERIFIED_COMPATIBLE' ? 0 : 1) - (b.current_status === 'VERIFIED_COMPATIBLE' ? 0 : 1)
      || (a.presented_count ?? 0) - (b.presented_count ?? 0)
      || (b.current_fit ?? 0) - (a.current_fit ?? 0)
      || String(b.first_seen_at).localeCompare(String(a.first_seen_at)));
}

export function getOrCreateBatch(date = todayLondon(), db: Db = getDb()) {
  let b = db.get<any>('SELECT * FROM daily_batches WHERE date_london = ?', date);
  if (!b) {
    const { version, profile } = getProfile();
    db.run('INSERT INTO daily_batches(date_london, user_profile_version, created_at, target_cyber, target_it) VALUES (?, ?, ?, ?, ?)',
      date, version, new Date().toISOString(), profile.daily_quota.cyber_grc, profile.daily_quota.it_technical);
    b = db.get<any>('SELECT * FROM daily_batches WHERE date_london = ?', date);
  }
  return b;
}

/** A "Needs review" job is only used to fill a slot if it still looks entry level: an entry word or analyst role in the
 *  title, the AI read it as entry/junior, or its stated experience is within your maximum. */
function looksEntryLevel(c: { title: string; reasons_json?: string | null }): boolean {
  const facts = j<any>(c.reasons_json ?? null, {}).facts ?? {};
  if (facts.isSeniorTitle || /\b(staff|senior|lead|principal|head|manager|architect)\b/i.test(c.title)) return false;
  if (facts.requiredExperienceYears != null) return facts.requiredExperienceYears <= (getProfile().profile.max_required_relevant_experience_years ?? 2);
  return /\b(graduate|intern(ship)?|junior|entry|trainee|apprentice|placement|associate|analyst|assistant|year in industry)\b/i.test(c.title)
    || ['ENTRY', 'INTERN', 'GRADUATE', 'JUNIOR'].includes(facts.aiSeniority);
}

/** Fill open slots in today's batch. Existing selections are kept (no silent reshuffle). */
export function buildDailyBatch(date = todayLondon(), opts: { alternateMix?: boolean } = {}, db: Db = getDb()): DailySummary {
  const s = getSettings();
  const batch = getOrCreateBatch(date, db);
  const current = db.all<any>('SELECT * FROM daily_batch_jobs WHERE batch_id = ? AND removed_at IS NULL', batch.id);
  // Drop selections that have since become ineligible (closed/excluded) — visibly, with a note.
  const keepStatuses = ['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER', ...(s.daily_fill_with_review ? ['NEEDS_REVIEW'] : [])];
  for (const c of current) {
    const job = db.get<any>('SELECT j.title, j.current_status, j.listing_state, d.reasons_json FROM jobs j LEFT JOIN job_decisions d ON d.job_id = j.id AND d.active = 1 WHERE j.id = ?', c.job_id);
    const weakReview = job?.current_status === 'NEEDS_REVIEW' && c.added_by === 'AUTO' && !looksEntryLevel(job);
    if (!job || !keepStatuses.includes(job.current_status) || job.listing_state !== 'OPEN' || weakReview) {
      db.run('UPDATE daily_batch_jobs SET removed_at = ?, note = ? WHERE id = ?', new Date().toISOString(),
        weakReview ? 'Removed automatically: "Needs review" and not clearly entry level' : `Removed automatically: now ${job?.current_status ?? 'missing'}`, c.id);
    }
  }
  const active = db.all<any>('SELECT dbj.*, j.advertised_employer FROM daily_batch_jobs dbj JOIN jobs j ON j.id = dbj.job_id WHERE batch_id = ? AND removed_at IS NULL', batch.id);
  const count = { CYBER_GRC: active.filter((a) => a.category_slot === 'CYBER_GRC').length, IT: active.filter((a) => a.category_slot === 'IT').length };
  const target = { CYBER_GRC: batch.target_cyber as number, IT: batch.target_it as number };
  const perEmployer = new Map<string, number>();
  for (const a of active) perEmployer.set(a.advertised_employer ?? '', (perEmployer.get(a.advertised_employer ?? '') ?? 0) + 1);

  const cands = eligibleCandidates(db, batch.id, s.daily_include_potential ? ['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER'] : ['VERIFIED_COMPATIBLE']);
  let rank = active.length;
  const t = new Date().toISOString();
  const pick = (c: any, slot: 'CYBER_GRC' | 'IT', note: string | null) => {
    db.run(`INSERT OR IGNORE INTO daily_batch_jobs(batch_id, job_id, category_slot, rank, eligibility_label, selected_at, added_by, note) VALUES (?, ?, ?, ?, ?, ?, 'AUTO', ?)`,
      batch.id, c.id, slot, ++rank, c.current_status, t, note);
    db.run('UPDATE jobs SET presented_count = presented_count + 1 WHERE id = ?', c.id);
    count[slot]++;
    perEmployer.set(c.advertised_employer ?? '', (perEmployer.get(c.advertised_employer ?? '') ?? 0) + 1);
  };
  const used = new Set<number>();
  for (const pass of [2, 4]) { // diversity: at most 2 per employer, relaxed to 4 only if slots remain
    for (const c of cands) {
      if (used.has(c.id)) continue;
      const slot = c.slot as 'CYBER_GRC' | 'IT';
      if (count[slot] >= target[slot]) continue;
      if ((perEmployer.get(c.advertised_employer ?? '') ?? 0) >= pass) continue;
      pick(c, slot, null); used.add(c.id);
    }
  }
  // Still short? Fill remaining slots with the best "Needs review" jobs (no hard blocker, but something to check) — labelled.
  if (s.daily_fill_with_review && (count.CYBER_GRC < target.CYBER_GRC || count.IT < target.IT)) {
    const review = eligibleCandidates(db, batch.id, ['NEEDS_REVIEW']).filter((c) => !used.has(c.id) && looksEntryLevel(c));
    for (const c of review) {
      const slot = c.slot as 'CYBER_GRC' | 'IT';
      if (count[slot] >= target[slot]) continue;
      if ((perEmployer.get(c.advertised_employer ?? '') ?? 0) >= 2) continue;
      pick(c, slot, 'Needs review — no blocker found, but check the flagged point before applying'); used.add(c.id);
    }
  }
  let alternate: string | null = j<any>(batch.summary_json, {}).alternateMix ?? null;
  if (opts.alternateMix) {
    const total = target.CYBER_GRC + target.IT;
    for (const c of cands) {
      if (used.has(c.id)) continue;
      if (count.CYBER_GRC + count.IT >= total) break;
      const slot = c.slot as 'CYBER_GRC' | 'IT';
      pick(c, slot, 'Alternate mix accepted by user'); used.add(c.id);
    }
    alternate = `User accepted an alternate mix on ${t.slice(0, 16)}: ${count.CYBER_GRC} cyber/GRC + ${count.IT} IT (default ${target.CYBER_GRC}+${target.IT}).`;
  }
  const summary = summarise(batch.id, date, db, alternate);
  db.run('UPDATE daily_batches SET summary_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(summary), t, batch.id);
  return summary;
}

export function summarise(batchId: number, date: string, db: Db = getDb(), alternate: string | null = null): DailySummary {
  const b = db.get<any>('SELECT * FROM daily_batches WHERE id = ?', batchId);
  const rows = db.all<any>('SELECT dbj.*, j.current_status FROM daily_batch_jobs dbj JOIN jobs j ON j.id = dbj.job_id WHERE batch_id = ? AND removed_at IS NULL', batchId);
  const verified = rows.filter((r) => r.current_status === 'VERIFIED_COMPATIBLE').length;
  const potential = rows.filter((r) => r.current_status === 'POTENTIAL_NO_STATED_BLOCKER').length;
  const review = rows.filter((r) => r.current_status === 'NEEDS_REVIEW').length;
  const total = rows.length;
  const goal = b.target_cyber + b.target_it;
  const shortfall = Math.max(0, goal - total);
  const cyber = rows.filter((r) => r.category_slot === 'CYBER_GRC').length;
  const it = rows.filter((r) => r.category_slot === 'IT').length;
  const focus = getSettings().role_focus;
  const message = `${verified} Verified + ${potential} Eligible${review ? ` + ${review} Needs review` : ''} = ${total} of ${goal}`
    + (shortfall ? `; ${shortfall} slot(s) empty — run a scan to find more` : '')
    + (shortfall && focus !== 'BOTH' ? ` (your toggle shows ${focus === 'INTERNSHIP' ? 'internships only' : 'graduate/entry jobs only'} — "Both" gives more)` : '');
  return { date, targetCyber: b.target_cyber, targetIt: b.target_it, cyberSelected: cyber, itSelected: it, verified, potential, total, shortfall, message, alternateMix: alternate ?? j<any>(b.summary_json, {}).alternateMix ?? null };
}

export function addToBatch(jobId: number, note: string | null, replaceJobId: number | null, date = todayLondon(), db: Db = getDb()) {
  const job = db.get<any>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Job not found');
  if (!['VERIFIED_COMPATIBLE', 'POTENTIAL_NO_STATED_BLOCKER', 'NEEDS_REVIEW'].includes(job.current_status)) throw new Error('Only Eligible or Needs-review jobs can be added to the Daily 15. Excluded jobs never can.');
  const slot = slotOf(job.category);
  if (!slot) throw new Error('Job category is outside the Daily 15 slots.');
  const batch = getOrCreateBatch(date, db);
  const t = new Date().toISOString();
  db.tx(() => {
    if (replaceJobId) db.run('UPDATE daily_batch_jobs SET removed_at = ?, note = ? WHERE batch_id = ? AND job_id = ?', t, `Replaced by job ${jobId}: ${note ?? ''}`, batch.id, replaceJobId);
    const max = db.get<any>('SELECT COALESCE(MAX(rank), 0) AS m FROM daily_batch_jobs WHERE batch_id = ?', batch.id)?.m ?? 0;
    db.run(`INSERT INTO daily_batch_jobs(batch_id, job_id, category_slot, rank, eligibility_label, selected_at, added_by, note) VALUES (?, ?, ?, ?, ?, ?, 'USER', ?)
            ON CONFLICT(batch_id, job_id) DO UPDATE SET removed_at = NULL, added_by = 'USER', note = excluded.note`, batch.id, jobId, slot, max + 1, job.current_status, t, note ?? 'Added from Search');
  });
  return summarise(batch.id, date, db);
}

export function removeFromBatch(jobId: number, note: string | null, date = todayLondon(), db: Db = getDb()) {
  const batch = getOrCreateBatch(date, db);
  db.run('UPDATE daily_batch_jobs SET removed_at = ?, note = ? WHERE batch_id = ? AND job_id = ?', new Date().toISOString(), note ?? 'Removed by user', batch.id, jobId);
  return summarise(batch.id, date, db);
}
