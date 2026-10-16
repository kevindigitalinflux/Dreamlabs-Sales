import type { SupabaseClient } from '@supabase/supabase-js';
import { planSuggestionAdd, registrySkipReason, suggestionKey } from '../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewContact, ReviewLead, ReviewSuggestion } from '../../supabase/functions/_shared/deepFindSuggestions';

export interface ReviewState { lead: ReviewLead & { id: string; updated_at: string }; contacts: ReviewContact[] }
const FAILURE = 'Could not save this change. Refresh and try again.';

/** Session client only. Read failures must not turn existing contacts into an empty list. */
export async function loadDeepFindReview(client: SupabaseClient, leadId: string): Promise<ReviewState> {
  const [lead, contacts] = await Promise.all([
    client.from('leads').select('id, email, additional_emails, dismissed_suggestions, country, registry_candidates_rejected, updated_at').eq('id', leadId).single(),
    client.from('decision_maker_candidates').select('id, first_name, last_name, email, dismissed_at').eq('lead_id', leadId),
  ]);
  if (lead.error || contacts.error || !lead.data || !contacts.data) throw new Error('Could not load this lead’s review details. Refresh and try again.');
  return { lead: lead.data as ReviewState['lead'], contacts: contacts.data as ReviewContact[] };
}

/** A fresh read and compare-and-set prevent lost array additions and overwriting a concurrent email fill. */
export async function saveDeepFindReview(client: SupabaseClient, userId: string | null, leadId: string, suggestion: ReviewSuggestion, action: 'add' | 'dismiss'): Promise<void> {
  if (!userId) throw new Error('Sign in to save this change.');
  const state = await loadDeepFindReview(client, leadId);
  if (action === 'dismiss') {
    const keys = Array.isArray(state.lead.dismissed_suggestions) ? state.lead.dismissed_suggestions as string[] : [];
    const { error } = await client.from('leads').update({ dismissed_suggestions: [...new Set([...keys, suggestionKey(suggestion)])] })
      .eq('id', leadId).eq('updated_at', state.lead.updated_at).select('id').single();
    if (error) throw new Error(FAILURE);
    return;
  }
  const plan = planSuggestionAdd(suggestion, state.lead, state.contacts);
  if (plan.kind === 'none') return;
  if (plan.kind === 'lead_update') {
    const { error } = await client.from('leads').update(plan.patch).eq('id', leadId).eq('updated_at', state.lead.updated_at).select('id').single();
    if (error) throw new Error(FAILURE);
  } else if (plan.kind === 'contact_update') {
    const old = state.contacts.find((c) => c.id === plan.id)!;
    let query = client.from('decision_maker_candidates').update(plan.patch).eq('id', plan.id).eq('lead_id', leadId).is('dismissed_at', null);
    query = old.email === null ? query.is('email', null) : query.eq('email', old.email ?? '');
    const { error } = await query.select('id').single();
    if (error) throw new Error(FAILURE);
  } else {
    const { error } = await client.from('decision_maker_candidates').insert({ ...plan.patch, lead_id: leadId, created_by: userId }).select('id').single();
    if (error) throw new Error(FAILURE);
  }
}

/** Historical candidate JSON stays as a record; lead state clears the active choice across every run. */
export async function rejectDeepFindCompanies(client: SupabaseClient, leadId: string, country: 'IE' | 'US' | 'OTHER' | 'unlisted'): Promise<string> {
  const patch = { registry_candidates_rejected: true, ...(country === 'unlisted' ? {} : { country }) };
  const { data, error } = await client.from('leads').update(patch).eq('id', leadId).select('country, registry_candidates_rejected').single();
  if (error || !data) throw new Error(FAILURE);
  return registrySkipReason(data) === 'not_uk' ? 'Companies House skipped: this is not a UK company.'
    : 'Company matches dismissed. Deep find will not ask again for this lead.';
}
