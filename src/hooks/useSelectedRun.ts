import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import type { AutopilotRun } from '../types';

const POLL_MS = 30_000;

/**
 * The current org's most recent selected-leads run: the active one if there is one,
 * otherwise the latest by started_at. Polls every 30s while the run is active.
 */
export function useSelectedRun() {
  const { currentOrg } = useOrg();
  const [run, setRun] = useState<AutopilotRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const base = () => supabase.from('autopilot_runs').select('*').eq('org_id', currentOrg.id).eq('mode', 'selected');
    const active = await base().eq('status', 'active').order('started_at', { ascending: false }).limit(1);
    if (active.error) { setError(active.error.message); setLoading(false); return; }
    let found = ((active.data as AutopilotRun[] | null) ?? [])[0] ?? null;
    if (!found) {
      const latest = await base().order('started_at', { ascending: false }).limit(1);
      if (latest.error) { setError(latest.error.message); setLoading(false); return; }
      found = ((latest.data as AutopilotRun[] | null) ?? [])[0] ?? null;
    }
    setRun(found);
    setError(null);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const active = run?.status === 'active';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  /** Stops the run. A run that already finished is simply already stopped (no error). */
  const stopRun = useCallback(async (): Promise<string | null> => {
    if (!run) return 'No run to stop';
    const { error: err } = await supabase.from('autopilot_runs')
      .update({ status: 'cancelled', cancel_reason: 'stopped by user' }).eq('id', run.id).eq('status', 'active');
    if (err) return err.message;
    await refresh();
    return null;
  }, [run, refresh]);

  return { run, loading, error, refresh, stopRun };
}
