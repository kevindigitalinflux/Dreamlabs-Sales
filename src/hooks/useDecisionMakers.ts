import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readableInvokeError } from '../lib/invokeError';
import type { DecisionMakerCandidate, KnownPersonInput, KnownPersonResult } from '../types';

/**
 * Runs the free decision-maker search (Hunter + Apollo) for a batch of
 * leads. Never writes to a lead itself — Hunter's "Add to lead" and
 * Apollo's "Reveal" actions (handled inside DecisionMakerReview) are each
 * their own explicit, already-consented write.
 */
export function useDecisionMakers() {
  const [searching, setSearching] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (leadIds: string[]): Promise<Record<string, DecisionMakerCandidate[]> | null> => {
    setSearching(true);
    setError(null);
    const { data, error: invokeErr } = await supabase.functions.invoke('find-decision-makers', {
      body: { lead_ids: leadIds },
    });
    setSearching(false);
    if (invokeErr) { setError(await readableInvokeError(invokeErr)); return null; }
    const result = data as { results?: { lead_id: string; candidates: DecisionMakerCandidate[] }[]; error?: string };
    if (result.error) { setError(result.error); return null; }
    const grouped: Record<string, DecisionMakerCandidate[]> = {};
    for (const r of result.results ?? []) grouped[r.lead_id] = r.candidates;
    return grouped;
  }, []);

  /**
   * Looks up ONE person the user already knows, on ONE lead. The server saves the
   * person (follow-ups on) and fills gaps from Hunter / Apollo. Returns the typed
   * result, or null with the hook's error set (a 409 means the person or email is already on the lead).
   */
  const lookupKnownPersonDetailed = useCallback(async (leadId: string, person: KnownPersonInput): Promise<{ result: KnownPersonResult | null; error: string | null }> => {
    setLookingUp(true);
    setError(null);
    const fail = (message: string) => { setError(message); return { result: null, error: message }; };
    const { data, error: invokeErr } = await supabase.functions.invoke('find-decision-makers', {
      body: { lead_ids: [leadId], known_person: person },
    });
    setLookingUp(false);
    if (invokeErr) return fail(await readableInvokeError(invokeErr));
    const body = data as { known_person?: KnownPersonResult; error?: string } | null;
    if (body?.error) return fail(body.error);
    if (!body?.known_person) return fail('The lookup returned no result. Please try again.');
    return { result: body.known_person, error: null };
  }, []);

  const lookupKnownPerson = useCallback(
    async (leadId: string, person: KnownPersonInput) => (await lookupKnownPersonDetailed(leadId, person)).result,
    [lookupKnownPersonDetailed],
  );

  const clearError = useCallback(() => setError(null), []);

  return { searching, lookingUp, error, runSearch, lookupKnownPerson, lookupKnownPersonDetailed, clearError };
}
