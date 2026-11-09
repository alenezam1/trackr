// In-app weekday scheduler (spec §17). Runs only while the app is open — it never claims to search
// while closed. Missed runs are shown and optionally caught up on start.
import { getDb } from '../../db/db.js';
import { getSettings } from '../../config/settings.js';
import { isWeekdayLondon, todayLondon } from '../util/text.js';
import { currentRun, startScan } from './scan.js';

let timer: NodeJS.Timeout | null = null;
export let lastSchedulerNote = '';

function londonHM(d = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function scheduleStatus() {
  const s = getSettings();
  const today = todayLondon();
  const ranToday = getDb().get<any>("SELECT id, started_at, status FROM search_runs WHERE mode = 'SCHEDULED' AND substr(started_at, 1, 10) >= ? ORDER BY id DESC LIMIT 1", today);
  const due = s.schedule_enabled && isWeekdayLondon() && londonHM() >= s.schedule_time_london;
  return {
    enabled: s.schedule_enabled, time: s.schedule_time_london, timezone: 'Europe/London', weekdaysOnly: true,
    ranToday: !!ranToday, todayRun: ranToday ?? null,
    missedToday: due && !ranToday && !s.schedule_catch_up,
    note: 'Scheduled scans run only while SponsorFirst is open. Nothing runs when the app is closed or the computer sleeps.',
    lastNote: lastSchedulerNote,
  };
}

function tick() {
  try {
    const s = getSettings();
    if (!s.schedule_enabled || !isWeekdayLondon() || currentRun()) return;
    const st = scheduleStatus();
    if (st.ranToday) return;
    const hm = londonHM();
    if (hm < s.schedule_time_london) return;
    // Within 10 minutes of the scheduled time, or later with catch-up enabled.
    const [h, m] = s.schedule_time_london.split(':').map(Number);
    const [ch, cm] = hm.split(':').map(Number);
    const late = ch * 60 + cm - (h * 60 + m);
    if (late > 10 && !s.schedule_catch_up) { lastSchedulerNote = `Missed today's ${s.schedule_time_london} scan (app was closed). Catch-up is off.`; return; }
    const id = startScan({ mode: 'SCHEDULED' });
    lastSchedulerNote = `Started scheduled scan #${id} at ${hm} London time${late > 10 ? ' (catch-up)' : ''}.`;
  } catch (e) {
    lastSchedulerNote = `Scheduler error: ${(e as Error).message}`;
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, 60_000);
  setTimeout(tick, 15_000);
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
