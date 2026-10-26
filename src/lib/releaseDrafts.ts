import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftLog } from '../hooks/useDrafts';

const INTERRUPTED_PREFIX = 'Interrupted while sending;';

/** Load only bulk-safe drafts. A missing link lookup never makes an Autopilot draft releasable. */
export async function loadReleaseDrafts(service: SupabaseClient, orgId: string | null): Promise<{ drafts: DraftLog[]; error: string | null }> {
  if (!orgId) return { drafts: [], error: null };
  try {
    const { data, error } = await service.from('email_logs').select('*, lead:leads(id, business_name)')
      .in('status', ['draft', 'failed']).eq('org_id', orgId).order('sent_at', { ascending: false });
    if (error) throw new Error('Draft lookup failed');
    const drafts = (data ?? []) as DraftLog[];
    const linked = new Set<string>();
    // Keep PostgREST URLs bounded even for a large review queue.
    for (let start = 0; start < drafts.length; start += 100) {
      const { data: rows, error: linkError } = await service.from('autopilot_run_leads').select('email_log_id')
        .in('email_log_id', drafts.slice(start, start + 100).map(d => d.id));
      if (linkError) throw new Error('Autopilot draft lookup failed');
      for (const row of rows ?? []) if (typeof row.email_log_id === 'string') linked.add(row.email_log_id);
    }
    return { drafts: drafts.filter(d => !linked.has(d.id) && !d.error_message?.startsWith(INTERRUPTED_PREFIX)), error: null };
  } catch {
    console.error('release queue: could not check draft safety');
    return { drafts: [], error: 'Could not check which emails are safe to release. Please try again.' };
  }
}
