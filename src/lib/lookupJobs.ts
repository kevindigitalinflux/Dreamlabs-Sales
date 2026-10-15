import { supabase } from './supabase';
import { readableInvokeError } from './invokeError';
export interface LookupStarted { job_id: string; queued: number }
export async function createLookupJob(kind: 'enrich' | 'decision_makers', leadIds: string[]): Promise<LookupStarted> {
  const { data, error } = await supabase.functions.invoke('run-lookup-jobs', { body: { kind, lead_ids: leadIds } });
  if (error) throw new Error(await readableInvokeError(error));
  if (data?.error) throw new Error(data.error);
  if (typeof data?.job_id !== 'string' || !Number.isInteger(data?.queued) || data.queued < 1)
    throw new Error('The lookup could not be started. Try again.');
  return { job_id: data.job_id, queued: data.queued };
}
