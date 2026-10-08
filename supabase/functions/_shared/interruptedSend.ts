// Marks an email_logs row `failed` when a send was interrupted, so a person cannot release the leftover draft by mistake.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const INTERRUPTED_LOG_MESSAGE = 'Interrupted while sending; it may already have been delivered. Check your Sent folder before retrying.';

/** Draft -> failed with an explanatory error (conditional on status draft, so a sent row is never touched). Logs one short line on failure; never throws. */
export async function markLogInterrupted(service: SupabaseClient, logId: string | null | undefined): Promise<void> {
  if (!logId) return;
  try {
    const { error } = await service.from('email_logs').update({ status: 'failed', error_message: INTERRUPTED_LOG_MESSAGE }).eq('id', logId).eq('status', 'draft');
    if (error) console.error('autopilot: could not mark the interrupted email as failed');
  } catch { console.error('autopilot: could not mark the interrupted email as failed'); }
}
