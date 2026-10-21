import type { SupabaseClient } from '@supabase/supabase-js';
import { deepFindErrorCode } from './deepFindErrors';
import type { ReviewSuggestion } from '../../supabase/functions/_shared/deepFindSuggestions';

/** One person whose saved address does not exist, with the best candidate and the other formats. */
export interface ReplacementGroup { contactId: string; name: string; oldEmail: string; primary: ReviewSuggestion; others: ReviewSuggestion[] }

const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Splits replacement suggestions (grouped per contact, top candidate first) from everything else. */
export function groupReplacements(suggestions: ReviewSuggestion[]): { groups: ReplacementGroup[]; rest: ReviewSuggestion[] } {
  const byContact = new Map<string, ReviewSuggestion[]>();
  const rest: ReviewSuggestion[] = [];
  for (const s of suggestions) {
    const id = s.replaces_saved_email?.contact_id;
    if (!id || !s.value) { rest.push(s); continue; }
    byContact.set(id, [...(byContact.get(id) ?? []), s]);
  }
  const groups = [...byContact.entries()].map(([contactId, list]) => {
    const sorted = [...list.filter(s => s.guess_rank !== 'other'), ...list.filter(s => s.guess_rank === 'other')];
    return { contactId, name: sorted[0]!.name, oldEmail: sorted[0]!.replaces_saved_email!.email, primary: sorted[0]!, others: sorted.slice(1) };
  });
  return { groups, rest };
}

export type ReplaceResult = 'replaced' | 'changed';
export const replaceNotice = (r: ReplaceResult): string => r === 'replaced' ? 'Replaced' : 'Changed since, left as is.';

/**
 * Session client (RLS). Updates only that contact's email, only while it still equals the old address
 * (case-insensitive read, exact-value compare-and-set write). Never touches sequences or the follow-up setting.
 */
export async function replaceSavedEmail(client: SupabaseClient, userId: string | null, leadId: string, s: ReviewSuggestion): Promise<ReplaceResult> {
  if (!userId) throw new Error('Sign in to save this change.');
  const evidence = s.replaces_saved_email;
  if (!evidence || !s.value) throw new Error('Could not save this change. Refresh and try again.');
  const fail = (error: unknown) => Object.assign(new Error('Could not save this change. Refresh and try again.'), { code: deepFindErrorCode(error) });
  const read = await client.from('decision_maker_candidates').select('id, email, dismissed_at').eq('id', evidence.contact_id).eq('lead_id', leadId).maybeSingle();
  if (read.error) throw fail(read.error);
  const current = read.data as { email?: string | null; dismissed_at?: string | null } | null;
  if (!current || current.dismissed_at || !current.email || !same(current.email, evidence.email)) return 'changed';
  const write = await client.from('decision_maker_candidates').update({ email: s.value.trim() })
    .eq('id', evidence.contact_id).eq('lead_id', leadId).is('dismissed_at', null).eq('email', current.email).select('id');
  if (write.error) throw fail(write.error);
  return write.data?.length ? 'replaced' : 'changed';
}
