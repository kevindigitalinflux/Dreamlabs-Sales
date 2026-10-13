import { useEffect, useId, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DeepFindLeadRow } from '../types';

/**
 * The latest Deep find row for one lead (queued, running or finished), kept live by realtime, for the lead card's
 * status chip and "Deep find results" link. Per-instance channel name (useId).
 */
export function useLeadDeepFind(leadId: string | null) {
  const instance = useId();
  const [row, setRow] = useState<Pick<DeepFindLeadRow, 'run_id' | 'status'> | null>(null);

  useEffect(() => {
    setRow(null);
    if (!leadId) return;
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('deep_find_leads').select('run_id, status')
        .eq('lead_id', leadId).order('updated_at', { ascending: false }).limit(1);
      if (active) setRow(((data ?? []) as Pick<DeepFindLeadRow, 'run_id' | 'status'>[])[0] ?? null);
    };
    void load();
    const channel = supabase
      .channel(`deep-find-lead-${leadId}-${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deep_find_leads', filter: `lead_id=eq.${leadId}` }, () => void load())
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [leadId, instance]);

  return row;
}
