import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { EmailLog } from '../types';

export type DraftLog = EmailLog & { lead: { id: string; business_name: string } | null };

/** The caller's draft emails awaiting review (RLS scopes to own; admin sees all). */
export function useDrafts() {
  const [drafts, setDrafts] = useState<DraftLog[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('email_logs')
      .select('*, lead:leads(id, business_name)')
      .eq('status', 'draft')
      .order('sent_at', { ascending: false });
    setDrafts((data as DraftLog[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { drafts, loading, refresh };
}
