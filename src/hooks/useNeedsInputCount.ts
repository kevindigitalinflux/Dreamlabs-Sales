import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { countOpenNeedsInput } from '../lib/runLeadGroups';
import { fetchLogStatuses } from './useDraftStatuses';
import { useOrg } from './useOrg';

const WINDOW_DAYS = 30;

/** Window event fired after a parked draft is sent, so every mounted count refreshes. */
export const NEEDS_INPUT_CHANGED_EVENT = 'needs-input-changed';

/**
 * How many autopilot leads in the active org (any run, last 30 days) are waiting on the user:
 * needs-input rows whose parked draft is still unsent. Switching org clears the count at once
 * and drops late responses from the previous org. `count` is null until loaded or on error.
 */
export function useNeedsInputCount() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const refresh = useCallback(async () => {
    const token = ++tokenRef.current;
    if (!orgId) { setCount(null); setLoading(false); return; }
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error: err } = await supabase
      .from('autopilot_run_leads')
      .select('status, email_log_id')
      .eq('org_id', orgId)
      .eq('status', 'needs_input')
      .not('email_log_id', 'is', null)
      .gte('updated_at', since)
      .limit(1000);
    if (token !== tokenRef.current) return;
    if (err) { setError(err.message); setCount(null); setLoading(false); return; }
    const rows = (data as { status: string; email_log_id: string | null }[] | null) ?? [];
    const logs = await fetchLogStatuses(rows.map((r) => r.email_log_id).filter((id): id is string => id !== null));
    if (token !== tokenRef.current) return;
    if (logs.error) { setError(logs.error); setCount(null); }
    else { setError(null); setCount(countOpenNeedsInput(rows, logs.statuses)); }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    setCount(null);
    setError(null);
    setLoading(orgId !== null);
    void refresh();
    return () => { tokenRef.current += 1; };
  }, [orgId, refresh]);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener(NEEDS_INPUT_CHANGED_EVENT, handler);
    return () => window.removeEventListener(NEEDS_INPUT_CHANGED_EVENT, handler);
  }, [refresh]);

  return { count, loading, error, refresh };
}
