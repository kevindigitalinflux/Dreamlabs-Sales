import type { GeminiMeterClient, GeminiSearchContext } from './geminiSearchMeter.ts';

/** Use the existing service secret only on the server; never expose RPC errors or credentials. */
export function geminiService(): GeminiMeterClient {
  return { async rpc(name, args) {
    try {
      const env = (globalThis as unknown as { Deno?: { env: { get(name: string): string | undefined } } }).Deno?.env;
      const url = env?.get('SUPABASE_URL'), key = env?.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key) return { error: true };
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(5000) });
      return response.ok ? { data: await response.json() } : { error: true };
    } catch { console.error('gemini_admission_unavailable'); return { error: true }; }
  } };
}

/** Shared database admission precedes every Gemini HTTP request, including ungrounded JSON calls. */
export async function admitGemini(context?: GeminiSearchContext): Promise<void> {
  const refused = await readGeminiRefusal(context);
  if (refused) { context?.onRefused?.(refused); throw new Error('Gemini '+refused+': refused'); }
  let result;
  try { result = await (context?.service ?? geminiService()).rpc('gemini_admit', {}); }
  catch { console.error('gemini_admission_unavailable'); throw new Error('Gemini 429: busy'); }
  if (result.error || result.data !== true) throw new Error('Gemini 429: busy');
}

/** A notice claim is atomic across leads and invocations. Failed reads do not repeat notices. */
export async function claimRunNotice(service: GeminiMeterClient, runId: string, code: string): Promise<boolean> {
  try {
    const result = await service.rpc('deep_find_notice_once', { p_run: runId, p_code: code });
    if (result.error) console.error('deep_find_notice_unavailable');
    return !result.error && result.data === true;
  } catch { console.error('deep_find_notice_unavailable'); return false; }
}

/** Fixed copy shared by each lead and the single run warning. */
export function geminiRefusalLine(status: unknown): string | null {
  return [401,402,403].includes(status as number) ? 'Web search and role search skipped: Gemini refused the key (error '+status+'). Check the Gemini billing or key.' : null;
}
/** Read before every call; a database failure refuses admission rather than bypassing the flag. */
export async function readGeminiRefusal(context?: GeminiSearchContext): Promise<number | null> {
  if (!context?.runId) return null;
  try {
    const result = await context.service.rpc('gemini_run_status',{p_run:context.runId});
    if (result.error) throw new Error('unavailable');
    return [401,402,403].includes(result.data as number) ? result.data as number : null;
  } catch { console.error('gemini_run_status_unavailable'); throw new Error('Gemini 429: busy'); }
}
/** Persist the first key refusal. Never log provider bodies or the credential. */
export async function recordGeminiRefusal(context: GeminiSearchContext | undefined, status: number): Promise<void> {
  if (!context?.runId || ![401,402,403].includes(status)) return;
  const result = await context.service.rpc('gemini_run_status',{p_run:context.runId,p_status:status});
  if (result.error) { console.error('gemini_refusal_save_failed'); throw new Error('Gemini 429: busy'); }
  context.onRefused?.([401,402,403].includes(result.data as number) ? result.data as number : status);
}
