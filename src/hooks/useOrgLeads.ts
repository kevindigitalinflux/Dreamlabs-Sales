import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { Lead } from '../types';

/** Every lead visible to the user across the WHOLE current org (every pipeline they
 * can see in it), not scoped to one active pipeline — for org-wide surfaces like the
 * Dashboard and Power Dialer, where "today's focus" or "who can I call" must not be
 * silently narrowed to whichever pipeline happens to be selected in the switcher. */
export function useOrgLeads() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) { setLeads([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('leads').select('*').eq('org_id', currentOrg.id).order('kanban_position').order('created_at');
    if (err) setError(err.message);
    else { setLeads(data as Lead[]); setError(null); }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel('org-leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  /** Patches a lead (stage changes auto-logged); optimistic local update, then refresh. */
  const updateLead = useCallback(
    async (id: string, patch: LeadPatch): Promise<string | null> => {
      const before = leads.find((l) => l.id === id) ?? null;
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      const err = await applyLeadUpdate(id, patch, before, session?.user.id);
      if (err) await refresh();
      return err;
    },
    [leads, session, refresh],
  );

  return { leads, loading, error, refresh, updateLead };
}
