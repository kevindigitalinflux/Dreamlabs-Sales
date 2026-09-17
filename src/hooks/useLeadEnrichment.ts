import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EnrichmentResult } from '../types';

/**
 * Runs the free-then-paid enrichment waterfall for a batch of leads. Never
 * writes to the database itself — callers apply whichever proposed changes
 * the user keeps checked via useLeads().updateLead().
 */
export function useLeadEnrichment() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEnrichment = useCallback(async (leadIds: string[]): Promise<EnrichmentResult[]> => {
    setRunning(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('enrich-leads-bulk', {
      body: { lead_ids: leadIds },
    });
    setRunning(false);
    if (invokeErr) { setError(invokeErr.message); return []; }
    const result = data as { results?: EnrichmentResult[]; error?: string };
    if (result.error) { setError(result.error); return []; }
    return result.results ?? [];
  }, []);

  return { running, error, runEnrichment };
}
