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
  const result = await (context?.service ?? geminiService()).rpc('gemini_admit', {});
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
