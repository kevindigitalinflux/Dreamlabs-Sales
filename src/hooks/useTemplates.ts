import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { EmailTemplate } from '../types';

export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
  is_default: boolean;
}

/** Email templates (defaults + own). RLS scopes visibility; admin may toggle is_default. */
export function useTemplates() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentOrg) { setTemplates([]); setLoading(false); return; }
    const { data, error: err } = await supabase
      .from('email_templates').select('*')
      .or(`org_id.is.null,org_id.eq.${currentOrg.id}`)
      .order('is_default', { ascending: false }).order('name');
    if (err) setError(err.message);
    else { setTemplates(data as EmailTemplate[]); setError(null); }
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (t: TemplateInput, id?: string): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error: err } = id
      ? await supabase.from('email_templates').update(t).eq('id', id)
      : await supabase.from('email_templates').insert({ ...t, template_type: 'custom', created_by: session?.user.id, org_id: currentOrg.id });
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh, session, currentOrg]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error: err } = await supabase.from('email_templates').delete().eq('id', id);
    if (err) return err.message;
    await refresh();
    return null;
  }, [refresh]);

  return { templates, loading, error, save, remove };
}
