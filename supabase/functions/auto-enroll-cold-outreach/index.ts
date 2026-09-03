import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { nextSendAtForDeno } from '../_shared/sequenceMathDeno.ts';

const HEADERS = { 'Content-Type': 'application/json' };

/**
 * Cron target: auto-enrolls newly-approved new_lead-stage leads (no existing
 * active/paused enrollment — the schema enforces at most one, so this can
 * never conflict with a manual enrollment) into their org's default
 * cold-outreach sequence. Same shared-secret auth as check-sequences.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, HEADERS);
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json({ error: 'Forbidden' }, 403, HEADERS);
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: sequences } = await service
    .from('email_sequences').select('id, org_id, steps').eq('name', 'Cold outreach default');

  let enrolled = 0;
  for (const seq of sequences ?? []) {
    const sequence = seq as { id: string; org_id: string; steps: { delay_days: number }[] };
    const { data: candidates } = await service
      .from('leads').select('id')
      .eq('org_id', sequence.org_id).eq('stage', 'new_lead');
    for (const lead of candidates ?? []) {
      const { data: existing } = await service.from('sequence_enrollments')
        .select('id').eq('lead_id', (lead as { id: string }).id).in('status', ['active', 'paused']).maybeSingle();
      if (existing) continue;
      const { error } = await service.from('sequence_enrollments').insert({
        lead_id: (lead as { id: string }).id, sequence_id: sequence.id, current_step: 1,
        next_send_at: nextSendAtForDeno(new Date(), sequence.steps, 1),
        status: 'active', enrolled_by: null,
      });
      if (!error) enrolled++;
    }
  }

  return json({ enrolled }, 200, HEADERS);
});
