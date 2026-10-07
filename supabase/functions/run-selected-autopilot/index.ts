// supabase/functions/run-selected-autopilot/index.ts
// Engine for selected-leads autopilot runs. `tick` (cron, x-cron-secret) processes every active selected run;
// `start` (signed-in user) processes one run immediately, through the same code path.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { processRun, runTick, type SelectedRun } from '../_shared/selectedAutopilot.ts';

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ error: 'Invalid request' }, 400, headers); }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (body.action === 'tick') {
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'Forbidden' }, 403, headers);
    const processed = await runTick(service, startedAt);
    return json({ ok: true, processed }, 200, headers);
  }

  if (body.action === 'start') {
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData } = await anon.auth.getUser();
    const caller = userData?.user;
    if (!caller) return json({ error: 'Not signed in' }, 401, headers);

    const runId = typeof body.run_id === 'string' ? body.run_id : '';
    if (!runId) return json({ error: 'run_id is required' }, 400, headers);
    const { data: runData } = await service.from('autopilot_runs').select('*').eq('id', runId).maybeSingle();
    const run = runData as SelectedRun | null;
    if (!run) return json({ error: 'Run not found' }, 404, headers);

    const { data: member } = await service.from('org_members').select('role').eq('org_id', run.org_id).eq('user_id', caller.id).maybeSingle();
    if (!member) return json({ error: 'Not allowed' }, 403, headers);
    if (run.created_by !== caller.id && member.role !== 'admin') return json({ error: 'Not allowed' }, 403, headers);
    if (run.mode !== 'selected') return json({ error: 'Not a selected-leads run' }, 400, headers);
    if (run.status !== 'active') return json({ error: 'Run is not active' }, 400, headers);

    try { await processRun(service, run, startedAt); } catch { return json({ error: 'Could not process the run' }, 500, headers); }
    return json({ ok: true }, 200, headers);
  }

  return json({ error: 'Unknown action' }, 400, headers);
});
