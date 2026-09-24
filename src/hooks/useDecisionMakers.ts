import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DecisionMakerCandidate } from '../types';

/**
 * Runs the free decision-maker search (Hunter + Apollo) for a batch of
 * leads. Never writes to a lead itself — Hunter's "Add to lead" and
 * Apollo's "Reveal" actions (handled inside DecisionMakerReview) are each
 * their own explicit, already-consented write.
 */
export function useDecisionMakers() {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (leadIds: string[]): Promise<Record<string, DecisionMakerCandidate[]>> => {
    setSearching(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('find-decision-makers', {
      body: { lead_ids: leadIds },
    });
    setSearching(false);
    if (invokeErr) { setError(invokeErr.message); return {}; }
    const result = data as { results?: { lead_id: string; candidates: DecisionMakerCandidate[] }[]; error?: string };
    if (result.error) { setError(result.error); return {}; }
    const grouped: Record<string, DecisionMakerCandidate[]> = {};
    for (const r of result.results ?? []) grouped[r.lead_id] = r.candidates;
    return grouped;
  }, []);

  return { searching, error, runSearch };
}
