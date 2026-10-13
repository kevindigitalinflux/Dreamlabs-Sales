import { useEffect, useId, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { activeLeadIds, needsAttention, runTotals, type DeepFindActivityRow } from '../lib/deepFindView';
import type { DeepFindRun } from '../types';

const RECENT_RUNS = 20;
const RECENT_DAYS = 14;

/**
 * The organisation's recent Deep find runs and their leads (the last 14 days), kept live by realtime. Rows the viewer
 * cannot see (RLS: can_view_lead) are simply not counted. The channel name includes useId() so two mounted users of
 * this hook never share a channel. Gives the runs list, per-run totals, leads currently queued or running, and how
 * many finished leads need the user (company choice or people to check).
 */
export function useDeepFindActivity(orgId: string | null) {
  const instance = useId();
  const [runs, setRuns] = useState<DeepFindRun[]>([]);
  const [rows, setRows] = useState<DeepFindActivityRow[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRuns([]);
    setRows([]);
    setError(null);
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    let active = true;
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
    const load = async () => {
      const [r, l] = await Promise.all([
        supabase.from('deep_find_runs').select('*').eq('org_id', orgId).order('started_at', { ascending: false }).limit(RECENT_RUNS),
        supabase.from('deep_find_leads').select('run_id, lead_id, status, people_found, domains, updated_at, lead:leads(company_number)')
          .eq('org_id', orgId).gte('updated_at', since).order('updated_at', { ascending: false }).limit(300),
      ]);
      if (!active) return;
      const err = r.error ?? l.error;
      if (err) setError(err.message);
      else {
        setRuns((r.data as DeepFindRun[] | null) ?? []);
        setRows((l.data as unknown as DeepFindActivityRow[] | null) ?? []);
        setError(null);
      }
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel(`deep-find-activity-${orgId}-${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deep_find_runs', filter: `org_id=eq.${orgId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deep_find_leads', filter: `org_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [orgId, instance]);

  const totals = useMemo(() => runTotals(rows), [rows]);
  const running = useMemo(() => activeLeadIds(rows), [rows]);
  const attention = useMemo(() => rows.filter(needsAttention).length, [rows]);
  return { runs, rows, totals, running, attention, loading, error };
}
