import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Monday 00:00 (local) of the current week, as an ISO string. */
function startOfWeekISO(now: Date = new Date()): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toISOString();
}

/** Dashboard counters that need their own queries (drafts, calls this week). */
export function useDashboardStats() {
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [callsThisWeek, setCallsThisWeek] = useState<number | null>(null);

  useEffect(() => {
    void supabase
      .from('email_logs').select('id', { count: 'exact', head: true }).eq('status', 'draft')
      .then(({ count }) => setDraftCount(count ?? 0));
    void supabase
      .from('lead_notes').select('id', { count: 'exact', head: true })
      .eq('note_type', 'call').gte('created_at', startOfWeekISO())
      .then(({ count }) => setCallsThisWeek(count ?? 0));
  }, []);

  return { draftCount, callsThisWeek };
}
