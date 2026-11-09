import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

export function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

export function collapseWs(s: string): string {
  return s.replace(/[\s ]+/g, ' ').trim();
}

/** Normalise text for evidence comparison: whitespace + quote styles + case. */
export function normForCompare(s: string): string {
  return collapseWs(s)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase();
}

function normChar(ch: string): string {
  if (/[‘’‛′]/.test(ch)) return "'";
  if (/[“”″]/.test(ch)) return '"';
  if (/[–—]/.test(ch)) return '-';
  const l = ch.toLowerCase();
  return l.length === 1 ? l : ch;
}

/** Convert untrusted HTML to readable plain text, preserving block boundaries. Scripts/styles are dropped. */
export function htmlToText(html: string): string {
  if (!html) return '';
  // Greenhouse returns entity-encoded HTML; decode once if it looks encoded.
  let src = html;
  if (/&lt;\/?[a-z]/i.test(src) && !/<\/?[a-z]/i.test(src.slice(0, 200))) {
    src = cheerio.load(`<textarea>${src}</textarea>`)('textarea').text();
  }
  const $ = cheerio.load(src);
  $('script, style, noscript, iframe, svg, form, nav, footer, header, button').remove();
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, ul, ol').each((_, el) => {
    $(el).prepend('\n');
    $(el).append('\n');
  });
  $('li').each((_, el) => { $(el).prepend('• '); });
  const text = $.root().text();
  return text
    .split('\n')
    .map((l) => l.replace(/[\t  ]+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface Sentence { text: string; start: number; end: number; }

/** Split text into sentences/bullets with offsets into the original string. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^\n.!?;]+(?:[.!?;]+|$|(?=\n))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    if (!raw.trim()) { if (re.lastIndex === m.index) re.lastIndex++; continue; }
    const lead = raw.length - raw.trimStart().length;
    const s = raw.trim();
    out.push({ text: s, start: m.index + lead, end: m.index + lead + s.length });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  // Re-join fragments split on abbreviations like "e.g." / "approx." when very short.
  return out;
}

/** Locate an excerpt inside a document allowing whitespace/quote normalisation. Returns offsets or null. */
export function locateExcerpt(doc: string, excerpt: string): { start: number; end: number } | null {
  if (!excerpt || excerpt.trim().length < 3) return null;
  const direct = doc.indexOf(excerpt);
  if (direct >= 0) return { start: direct, end: direct + excerpt.length };
  // Build normalised doc with index map back to original offsets.
  const map: number[] = [];
  let norm = '';
  let prevSpace = false;
  for (let i = 0; i < doc.length; i++) {
    const ch = doc[i];
    if (/[\s ]/.test(ch)) {
      if (prevSpace) continue;
      prevSpace = true;
      norm += ' ';
    } else {
      prevSpace = false;
      norm += normChar(ch);
    }
    map.push(i);
  }
  const target = normForCompare(excerpt);
  const idx = norm.indexOf(target);
  if (idx < 0) return null;
  return { start: map[idx], end: map[Math.min(idx + target.length - 1, map.length - 1)] + 1 };
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, eighteen: 18, twenty: 20, 'twenty-four': 24,
};
export function parseNum(s: string): number | null {
  const t = s.toLowerCase().trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return WORD_NUM[t] ?? null;
}
export const NUM_WORD_RE = '(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty-four|twenty)';

export function todayLondon(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function isWeekdayLondon(d = new Date()): boolean {
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(d);
  return !['Sat', 'Sun'].includes(wd);
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + Math.trunc(months));
  if (d.getUTCDate() < day) d.setUTCDate(0);
  const extraDays = Math.round((months % 1) * 30);
  if (extraDays) d.setUTCDate(d.getUTCDate() + extraDays);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** "3 days ago", "a month ago", "30+ days ago", "Just posted", ISO dates → ISO date (YYYY-MM-DD) or null. */
export function parsePostedDate(s: string | null | undefined, now = new Date()): string | null {
  const d = parsePostedDateRaw(s, now);
  // A posting can't be from the future (mis-read day/month order, year guessed by the parser).
  return d && d > new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10) ? null : d;
}
function parsePostedDateRaw(s: string | null | undefined, now: Date): string | null {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{10,13}$/.test(t)) return new Date(Number(t) * (t.length === 10 ? 1000 : 1)).toISOString().slice(0, 10);
  if (/just posted|today|hours? ago|minutes? ago|new\b/.test(t)) return now.toISOString().slice(0, 10);
  if (/yesterday/.test(t)) return new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const m = t.match(/(\d+|an?|one)\+?\s*(day|week|month|year)s?\s*ago/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
    const days = m[2] === 'day' ? n : m[2] === 'week' ? n * 7 : m[2] === 'month' ? n * 30 : n * 365;
    return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  }
  const d = Date.parse(s);
  return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null;
}

export function isSafeHttpUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch { return false; }
}
