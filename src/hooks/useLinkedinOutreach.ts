import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useAuth } from './useAuth';
import { dismissDecisionMaker } from '../lib/dismissDecisionMaker';
import { readableInvokeError } from '../lib/invokeError';
import type { LinkedinContact, LinkedinDraft } from '../types';

export interface LeadSummary { id: string; business_name: string; pipeline_id: string }
/** `candidate` is the decision-maker record the contact was captured from; it carries their job title. */
export type ContactWithLead = LinkedinContact & { lead: LeadSummary | null; candidate: { title: string | null } | null };
export type DraftWithContact = LinkedinDraft & { contact: ContactWithLead };

/** LinkedIn contacts + their drafts for the current org, each joined to its
 * linked lead's summary (null for a manually-added contact with no lead
 * tie) so callers can search/filter by pipeline (see LinkedinOutreach.tsx). */
export function useLinkedinOutreach() {
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const [contacts, setContacts] = useState<ContactWithLead[]>([]);
  const [drafts, setDrafts] = useState<DraftWithContact[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentOrg) return;
    const [contactsRes, draftsRes] = await Promise.all([
      supabase.from('linkedin_contacts').select('*, lead:leads(id, business_name, pipeline_id), candidate:decision_maker_candidates(title)').eq('org_id', currentOrg.id).order('created_at', { ascending: false }),
      // Include 'approved' so a draft stays visible (with its "Mark as
      // sent" action available) after approval — otherwise it drops out of
      // this query the moment it's approved and its button can never render.
      supabase.from('linkedin_drafts').select('*, contact:linkedin_contacts(*, lead:leads(id, business_name, pipeline_id), candidate:decision_maker_candidates(title))').eq('org_id', currentOrg.id).in('status', ['draft', 'approved']).order('created_at', { ascending: false }),
    ]);
    setContacts((contactsRes.data as ContactWithLead[] | null) ?? []);
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
    // supabase-js only says "non-2xx"; unwrap the function's own reason (missing key, AI error…).
    if (error) return readableInvokeError(error);
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

  /**
   * Marks a draft sent and, when its contact is linked to a lead, mirrors
   * send-email's own safety-scoped side effects: logs a note and advances
   * the lead from new_lead to contacted specifically (never any other
   * stage), plus bumps last_contacted_at. Takes the full draft object
   * (not just ids) so it has the message text and the linked lead's id
   * without an extra fetch. A contact with no lead tie behaves exactly as
   * today — only its own/the draft's status changes.
   */
  const markSent = useCallback(async (draft: DraftWithContact): Promise<string | null> => {
    const { error: draftErr } = await supabase.from('linkedin_drafts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', draft.id);
    if (draftErr) return draftErr.message;
    await supabase.from('linkedin_contacts').update({ status: 'sent' }).eq('id', draft.contact.id);
    if (draft.contact.lead) {
      const leadId = draft.contact.lead.id;
      const { data: lead } = await supabase.from('leads').select('stage').eq('id', leadId).maybeSingle();
      await supabase.from('lead_notes').insert({
        lead_id: leadId,
        created_by: session?.user.id,
        note_type: 'general',
        content: `LinkedIn message sent to ${draft.contact.full_name}:\n\n${draft.message}`,
      });
      const leadUpdate: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
      if (lead?.stage === 'new_lead') leadUpdate.stage = 'contacted';
      await supabase.from('leads').update(leadUpdate).eq('id', leadId);
    }
    await refresh();
    return null;
  }, [session, refresh]);

  /**
   * Deletes a contact and its drafts. One captured from a decision-maker search is first dismissed
   * there too, otherwise the next "Find decision maker" run would quietly re-add them.
   */
  const deleteContact = useCallback(async (contact: ContactWithLead): Promise<string | null> => {
    if (contact.decision_maker_candidate_id) {
      const dismissErr = await dismissDecisionMaker(contact.decision_maker_candidate_id);
      if (dismissErr) return dismissErr;
    }
    const { error } = await supabase.from('linkedin_contacts').delete().eq('id', contact.id).select().single();
    if (error) return error.code === 'PGRST116' ? "You don't have permission to delete this contact." : error.message;
    await refresh();
    return null;
  }, [refresh]);

  return { contacts, drafts, loading, addContact, draftFor, approve, skip, markSent, deleteContact };
}
