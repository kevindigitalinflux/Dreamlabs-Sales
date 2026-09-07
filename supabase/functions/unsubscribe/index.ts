// supabase/functions/unsubscribe/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

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

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Rate-limited by caller IP (not lead_id) — a per-lead limit alone would
  // let one abusive IP work around it by just varying which lead it targets.
  const clientIp = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const allowed = await checkRateLimit(service, `unsubscribe:${clientIp}`, 20, 10);
  if (!allowed) return json({ error: 'Too many requests, please try again shortly' }, 429, headers);

  let body: { lead_id?: string };
  try {
    body = (await req.json()) as { lead_id?: string };
  } catch {
    return json({ error: 'Invalid request body' }, 400, headers);
  }
  const leadId = String(body.lead_id ?? '');
  if (!leadId) return json({ error: 'lead_id is required' }, 400, headers);

  const { data: lead, error: leadErr } = await service
    .from('leads').select('id, business_name').eq('id', leadId).maybeSingle();
  if (leadErr || !lead) return json({ error: 'Lead not found' }, 404, headers);

  const { error: leadUpdateErr } = await service.from('leads').update({ opted_out: true }).eq('id', leadId);
  if (leadUpdateErr) {
    console.error(`Failed to set opted_out for lead ${leadId}:`, leadUpdateErr.message);
    return json({ error: 'Could not process your request, please try again' }, 500, headers);
  }
  const { error: cancelErr } = await service.from('sequence_enrollments')
    .update({ status: 'cancelled' })
    .eq('lead_id', leadId).in('status', ['active', 'paused']);
  if (cancelErr) {
    console.error(`Failed to cancel enrollments for lead ${leadId} after opt-out:`, cancelErr.message);
  }

  return json({ ok: true, business_name: lead.business_name }, 200, headers);
});
