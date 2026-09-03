import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
import type { LinkedinContact, LinkedinDraft } from '../types';

export type DraftWithContact = LinkedinDraft & { contact: LinkedinContact };

/** LinkedIn contacts + their drafts for the current org. */
export function useLinkedinOutreach() {
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const [contacts, setContacts] = useState<LinkedinContact[]>([]);
  const [drafts, setDrafts] = useState<DraftWithContact[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const [contactsRes, draftsRes] = await Promise.all([
      supabase.from('linkedin_contacts').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      supabase.from('linkedin_drafts').select('*, contact:linkedin_contacts(*)').eq('org_id', currentOrg.id).in('status', ['draft']).order('created_at', { ascending: false }),
    ]);
    setContacts((contactsRes.data as LinkedinContact[] | null) ?? []);
    setDrafts((draftsRes.data as DraftWithContact[] | null) ?? []);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addContact = useCallback(async (input: { full_name: string; linkedin_url: string; context_signal: string }): Promise<string | null> => {
    if (!currentOrg) return 'No organization selected';
    const { error } = await supabase.from('linkedin_contacts').insert({
      org_id: currentOrg.id, full_name: input.full_name,
      linkedin_url: input.linkedin_url || null, context_signal: input.context_signal || null,
      created_by: session?.user.id,
    });
    if (error) return error.message;
    await refresh();
    return null;
  }, [currentOrg, session, refresh]);

  const draftFor = useCallback(async (contactId: string): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('draft-linkedin-message', { body: { contact_id: contactId } });
    if (error) return error.message;
    const err = (data as { error?: string }).error;
    if (err) return err;
    await refresh();
    return null;
  }, [refresh]);

  const approve = useCallback(async (draftId: string): Promise<string | null> => {
    const { error } = await supabase.from('linkedin_drafts').update({ status: 'approved', approved_by: session?.user.id, approved_at: new Date().toISOString() }).eq('id', draftId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [session, refresh]);

  const skip = useCallback(async (draftId: string): Promise<string | null> => {
    const { error } = await supabase.from('linkedin_drafts').update({ status: 'skipped' }).eq('id', draftId);
    if (error) return error.message;
    await refresh();
    return null;
  }, [refresh]);

  const markSent = useCallback(async (draftId: string, contactId: string): Promise<string | null> => {
    const { error: draftErr } = await supabase.from('linkedin_drafts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', draftId);
    if (draftErr) return draftErr.message;
    await supabase.from('linkedin_contacts').update({ status: 'sent' }).eq('id', contactId);
    await refresh();
    return null;
  }, [refresh]);

  return { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent };
}
