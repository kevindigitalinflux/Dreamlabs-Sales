import { supabase } from './supabase';
import { readableInvokeError } from './invokeError';

/** Result of starting a Deep find: the run id, or a readable error. */
export type StartDeepFindResult = { runId: string; queued: number; alreadyRunning: number } | { error: string };

/**
 * Starts a Deep find for up to 25 leads with the given credit caps. The server checks every lead belongs to the
 * caller's organisation and that the caller can edit it, then works through them in the background.
 */
export async function startDeepFind(leadIds: string[], caps: { hunter: number; ai: number }): Promise<StartDeepFindResult> {
  const { data, error } = await supabase.functions.invoke('run-deep-find', { body: { action: 'create', lead_ids: leadIds, caps } });
  if (error) return { error: await readableInvokeError(error) };
  const d = (data ?? {}) as { run_id?: unknown; queued?: unknown; already_running?: unknown; error?: unknown };
  if (typeof d.error === 'string') return { error: d.error };
  if (typeof d.run_id !== 'string') return { error: 'Deep find did not start. Please try again.' };
  return { runId: d.run_id, queued: Number(d.queued) || 0, alreadyRunning: Number(d.already_running) || 0 };
}

/** Stops a Deep find (its creator or an org admin). Leads not yet searched are skipped. Returns an error or null. */
export async function cancelDeepFind(runId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('run-deep-find', { body: { action: 'cancel', run_id: runId } });
  if (error) return readableInvokeError(error);
  const d = (data ?? {}) as { error?: unknown };
  return typeof d.error === 'string' ? d.error : null;
}
