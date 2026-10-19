import type { SupabaseClient } from '@supabase/supabase-js';
import { deepFindErrorCode } from './deepFindErrors';
import { planOwnerFromSuggestion, planTitleUpgrade, planSuggestionAdd, registrySkipReason, roleForPerson, suggestionKey } from '../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewContact, ReviewLead, ReviewSuggestion } from '../../supabase/functions/_shared/deepFindSuggestions';
import { arrayEquality, readAutoApplied, type AutoApplied } from '../../supabase/functions/_shared/deepFindAutoApply';

/** User-session RLS applies. The after-value filter makes concurrent edits a harmless no-op. */
export async function undoDeepFindChange(client: SupabaseClient, userId: string | null, leadId: string, change: AutoApplied): Promise<string> {
  if (!userId) throw new Error('Sign in to undo this change.');
  if (!readAutoApplied([change]).length || (change.table === 'leads' && change.id !== leadId)) throw new Error('Invalid automatic change.');
  const scoped = async () => {
    let query = client.from(change.table).select(change.field === 'website' ? 'website, additional_websites' : change.field).eq('id', change.id);
    if (change.table === 'decision_maker_candidates') query = query.eq('lead_id', leadId);
    const { data, error } = await query.maybeSingle();
    return { data: data as unknown as Record<string, unknown> | null, error };
  };
  const patch: Record<string, unknown> = { [change.field]: change.before };
  let archive: string[] | null | undefined;
  if (change.archivedWebsite) {
    const { data, error } = await scoped();
    if (error) throw failure(error, 'Could not undo this change. Refresh and try again.');
    if (!data) return 'You cannot change this lead';
    if (data.website !== change.after) return 'Changed since, left as is';
    archive = data.additional_websites as string[] | null;
    if (Array.isArray(archive) && archive.includes(change.archivedWebsite)) {
      patch.additional_websites = archive.filter((v) => v !== change.archivedWebsite);
    }
  }
  let query = client.from(change.table).update(patch).eq('id', change.id);
  if (change.table === 'decision_maker_candidates') query = query.eq('lead_id', leadId);
  // PostgREST text[] equality needs an array literal, not JavaScript's comma-joined array string.
  const after = Array.isArray(change.after) ? arrayEquality(change.after) : change.after;
  if (archive !== undefined) query = archive === null ? query.is('additional_websites', null) : query.eq('additional_websites', arrayEquality(archive));
  const { data, error } = await query.eq(change.field, after).select('id');
  if (error) throw failure(error, 'Could not undo this change. Refresh and try again.');
  if (data?.length) return 'Undone.';
  // UPDATE policies may hide a still-readable row. Re-read values to distinguish that from a CAS miss.
  const current = await scoped();
  if (current.error) throw failure(current.error, 'Could not undo this change. Refresh and try again.');
  if (!current.data) return 'You cannot change this lead';
  const sameField = JSON.stringify(current.data[change.field]) === JSON.stringify(change.after);
  const sameArchive = archive === undefined || JSON.stringify(current.data.additional_websites) === JSON.stringify(archive);
  return sameField && sameArchive ? 'You cannot change this lead' : 'Changed since, left as is';
}

export interface ReviewState { lead: ReviewLead & { id: string; updated_at: string }; contacts: ReviewContact[] }
const FAILURE = 'Could not save this change. Refresh and try again.';
export type ReviewResult = 'saved' | 'owner_set' | 'title_set' | 'owner_title_set' | 'none';
/** Role Deep find reported for the person (never the contact's own title), else the suggestion's role. */
export const foundRole = (s: ReviewSuggestion, roles: { name: string; role?: string | null }[]): string | null => roleForPerson(s.name, roles) ?? s.role?.trim() ?? null;
export function reviewNotice(result: ReviewResult, action: 'add' | 'dismiss', role: string | null): string {
  if (result === 'none') return 'Already on this lead';
  if (result === 'owner_title_set') return "Added to lead. Also set as the lead's owner and updated their title.";
  if (result === 'title_set') return `Added to lead. Contact title updated to ${role ?? 'the new role'}.`;
  if (result === 'owner_set') return "Added to lead. Also set as the lead's owner.";
  return action === 'add' ? 'Added to lead. No sequence enrolment was added.' : 'Dismissed.';
}
const failure = (error: unknown, message = FAILURE) => Object.assign(new Error(message), { code: deepFindErrorCode(error) });

/** Session client only. Read failures must not turn existing contacts into an empty list. */
export async function loadDeepFindReview(client: SupabaseClient, leadId: string): Promise<ReviewState> {
  const [lead, contacts] = await Promise.all([
    client.from('leads').select('id, email, additional_emails, dismissed_suggestions, country, registry_candidates_rejected, owner_name, updated_at').eq('id', leadId).single(),
    client.from('decision_maker_candidates').select('id, first_name, last_name, title, email, dismissed_at, linkedin_url').eq('lead_id', leadId),
  ]);
  if (lead.error || contacts.error || !lead.data || !contacts.data) throw failure(lead.error ?? contacts.error, 'Could not load this lead’s review details. Refresh and try again.');
  return { lead: lead.data as ReviewState['lead'], contacts: contacts.data as ReviewContact[] };
}

