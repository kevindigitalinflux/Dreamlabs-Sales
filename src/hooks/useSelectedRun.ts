import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import type { AutopilotRun } from '../types';

const POLL_MS = 30_000;

/**
 * The current org's most recent selected-leads run: the active one if there is one,
 * otherwise the latest by started_at. Polls every 30s while the run is active.
 * Switching org clears the previous org's run and drops any late response for it.
 */
export function useSelectedRun() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const [run, setRun] = useState<AutopilotRun | null>(null);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  const runRef = useRef<AutopilotRun | null>(null);
  runRef.current = run;

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const token = tokenRef.current;
    const base = () => supabase.from('autopilot_runs').select('*').eq('org_id', orgId).eq('mode', 'selected');
    const fail = (message: string) => {
      if (token !== tokenRef.current) return;
      setError(message);
      setLoading(false);
    };
    const active = await base().eq('status', 'active').order('started_at', { ascending: false }).limit(1);
    if (token !== tokenRef.current) return;
    if (active.error) return fail(active.error.message);
    let found = ((active.data as AutopilotRun[] | null) ?? [])[0] ?? null;
    if (!found) {
      const latest = await base().order('started_at', { ascending: false }).limit(1);
      if (token !== tokenRef.current) return;
      if (latest.error) return fail(latest.error.message);
      found = ((latest.data as AutopilotRun[] | null) ?? [])[0] ?? null;
    }
    setRun(found);
    setError(null);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    tokenRef.current += 1;
    setRun(null);
    setError(null);
    setLoading(orgId !== null);
    void refresh();
    return () => { tokenRef.current += 1; };
  }, [orgId, refresh]);

  const active = run?.status === 'active';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  /** Stops the run. A run that already finished is simply already stopped (no error). */
  const stopRun = useCallback(async (): Promise<string | null> => {
    const current = runRef.current;
    if (!current || current.org_id !== orgId) return 'No run to stop';
    const { error: err } = await supabase.from('autopilot_runs')
      .update({ status: 'cancelled', cancel_reason: 'stopped by user' }).eq('id', current.id).eq('status', 'active');
    if (err) return err.message;
    await refresh();
    return null;
  }, [orgId, refresh]);

  return { run, loading, error, refresh, stopRun };
}
