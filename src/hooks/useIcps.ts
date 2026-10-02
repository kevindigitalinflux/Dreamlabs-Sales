import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { IdealCustomerProfile } from '../types';

/** The editable text fields of a profile (empty strings are stored as NULL). */
export interface IcpInput {
  name: string;
  summary: string;
  pain_points: string;
  goals: string;
  objections: string;
  messaging_notes: string;
  extra_context: string;
}

const blankToNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * The current org's ideal customer profiles, A to Z. Every member can read them; RLS lets
 * only org admins create, edit or delete (so the UI hides those controls for everyone else).
 */
export function useIcps() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [icps, setIcps] = useState<IdealCustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) { setIcps([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('ideal_customer_profiles').select('*').eq('org_id', currentOrg.id).order('name');
    if (err) setError(err.message);
    else { setIcps((data as IdealCustomerProfile[]) ?? []); setError(null); }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Creates or updates a profile. Returns an error message or null. */
  const save = useCallback(async (input: IcpInput, id?: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const name = input.name.trim();
    if (!name) return 'Give the profile a name.';
    const row = {
      name,
      summary: blankToNull(input.summary), pain_points: blankToNull(input.pain_points), goals: blankToNull(input.goals),
      objections: blankToNull(input.objections), messaging_notes: blankToNull(input.messaging_notes), extra_context: blankToNull(input.extra_context),
    };
    // .select().single() so an update RLS silently blocks (not an admin) is reported, not faked as success.
    const { error: err } = id
      ? await supabase.from('ideal_customer_profiles').update(row).eq('id', id).select().single()
      : await supabase.from('ideal_customer_profiles').insert({ ...row, org_id: currentOrg.id, created_by: session?.user.id });
    if (err) {
      if (err.code === '23505') return 'You already have a profile with that name.';
      return err.code === 'PGRST116' ? 'Only an org admin can edit profiles.' : err.message;
    }
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  /** Deletes a profile; anything using it simply becomes un-assigned. Returns an error message or null. */
  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error: err } = await supabase.from('ideal_customer_profiles').delete().eq('id', id).select().single();
    if (err) return err.code === 'PGRST116' ? 'Only an org admin can delete profiles.' : err.message;
    await refresh();
    return null;
  }, [refresh]);

  return { icps, loading, error, save, remove };
}
