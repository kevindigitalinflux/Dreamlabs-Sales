import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EnrichmentResult } from '../types';

/**
 * supabase-js throws a generic `FunctionsHttpError` ("Edge Function returned
 * a non-2xx status code") for every non-2xx response — the actual
 * `{error: "..."}` body our functions send lives on `error.context` (the raw
 * Response), not `error.message`. Without this, real messages (e.g. the
 * 40-lead cap rejection or "Not a member of this organization") never reach
 * the user.
 */
async function readableInvokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // Body wasn't JSON — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * Runs the free-then-paid enrichment waterfall for a batch of leads. Never
 * writes to the database itself — callers apply whichever proposed changes
 * the user keeps checked via useLeads().updateLead().
 *
 * Returns `null` when the run failed outright (so the caller can skip the
 * review modal and leave the error message standing on its own), and `[]`
 * when the run succeeded but found nothing to propose.
 */
export function useLeadEnrichment() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEnrichment = useCallback(async (leadIds: string[]): Promise<EnrichmentResult[] | null> => {
    setRunning(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('enrich-leads-bulk', {
      body: { lead_ids: leadIds },
    });
    setRunning(false);
    if (invokeErr) { setError(await readableInvokeError(invokeErr)); return null; }
    const result = data as { results?: EnrichmentResult[]; error?: string };
    if (result.error) { setError(result.error); return null; }
    return result.results ?? [];
  }, []);

  return { running, error, runEnrichment };
}
