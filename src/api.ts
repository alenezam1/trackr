// Thin client for the local API. No secrets live in the renderer: keys are written once and never read back.
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; raw?: string } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-SponsorFirst'] = '1';
  let body: string | undefined;
  if (opts.raw !== undefined) { headers['Content-Type'] = 'text/csv'; body = opts.raw; }
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(path, { method, headers, body });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Open an external link in the system browser (Electron intercepts window.open) with a scheme check. */
export function openExternal(url: string | null | undefined) {
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    window.open(u.toString(), '_blank', 'noopener,noreferrer');
  } catch { /* ignore invalid */ }
}

export function persisted<T>(key: string, fallback: T): [() => T, (v: T) => void] {
  return [
    () => { try { const v = localStorage.getItem('sf:' + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } },
    (v: T) => { try { localStorage.setItem('sf:' + key, JSON.stringify(v)); } catch { /* ignore */ } },
  ];
}

export const fmtDate = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not stated');
export const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
