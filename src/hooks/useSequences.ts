import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { EmailSequence, SequenceStep } from '../types';

export interface SequenceInput {
  name: string;
  description: string | null;
  steps: SequenceStep[];
  is_default: boolean;
}

/** Email sequences (defaults + own), RLS-scoped like templates. */
export function useSequences() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) { setSequences([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('email_sequences').select('*')
      .or(`org_id.is.null,org_id.eq.${currentOrg.id}`)
      .order('is_default', { ascending: false }).order('name');
    if (err) setError(err.message);
    else { setSequences(data as EmailSequence[]); setError(null); }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (input: SequenceInput, id?: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error: err } = id
      ? await supabase.from('email_sequences').update(input).eq('id', id)
      : await supabase.from('email_sequences').insert({ ...input, created_by: session?.user.id, org_id: currentOrg.id });
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh, session, currentOrg]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error: err } = await supabase.from('email_sequences').delete().eq('id', id);
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh]);

  return { sequences, loading, error, save, remove };
}
