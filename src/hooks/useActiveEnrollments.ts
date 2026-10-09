import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { PickerEnrollment } from '../lib/templatePicker';

/** Active enrolments by lead id for the given leads (RLS-scoped). Reloads when `active` turns on; ignores stale answers. */
export function useActiveEnrollments(leadIds: string[], active: boolean) {
  const [byLead, setByLead] = useState<Record<string, PickerEnrollment>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || leadIds.length === 0) { setByLead({}); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    void supabase.from('sequence_enrollments').select('lead_id, sequence_id, current_step, status')
      .in('lead_id', leadIds).eq('status', 'active')
      .then(({ data, error: err }) => {
        if (cancelled) return;
        setLoading(false);
        if (err) { setByLead({}); setError(err.message); return; }
        const next: Record<string, PickerEnrollment> = {};
        for (const r of (data ?? []) as (PickerEnrollment & { lead_id: string })[]) next[r.lead_id] = r;
        setByLead(next);
      });
    return () => { cancelled = true; };
    // leadIds is the selection at open time; keyed by its content so a parent re-render does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, leadIds.join(',')]);

  return { byLead, loading, error };
}
