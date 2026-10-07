import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AutopilotRunLead } from '../types';

/** A run-lead row joined with the lead's name (null when the lead was deleted or is not visible). */
export type RunLeadRow = AutopilotRunLead & { lead: { id: string; business_name: string } | null };

/**
 * The leads of one selected-mode run, realtime-subscribed. `onChange` runs after every refetch
 * caused by a realtime event, so the caller can refresh the run's counters too.
 */
export function useAutopilotRunLeads(runId: string | null, onChange?: () => void) {
  const [rows, setRows] = useState<RunLeadRow[]>([]);
  const [loading, setLoading] = useState(runId !== null);
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const refresh = useCallback(async () => {
    if (!runId) return;
    const { data, error: err } = await supabase
      .from('autopilot_run_leads')
      .select('*, lead:leads(id, business_name)')
      .eq('run_id', runId)
      .order('updated_at');
    if (err) setError(err.message);
    else { setRows((data as RunLeadRow[] | null) ?? []); setError(null); }
    setLoading(false);
  }, [runId]);

  useEffect(() => {
    if (!runId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    void refresh();
    const channel = supabase
      .channel(`autopilot-run-leads-${runId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autopilot_run_leads', filter: `run_id=eq.${runId}` }, () => {
        void refresh().then(() => onChangeRef.current?.());
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [runId, refresh]);

  return { rows, loading, error, refresh };
}
