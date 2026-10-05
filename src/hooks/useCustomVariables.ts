import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { validateVariableKey } from '../lib/customVariables';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';

/** A user-defined email placeholder, e.g. {{google_meet_link}} (migration 046). */
export interface CustomVariable {
  id: string;
  org_id: string;
  /** null = company-wide (set by an org admin); otherwise the user it belongs to. */
  user_id: string | null;
  key: string;
  label: string | null;
  value: string;
}

export interface CustomVariableInput {
  key: string;
  label: string;
  value: string;
  /** 'me' = only the signed-in user's value; 'company' = shared (org admins only). */
  scope: 'me' | 'company';
}

/**
 * The placeholders the signed-in user can use: their own, plus the company-wide ones. RLS
 * already hides every other user's personal values, so this never sees them. `values` is
 * the effective key to value map for THIS user (their own value wins over a company-wide
 * one with the same name), which is what an email they send will be filled from.
 */
export function useCustomVariables() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [items, setItems] = useState<CustomVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) { setItems([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('custom_variables').select('*').eq('org_id', currentOrg.id).order('key');
    if (err) setError(err.message);
    else { setItems((data as CustomVariable[]) ?? []); setError(null); }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const personal = useMemo(() => items.filter((v) => v.user_id !== null && v.user_id === session?.user.id), [items, session]);
  const companyWide = useMemo(() => items.filter((v) => v.user_id === null), [items]);
  const values = useMemo(() => {
    const map: Record<string, string> = {};
    for (const v of companyWide) map[v.key] = v.value;
    for (const v of personal) map[v.key] = v.value;
    return map;
  }, [companyWide, personal]);

  /** Creates a placeholder. Returns an error message or null. */
  const add = useCallback(async (input: CustomVariableInput): Promise<string | null> => {
    if (!currentOrg || !session) return 'No organization selected';
    const sameScope = input.scope === 'me' ? personal : companyWide;
    const keyError = validateVariableKey(input.key, sameScope.map((v) => v.key));
    if (keyError) return keyError;
    if (!input.value.trim()) return 'Enter the value that should replace the placeholder.';
    const { error: err } = await supabase.from('custom_variables').insert({
      org_id: currentOrg.id, user_id: input.scope === 'me' ? session.user.id : null,
      key: input.key, label: input.label.trim() || null, value: input.value.trim(),
    });
    if (err) return err.code === '23505' ? `You already have a {{${input.key}}} placeholder.` : err.message;
    await refresh();
    return null;
  }, [currentOrg, session, personal, companyWide, refresh]);

  /** Changes a placeholder's label and value (its name stays, so templates using it keep working). */
  const update = useCallback(async (id: string, patch: { label: string; value: string }): Promise<string | null> => {
    if (!patch.value.trim()) return 'Enter the value that should replace the placeholder.';
    // .select().single() so a write RLS silently blocks is reported, not faked as success.
    const { error: err } = await supabase.from('custom_variables')
      .update({ label: patch.label.trim() || null, value: patch.value.trim() }).eq('id', id).select().single();
    if (err) return err.code === 'PGRST116' ? 'You don\'t have permission to change this placeholder.' : err.message;
    await refresh();
    return null;
  }, [refresh]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error: err } = await supabase.from('custom_variables').delete().eq('id', id).select().single();
    if (err) return err.code === 'PGRST116' ? 'You don\'t have permission to delete this placeholder.' : err.message;
    await refresh();
    return null;
  }, [refresh]);

  return { personal, companyWide, values, loading, error, add, update, remove };
}
