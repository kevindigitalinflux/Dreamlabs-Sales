import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Fail-closed lookup shared by daily sequences and selected Autopilot; no age cutoff on human review. */
export async function unsentAutopilotDraft(service: SupabaseClient, orgId: string, leadId: string): Promise<'clear' | 'blocked' | 'unavailable'> {
  try {
    const { data, error } = await service.from('email_logs')
      .select('id, autopilot_run_leads!inner(id)').eq('org_id', orgId).eq('lead_id', leadId)
      .in('status', ['draft', 'failed']).limit(1);
    if (error) {
      console.error('autopilot: could not check unsent draft links');
      return 'unavailable';
    }
    return data?.length ? 'blocked' : 'clear';
  } catch {
    console.error('autopilot: unsent draft lookup failed');
    return 'unavailable';
  }
}
