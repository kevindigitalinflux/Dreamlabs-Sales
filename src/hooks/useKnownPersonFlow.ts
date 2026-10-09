import { useCallback, useEffect, useRef, useState } from 'react';
import { useDecisionMakers } from './useDecisionMakers';
import type { KnownPersonInput, KnownPersonResult } from '../types';

/** A finished lookup: what the user typed and what the server returned. */
export interface KnownPersonOutcome { person: KnownPersonInput; result: KnownPersonResult }

/**
 * One lead's "I already know who" lookup. Wraps `lookupKnownPerson`, keeps the last
 * outcome for the result panel, refreshes the contacts list afterwards, and drops
 * the outcome (and ignores a late response) when the lead changes.
 */
export function useKnownPersonFlow(leadId: string, refreshContacts: () => Promise<void>) {
  const { lookingUp, error, lookupKnownPersonDetailed, clearError } = useDecisionMakers();
  const [outcome, setOutcome] = useState<KnownPersonOutcome | null>(null);
  const epoch = useRef(0);

  useEffect(() => { epoch.current++; setOutcome(null); clearError(); }, [leadId, clearError]);

  /** Runs the lookup; resolves to an error message, or null when the person was saved. */
  const lookup = useCallback(async (person: KnownPersonInput): Promise<string | null> => {
    const mine = epoch.current;
    setOutcome(null);
    const { result, error: failure } = await lookupKnownPersonDetailed(leadId, person);
    if (mine !== epoch.current) return null; // the lead changed; this answer is stale
    if (!result) return failure ?? 'The lookup did not finish. Please try again.';
    await refreshContacts();
    if (mine === epoch.current) setOutcome({ person, result });
    return null;
  }, [leadId, lookupKnownPersonDetailed, refreshContacts]);

  const clear = useCallback(() => setOutcome(null), []);
  return { lookingUp, error, outcome, lookup, clear };
}
