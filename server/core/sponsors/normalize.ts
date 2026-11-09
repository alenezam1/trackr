// Comparison forms for sponsor names. Legal names are never overwritten; these keys are lookup aids only.

const SUFFIX_STOP = new Set([
  'limited', 'ltd', 'plc', 'llp', 'lp', 'llc', 'inc', 'incorporated', 'corporation', 'corp', 'company', 'co',
  'the', 'uk', 'gb', 'group', 'holdings', 'holding',
]);

export function baseNorm(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact comparison key: case/whitespace/punctuation-insensitive; "Ltd" == "Limited". */
export function exactKey(name: string): string {
  return baseNorm(name)
    .split(' ')
    .map((t) => (t === 'ltd' ? 'limited' : t))
    .join(' ');
}

/** Core key: drops parentheticals and legal-form / generic suffix words. Only used to PROPOSE candidates. */
export function coreKey(name: string): string {
  const noParen = name.replace(/\([^)]*\)/g, ' ');
  const toks = baseNorm(noParen).split(' ').filter((t) => t && !SUFFIX_STOP.has(t));
  return toks.join(' ');
}

/** "Roofoods Ltd t/a Deliveroo" -> { legal: 'Roofoods Ltd', trading: 'Deliveroo' } */
export function splitTradingAs(name: string): { legal: string; trading: string | null } {
  const m = name.match(/^(.*?)\s+(?:t\/a|t\.a\.|trading as)\s+(.+)$/i);
  if (m && m[1].trim() && m[2].trim()) return { legal: m[1].trim(), trading: m[2].trim() };
  return { legal: name.trim(), trading: null };
}

export function parseRating(typeRating: string): string {
  const m = typeRating.match(/\(\s*([AB])\b/i) ?? typeRating.match(/\b([AB])[- ]?rat/i);
  if (m) return m[1].toUpperCase();
  if (/provisional/i.test(typeRating)) return 'PROVISIONAL';
  return typeRating.trim() || 'UNKNOWN';
}

/** Names that indicate a recruiter / staffing intermediary rather than the actual employer. */
export function looksLikeAgency(name: string): boolean {
  return /\b(recruit(ment|ing|ers)?|staffing|resourcing|talent( solutions| partners)?|personnel|headhunt|search partners|executive search|contracting solutions)\b/i.test(name);
}
