import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseSnapshot, type UsageRow } from '../../supabase/functions/_shared/usageRules';

const POLL_MS = 60_000;

/**
 * The organisation's worker allowances for today, kept fresh by a 60 s refetch and by realtime changes to its
 * counters. The channel name includes useId() so two mounted users of this hook (the top-bar meter and the Settings
 * card) never share a channel. A failed refetch keeps the last good numbers; "Usage unavailable" is only reported
 * when nothing has ever loaded.
 */
export function useUsage(orgId: string | null) {
  const instance = useId();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const hasRows = useRef(false);

  useEffect(() => {
    hasRows.current = false;
    setRows([]);
    setError(null);
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    let active = true;
    const load = async () => {
      const { data, error: err } = await supabase.rpc('usage_snapshot', { p_org: orgId });
      if (!active) return;
      const parsed = err ? [] : parseSnapshot(data);
      if (err) console.error('usage_snapshot failed:', err.message);
      if (parsed.length > 0) {
        hasRows.current = true;
        setRows(parsed);
        setError(null);
      } else if (!hasRows.current) {
        setError('Usage unavailable');
      }
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const channel = supabase
      .channel(`usage-${orgId}-${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usage_counters', filter: `org_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { active = false; window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [orgId, instance, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, loading, error, reload };
}
