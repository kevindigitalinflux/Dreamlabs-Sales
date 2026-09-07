// supabase/functions/unsubscribe/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

/**
 * Public, unauthenticated endpoint — a prospect clicking an unsubscribe link
 * in an outreach email is never logged into this app. Sets leads.opted_out
 * and cancels any active/paused enrollment for that lead so nothing already
 * queued goes out either.
 */
Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const body = (await req.json()) as { lead_id?: string };
  const leadId = String(body.lead_id ?? '');
  if (!leadId) return json({ error: 'lead_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: lead, error: leadErr } = await service
    .from('leads').select('id, business_name').eq('id', leadId).maybeSingle();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);

  await service.from('leads').update({ opted_out: true }).eq('id', leadId);
  await service.from('sequence_enrollments')
    .update({ status: 'cancelled' })
    .eq('lead_id', leadId).in('status', ['active', 'paused']);

  return json({ ok: true, business_name: lead.business_name }, 200, headers);
});
