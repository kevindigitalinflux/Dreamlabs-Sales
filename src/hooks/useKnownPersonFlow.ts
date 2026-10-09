import { useCallback, useEffect, useRef, useState } from 'react';
import { useDecisionMakers } from './useDecisionMakers';
import type { DecisionMakerCandidate, KnownPersonInput, KnownPersonResult } from '../types';

/** A finished lookup: what the user typed, what the server returned, and follow-up notes. */
export interface KnownPersonOutcome { person: KnownPersonInput; result: KnownPersonResult; notes: string[]; typedPhone: string }

/** Extra work after the person is saved (for example saving a typed phone); returns notes to show. */
export type AfterSave = (result: KnownPersonResult, rows: DecisionMakerCandidate[] | null) => Promise<string[]>;

/**
 * One lead's "I already know who" lookup. Wraps the lookup, keeps the last outcome for
 * the result panel, refreshes the contacts list afterwards (a failed refresh becomes a
 * visible note), and drops the outcome (and ignores a late response) when the lead changes.
 */
export function useKnownPersonFlow(leadId: string, refreshContacts: () => Promise<DecisionMakerCandidate[] | null>) {
  const { lookingUp, lookupKnownPersonDetailed, clearError } = useDecisionMakers();
  const [outcome, setOutcome] = useState<KnownPersonOutcome | null>(null);
  const epoch = useRef(0);

  useEffect(() => { epoch.current++; setOutcome(null); clearError(); }, [leadId, clearError]);

  /** Runs the lookup; resolves to an error message, or null when the person was saved. */
  const lookup = useCallback(async (person: KnownPersonInput, typedPhone = '', after?: AfterSave): Promise<string | null> => {
    const mine = epoch.current;
    setOutcome(null);
    const { result, error: failure } = await lookupKnownPersonDetailed(leadId, person);
    if (mine !== epoch.current) return null; // the lead changed; this answer is stale
    if (!result) return failure ?? 'The lookup did not finish. Please try again.';
    const rows = await refreshContacts();
    const notes: string[] = [];
    if (!rows) notes.push('The contact list could not be refreshed. Reload the page to see the new person.');
    if (after) notes.push(...(await after(result, rows)));
    if (mine === epoch.current) setOutcome({ person, result, notes, typedPhone });
    return null;
  }, [leadId, lookupKnownPersonDetailed, refreshContacts]);

  const clear = useCallback(() => setOutcome(null), []);
  return { lookingUp, outcome, lookup, clear };
}
