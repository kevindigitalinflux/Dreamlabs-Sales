// Cron-only background checks. No sends, enrollment, browser authorization or provider keys in responses.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { cronSecretMatches } from '../_shared/timingSafe.ts';
import { drainQueue } from '../_shared/verifyQueue.ts';
import { createQueueDeps } from '../_shared/verifyQueueService.ts';

async function background(task: Promise<unknown>): Promise<void> {
  const guarded = task.catch(error => console.error('Background check tick failed', error instanceof Error ? error.name : 'UnknownError'));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(guarded); else await guarded;
}

Deno.serve(async req => {
  const startedAt = Date.now();
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, {});
  if (!await cronSecretMatches(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET'))) return json({ error: 'Forbidden' }, 403, {});
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  await background(drainQueue(createQueueDeps(service, Deno.env.get('WORKER_SHARED_ORG_IDS')), startedAt, 140_000));
  return json({ accepted: true }, 202, {});
});
