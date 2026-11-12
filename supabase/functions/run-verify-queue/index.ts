// Cron-only background checks. No sends, enrollment, browser authorization or provider keys in responses.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { cronSecretMatches } from '../_shared/timingSafe.ts';
import { drainQueue } from '../_shared/verifyQueue.ts';
import { createQueueDeps } from '../_shared/verifyQueueService.ts';

Deno.serve(async req => {
  const startedAt = Date.now();
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, {});
  if (!await cronSecretMatches(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET'))) return json({ error: 'Forbidden' }, 403, {});
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const result = await drainQueue(createQueueDeps(service, Deno.env.get('WORKER_SHARED_ORG_IDS')), startedAt, 140_000);
    return json(result, 200, {});
  } catch (error) {
    console.error('Background check tick failed', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'Background checks could not finish' }, 500, {});
  }
});
