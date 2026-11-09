// Shared OpenAI calls (server-side only; the key never reaches the UI). Every call is budget-checked and logged.
import { getSecret, redact } from '../../config/secrets.js';
import { getSettings } from '../../config/settings.js';
import { getDb } from '../../db/db.js';
import { spentTodayUsd } from './openai.js';

export interface AiCallResult<T> { ok: boolean; data?: T; error?: string; costUsd?: number }

function logCost(task: string, inTok: number, outTok: number, extraUsd = 0) {
  const s = getSettings();
  const cost = (inTok * s.ai_price_input_per_m + outTok * s.ai_price_output_per_m) / 1_000_000 + extraUsd;
  getDb().run('INSERT INTO api_cost_ledger(at, model, task_name, tokens_input, tokens_output, estimated_cost) VALUES (?, ?, ?, ?, ?, ?)',
    new Date().toISOString(), s.openai_model, task, inTok, outTok, cost);
  return cost;
}

async function preflight(): Promise<{ key: string } | { error: string }> {
  const s = getSettings();
  if (!s.ai_enabled) return { error: 'AI is switched off (Settings → OpenAI).' };
  const key = await getSecret('openai_api_key');
  if (!key) return { error: 'No OpenAI API key saved.' };
  if (spentTodayUsd() >= s.ai_daily_budget_usd) return { error: `Daily AI budget of $${s.ai_daily_budget_usd} reached.` };
  return { key };
}

/** Chat Completions with strict JSON-schema output. */
export async function chatJson<T>(task: string, system: string, user: string, schema: object, name: string): Promise<AiCallResult<T>> {
  const pf = await preflight();
  if ('error' in pf) return { ok: false, error: pf.error };
  const s = getSettings();
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${pf.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.openai_model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } }),
    });
    if (!res.ok) return { ok: false, error: `OpenAI HTTP ${res.status}` };
    const b: any = await res.json();
    const cost = logCost(task, b.usage?.prompt_tokens ?? 0, b.usage?.completion_tokens ?? 0);
    return { ok: true, data: JSON.parse(b.choices?.[0]?.message?.content ?? 'null') as T, costUsd: cost };
  } catch (e) { return { ok: false, error: redact((e as Error).message) }; }
}

/** Responses API with the built-in web search tool + strict JSON output. Falls back to the preview tool name. */
export async function webSearchJson<T>(task: string, instructions: string, input: string, schema: object, name: string): Promise<AiCallResult<T>> {
  const pf = await preflight();
  if ('error' in pf) return { ok: false, error: pf.error };
  const s = getSettings();
  for (const tool of ['web_search', 'web_search_preview']) {
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${pf.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.openai_model, instructions, input, tools: [{ type: tool }], max_output_tokens: 16000,
          text: { format: { type: 'json_schema', name, strict: true, schema } },
        }),
      });
      if (res.status === 400 && tool === 'web_search') continue; // older accounts/models only know the preview tool
      if (!res.ok) return { ok: false, error: `OpenAI HTTP ${res.status}` };
      const b: any = await res.json();
      const text = b.output_text ?? (b.output ?? []).flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('');
      const searches = (b.output ?? []).filter((o: any) => /web_search/.test(o.type ?? '')).length;
      const cost = logCost(task, b.usage?.input_tokens ?? 0, b.usage?.output_tokens ?? 0, searches * 0.025);
      return { ok: true, data: parseLenient<T>(text), costUsd: cost };
    } catch (e) { return { ok: false, error: redact((e as Error).message) }; }
  }
  return { ok: false, error: 'Web search tool not available for this model/account.' };
}

/** Parse JSON; if the model's output was cut off mid-array, keep every complete item. */
export function parseLenient<T>(text: string): T {
  try { return JSON.parse(text || 'null') as T; } catch { /* try to salvage */ }
  const lastObj = text.lastIndexOf('},');
  if (lastObj > 0) {
    const opens = (text.slice(0, lastObj).match(/\[/g) ?? []).length - (text.slice(0, lastObj).match(/\]/g) ?? []).length;
    const braces = (text.slice(0, lastObj + 1).match(/\{/g) ?? []).length - (text.slice(0, lastObj + 1).match(/\}/g) ?? []).length;
    const fixed = text.slice(0, lastObj + 1) + ']'.repeat(Math.max(0, opens)) + '}'.repeat(Math.max(0, braces));
    try { return JSON.parse(fixed) as T; } catch { /* fall through */ }
  }
  throw new Error('AI response was not valid JSON');
}
