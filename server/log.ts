// Structured local JSON logs (no secrets, no CV excerpts).
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db/db.js';
import { redact } from './config/secrets.js';

export function log(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}) {
  try {
    const dir = path.join(dataDir(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const line = redact(JSON.stringify({ at: new Date().toISOString(), level, event, ...data }));
    fs.appendFileSync(path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), line + '\n');
  } catch { /* logging must never crash the app */ }
}
