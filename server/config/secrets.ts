// API keys are encrypted at rest with Windows DPAPI (CurrentUser scope) through PowerShell's
// ProtectedData API. Keys never leave the server process: the UI only sees "configured: true/false".
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../db/db.js';

const FILE = () => path.join(dataDir(), 'secrets.json');
const cache = new Map<string, string>();

export type SecretName = 'openai_api_key' | 'reed_api_key' | 'adzuna_app_id' | 'adzuna_app_key' | 'jooble_api_key'
  | 'dataforseo_login' | 'dataforseo_password' | 'jina_api_key' | 'exa_api_key' | 'serpapi_api_key';
export const SECRET_NAMES: SecretName[] = ['openai_api_key', 'dataforseo_login', 'dataforseo_password', 'jina_api_key', 'serpapi_api_key', 'exa_api_key', 'reed_api_key', 'adzuna_app_id', 'adzuna_app_key', 'jooble_api_key'];

function readStore(): Record<string, { alg: string; data: string }> {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return {}; }
}
function writeStore(s: Record<string, { alg: string; data: string }>) {
  fs.writeFileSync(FILE(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

function ps(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) reject(new Error('DPAPI call failed')); else resolve(stdout.trim());
    });
    child.stdin?.end(input);
  });
}

const PROTECT = "Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($in); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const UNPROTECT = "Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($in); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";

export async function setSecret(name: SecretName, value: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Encrypted secret storage is implemented for Windows (DPAPI) only.');
  const data = await ps(PROTECT, value);
  const s = readStore();
  s[name] = { alg: 'dpapi-currentuser', data };
  writeStore(s);
  cache.set(name, value);
}

export async function getSecret(name: SecretName): Promise<string | null> {
  if (cache.has(name)) return cache.get(name)!;
  const s = readStore()[name];
  if (!s) return null;
  try {
    const v = await ps(UNPROTECT, s.data);
    cache.set(name, v);
    return v;
  } catch { return null; }
}

export function hasSecret(name: SecretName): boolean {
  return cache.has(name) || !!readStore()[name];
}

export function deleteSecret(name: SecretName) {
  const s = readStore();
  delete s[name];
  writeStore(s);
  cache.delete(name);
}

/** Remove any configured secret value from an arbitrary string before it is logged or stored. */
export function redact(text: string): string {
  let out = text;
  for (const v of cache.values()) if (v && v.length > 6) out = out.split(v).join('[REDACTED]');
  return out.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]');
}
