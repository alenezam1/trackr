// SQLite access via Node's built-in `node:sqlite` (no native build step on Windows). See docs/DECISIONS.md.
import type { DatabaseSync as DatabaseSyncT, StatementSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MIGRATIONS } from './migrations.js';

// Loaded via require so bundlers/test runners don't strip the "node:" prefix.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export type Row = Record<string, any>;

export function dataDir(): string {
  const base = process.env.TRACKR_DATA_DIR
    ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'SponsorFirst');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export class Db {
  readonly raw: DatabaseSyncT;
  private cache = new Map<string, StatementSync>();

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all<T = Row>(sql: string, ...params: any[]): T[] { return this.stmt(sql).all(...params.map(clean)) as T[]; }
  get<T = Row>(sql: string, ...params: any[]): T | undefined { return this.stmt(sql).get(...params.map(clean)) as T | undefined; }
  run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params.map(clean));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  exec(sql: string): void { this.raw.exec(sql); }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  migrate(backupDir?: string): number {
    this.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const done = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    const pending = MIGRATIONS.filter((m) => !done.has(m.version));
    if (pending.length && done.size && backupDir) this.backup(path.join(backupDir, `pre-migration-${Date.now()}.sqlite`));
    for (const m of pending) {
      this.tx(() => {
        this.exec(m.sql);
        this.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', m.version, new Date().toISOString());
      });
    }
    return pending.length;
  }

  backup(dest: string): string {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest);
    this.raw.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    return dest;
  }

  close() { this.raw.close(); }
}

function clean(v: any): any {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

let singleton: Db | null = null;
export function getDb(): Db {
  if (!singleton) {
    const dir = dataDir();
    singleton = new Db(path.join(dir, 'trackr.sqlite'));
    singleton.migrate(path.join(dir, 'backups'));
  }
  return singleton;
}
export function setDbForTests(db: Db | null) { singleton = db; }

export function j<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
