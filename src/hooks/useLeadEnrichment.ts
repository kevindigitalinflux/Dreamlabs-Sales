import { useCallback, useState } from 'react';
import { createLookupJob, type LookupStarted } from '../lib/lookupJobs';

/** Creates a background job; proposals are reviewed from Jobs. */
export function useLeadEnrichment() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runEnrichment = useCallback(async (leadIds: string[]): Promise<LookupStarted | null> => {
    setRunning(true); setError(null);
    try { return await createLookupJob('enrich', leadIds); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start the lookup.'); return null; }
    finally { setRunning(false); }
  }, []);
  return { running, error, runEnrichment };
}