/** A fresh read and compare-and-set prevent lost array additions and overwriting a concurrent email fill. */
export async function saveDeepFindReview(client: SupabaseClient, userId: string | null, leadId: string, suggestion: ReviewSuggestion, action: 'add' | 'dismiss', roles: { name: string; role?: string | null }[] = []): Promise<ReviewResult> {
  if (!userId) throw new Error('Sign in to save this change.');
  const state = await loadDeepFindReview(client, leadId);
  if (action === 'dismiss') {
    const keys = Array.isArray(state.lead.dismissed_suggestions) ? state.lead.dismissed_suggestions as string[] : [];
    const { error } = await client.from('leads').update({ dismissed_suggestions: [...new Set([...keys, suggestionKey(suggestion)])] })
      .eq('id', leadId).eq('updated_at', state.lead.updated_at).select('id').single();
    if (error) throw failure(error);
    return 'saved';
  }
  const plan = planSuggestionAdd(suggestion, state.lead, state.contacts);
  const role = roleForPerson(suggestion.name, roles, state.contacts) ?? suggestion.role?.trim() ?? null;
  const personName = suggestion.name.trim().replace(/\s+/g, ' ').toLowerCase();
  const existing = suggestion.name.trim() === 'Company contact' || (suggestion.field && suggestion.field !== 'email') ? undefined
    : state.contacts.find((c) => `${String(c.first_name ?? '').trim()} ${String(c.last_name ?? '').trim()}`.trim().replace(/\s+/g, ' ').toLowerCase() === personName);
  const newTitle = existing ? planTitleUpgrade(existing, foundRole(suggestion, roles)) : null;
  if (plan.kind === 'none' && !newTitle) return 'none';
  if (plan.kind === 'lead_update') {
    const { error } = await client.from('leads').update(plan.patch).eq('id', leadId).eq('updated_at', state.lead.updated_at).select('id').single();
    if (error) throw failure(error);
  } else if (plan.kind === 'linkedin_update') {
    const old = state.contacts.find((c) => c.id === plan.id)!;
    let query = client.from('decision_maker_candidates').update(plan.patch).eq('id', plan.id).eq('lead_id', leadId).is('dismissed_at', null);
    query = old.linkedin_url === null || old.linkedin_url === undefined ? query.is('linkedin_url', null) : query.eq('linkedin_url', old.linkedin_url);
    const { error } = await query.select('id').single();
    if (error) throw failure(error);
  } else if (plan.kind === 'contact_update') {
    const old = state.contacts.find((c) => c.id === plan.id)!;
    let query = client.from('decision_maker_candidates').update(plan.patch).eq('id', plan.id).eq('lead_id', leadId).is('dismissed_at', null);
    query = old.email === null ? query.is('email', null) : query.eq('email', old.email ?? '');
    const { error } = await query.select('id').single();
    if (error) throw failure(error);
  } else if (plan.kind === 'contact_insert') {
    const { error } = await client.from('decision_maker_candidates').insert({ ...plan.patch, title: plan.patch.title ?? role, lead_id: leadId, created_by: userId }).select('id').single();
    if (error) throw failure(error);
  }
  let titled = false;
  if (newTitle && existing && (plan.kind === 'contact_update' || plan.kind === 'none')) {
    let query = client.from('decision_maker_candidates').update({ title: newTitle }).eq('id', existing.id).eq('lead_id', leadId).is('dismissed_at', null);
    query = typeof existing.title === 'string' && existing.title.trim() !== '' ? query.eq('title', existing.title) : query.is('title', null);
    const { error } = await query.select('id').single();
    if (error) throw failure(error);
    titled = true;
  }
  const owner = plan.kind === 'lead_update' ? null : planOwnerFromSuggestion(suggestion, role, state.lead);
  if (!owner) return titled ? 'title_set' : 'saved';
  const { error } = await client.from('leads').update({ owner_name: owner }).eq('id', leadId).eq('updated_at', state.lead.updated_at).select('id').single();
  if (error) throw failure(error);
  return titled ? 'owner_title_set' : 'owner_set';
}

/** Historical candidate JSON stays as a record; lead state clears the active choice across every run. */
export async function rejectDeepFindCompanies(client: SupabaseClient, leadId: string, country: 'IE' | 'US' | 'OTHER' | 'unlisted'): Promise<string> {
  const patch = { registry_candidates_rejected: country === 'unlisted', ...(country === 'unlisted' ? {} : { country }) };
  const { data, error } = await client.from('leads').update(patch).eq('id', leadId).select('country, registry_candidates_rejected').single();
  if (error || !data) throw failure(error);
  return registrySkipReason(data) === 'not_uk' ? 'Companies House skipped: this is not a UK company.'
    : 'Company matches dismissed. Deep find will not ask again for this lead.';
}
