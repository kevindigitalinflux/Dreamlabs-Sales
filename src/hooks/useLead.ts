import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { useAuth } from './useAuth';
import type { Lead } from '../types';

/** A single lead by id (RLS-scoped). Used by the lead detail page. */
export function useLead(id: string) {
  const { session } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase.from('leads').select('*').eq('id', id).single();
    if (err) setError(err.message);
    else {
      setLead(data as Lead);
      setError(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  /** Patches this lead (stage changes auto-logged) and refreshes. */
  const updateLead = useCallback(
    async (patch: LeadPatch): Promise<string | null> => {
      const err = await applyLeadUpdate(id, patch, lead, session?.user.id);
      if (!err) await refresh();
      return err;
    },
    [id, lead, session, refresh],
  );

  return { lead, loading, error, refresh, updateLead };
}
