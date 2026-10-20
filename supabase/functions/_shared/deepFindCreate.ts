import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// The database source allow-list (050) distinguishes provider contacts from manual/dream_agent edits.
const RESTORABLE_SOURCES = ['companies_house', 'cro', 'hunter', 'apollo'];
type Access = { ok: true; orgId: string; restored: Record<string, number> }
  | { ok: false; result: { status: number; body: { error: string } } };

/** Check the entire selection before any restoration. Never restore a partially authorized selection. */
export async function authorizeDeepFindCreate(
  client: SupabaseClient, service: SupabaseClient, callerId: string, leadIds: string[], startFresh = false,
): Promise<Access> {
  const fail = (status: number, error: string): Access => ({ ok: false, result: { status, body: { error } } });
  const { data, error } = await client.from('leads').select('id, org_id').in('id', leadIds);
  if (error) return fail(500, 'Could not read the selected leads');
  const leads = (data ?? []) as { id: string; org_id: string }[];
  if (!leadIds.length || leads.length !== leadIds.length || leads.some(l => !leadIds.includes(l.id))) return fail(403, 'Some selected leads are not accessible');
  const orgId = leads[0]!.org_id;
  if (leads.some(l => l.org_id !== orgId)) return fail(403, 'Selected leads span more than one organisation');
  const { data: member, error: memberError } = await client.from('org_members').select('role').eq('org_id', orgId).eq('user_id', callerId).maybeSingle();
  if (memberError || !member) return fail(403, 'Not a member of this organisation');
  for (const lead of leads) {
    const { data: allowed, error: editError } = await client.rpc('can_edit_lead', { target_lead: lead.id });
    if (editError || allowed !== true) return fail(403, 'You can only run Deep find on leads you can edit');
  }
  const restored: Record<string, number> = {};
  if (startFresh) for (const lead of leads) {
    // Scope the lead update by both organization and selected id before touching its child contacts.
    const { data: updated, error: leadError } = await service.from('leads').update({ dismissed_suggestions: [] })
      .eq('org_id', orgId).eq('id', lead.id).select('id');
    if (leadError || updated?.length !== 1) return fail(500, 'Could not clear dismissed suggestions');
    const { data: contacts, error: contactError } = await service.from('decision_maker_candidates').update({ dismissed_at: null })
      .eq('lead_id', lead.id).in('source', RESTORABLE_SOURCES).not('dismissed_at', 'is', null).select('id');
    if (contactError) return fail(500, 'Could not restore dismissed people');
    restored[lead.id] = contacts?.length ?? 0;
  }
  return { ok: true, orgId, restored };
}
