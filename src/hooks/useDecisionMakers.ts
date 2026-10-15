import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readableInvokeError } from '../lib/invokeError';
import type { KnownPersonInput, KnownPersonResult } from '../types';
import { createLookupJob, type LookupStarted } from '../lib/lookupJobs';

/**
 * Queues the generic decision-maker search for Jobs. Known-person lookup remains
 * synchronous: that is a separate, explicitly reviewed action on a named contact.
 */
export function useDecisionMakers() {
  const [searching, setSearching] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (leadIds: string[]): Promise<LookupStarted | null> => {
    setSearching(true);
    setError(null);
    try { return await createLookupJob('decision_makers', leadIds); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start the lookup.'); return null; }
    finally { setSearching(false); }
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
