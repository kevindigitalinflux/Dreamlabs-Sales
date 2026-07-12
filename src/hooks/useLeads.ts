import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { useAuth } from './useAuth';
import type { Lead, PackageTier, Stage } from '../types';

export interface LeadInput {
  business_name: string;
  owner_name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  postcode?: string | null;
  vertical?: string | null;
  stage?: Stage;
  package_tier?: PackageTier | null;
  deal_value?: number | null;
  assigned_to?: string | null;
  next_action_date?: string | null;
  next_action_note?: string | null;
}

/** All leads visible to the current user, kept fresh via a realtime subscription. */
export function useLeads() {
  const { session } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('leads').select('*').order('kanban_position').order('created_at');
    if (err) setError(err.message);
    else {
      setLeads(data as Lead[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  /** Inserts a lead owned by the current user; returns error message or null. */
  const createLead = useCallback(
    async (input: LeadInput): Promise<string | null> => {
      const stage = input.stage ?? 'new_lead';
      const maxPos = Math.max(0, ...leads.filter((l) => l.stage === stage).map((l) => l.kanban_position));
      const { error: err } = await supabase.from('leads').insert({
        ...input,
        stage,
        kanban_position: maxPos + 1,
        created_by: session?.user.id,
      });
      if (err) return err.message;
      await refresh();
      return null;
    },
    [leads, session, refresh],
  );

  /** Patches a lead (stage changes auto-logged); optimistic local update, then refresh. */
  const updateLead = useCallback(
    async (id: string, patch: LeadPatch): Promise<string | null> => {
      const before = leads.find((l) => l.id === id) ?? null;
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      const err = await applyLeadUpdate(id, patch, before, session?.user.id);
      if (err) await refresh(); // roll back the optimistic update
      return err;
    },
    [leads, session, refresh],
  );

  return { leads, loading, error, refresh, createLead, updateLead };
}
