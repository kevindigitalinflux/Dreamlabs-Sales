import { supabase } from './supabase';

/**
 * Removes a decision-maker candidate the user doesn't consider relevant. It is
 * marked dismissed (not deleted) so the next "Find decision maker" search, which
 * skips people it already has, doesn't bring them straight back. Any LinkedIn
 * entry for that person is skipped too, best effort, so they don't linger in the
 * LinkedIn queue. Returns an error message or null.
 */
export async function dismissDecisionMaker(candidateId: string): Promise<string | null> {
  // .select().single() so a write RLS silently blocks (no edit access to the lead) is
  // reported, not faked as success.
  const { error } = await supabase
    .from('decision_maker_candidates').update({ dismissed_at: new Date().toISOString() }).eq('id', candidateId).select().single();
  if (error) return error.code === 'PGRST116' ? 'You don\'t have permission to remove this person.' : error.message;

  const { data: contacts } = await supabase
    .from('linkedin_contacts').select('id').eq('decision_maker_candidate_id', candidateId);
  const contactIds = (contacts ?? []).map((c) => c.id as string);
  if (contactIds.length > 0) {
    await supabase.from('linkedin_drafts').update({ status: 'skipped' }).in('contact_id', contactIds).in('status', ['draft', 'approved']);
    await supabase.from('linkedin_contacts').update({ status: 'skipped' }).in('id', contactIds).in('status', ['pending', 'drafted', 'approved']);
  }
  return null;
}
