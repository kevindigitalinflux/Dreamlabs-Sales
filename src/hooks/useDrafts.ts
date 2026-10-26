import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import type { EmailLog } from '../types';
import { loadReleaseDrafts } from '../lib/releaseDrafts';

export type DraftLog = EmailLog & { lead: { id: string; business_name: string } | null };

/** Draft + failed emails awaiting review/retry (SPEC §4: failed sends stay in the queue). RLS scopes to own; admin sees all. */
export function useDrafts(bulkSafeOnly = false) {
  const { currentOrg } = useOrg();
  const [drafts, setDrafts] = useState<DraftLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (bulkSafeOnly) {
      const result = await loadReleaseDrafts(supabase, currentOrg?.id ?? null);
      setDrafts(result.drafts); setError(result.error); setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('email_logs')
      .select('*, lead:leads(id, business_name)')
      .in('status', ['draft', 'failed'])
      .eq('org_id', currentOrg?.id ?? '')
      .order('sent_at', { ascending: false });
    setDrafts((data as DraftLog[] | null) ?? []);
    setLoading(false);
  }, [currentOrg, bulkSafeOnly]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { drafts, loading, error, refresh };
}
