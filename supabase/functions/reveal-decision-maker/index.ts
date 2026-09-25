// supabase/functions/reveal-decision-maker/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { revealApolloPerson } from '../_shared/apolloPeopleSearch.ts';
import { computeWebhookToken } from '../_shared/webhookToken.ts';

interface CandidateRow {
  id: string; lead_id: string; source: string; apollo_person_id: string | null;
  leads: { org_id: string };
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  let body: { candidate_id?: string; reveal_email?: boolean; reveal_phone?: boolean };
  try {
    body = (await req.json()) as { candidate_id?: string; reveal_email?: boolean; reveal_phone?: boolean };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers);
  }
  if (typeof body !== 'object' || body === null) return json({ error: 'Invalid JSON body' }, 400, headers);
  const candidateId = String(body.candidate_id ?? '');
  if (!candidateId) return json({ error: 'candidate_id is required' }, 400, headers);
  const revealEmail = body.reveal_email === true;
  const revealPhone = body.reveal_phone === true;
  if (!revealEmail && !revealPhone) return json({ error: 'reveal_email or reveal_phone is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: candidate, error: readErr } = await service
    .from('decision_maker_candidates')
    .select('id, lead_id, source, apollo_person_id, leads!inner(org_id)')
    .eq('id', candidateId).single();
  if (readErr || !candidate) return json({ error: 'Candidate not found' }, 404, headers);
  const row = candidate as unknown as CandidateRow;
  if (row.source !== 'apollo' || !row.apollo_person_id) return json({ error: 'This candidate has nothing to reveal' }, 400, headers);

  const orgId = row.leads.org_id;
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  // Visibility pre-check via the RLS-scoped client, before spending any
  // Apollo credit: org membership alone isn't enough — the caller must also
  // be able to view this specific lead under can_view_lead.
  const { data: visibleLead } = await client.from('leads').select('id').eq('id', row.lead_id).maybeSingle();
  if (!visibleLead) return json({ error: 'Lead not found' }, 404, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'apollo');
  if (!apiKey) return json({ error: 'No Apollo API key configured for this organization' }, 400, headers);

  const webhookSecret = Deno.env.get('APOLLO_WEBHOOK_SECRET');
  if (revealPhone && !webhookSecret) return json({ error: 'Phone reveal is not configured on this deployment' }, 500, headers);
  const webhookUrl = revealPhone
    ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/apollo-phone-webhook?candidate_id=${candidateId}&token=${await computeWebhookToken(webhookSecret!, candidateId)}`
    : undefined;

  const result = await revealApolloPerson(row.apollo_person_id, apiKey, { revealEmail, revealPhone, webhookUrl });
  if (!result) return json({ error: 'Apollo could not reveal this contact' }, 502, headers);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (revealEmail) {
    patch.first_name = result.firstName;
    patch.last_name = result.lastName;
    patch.name_obfuscated = false;
    patch.email = result.email;
    patch.email_revealed = result.email != null;
  }
  if (revealPhone) patch.phone_status = 'pending';

  const { data: updated, error: updateErr } = await service
    .from('decision_maker_candidates').update(patch).eq('id', candidateId).select('*').single();
  if (updateErr) return json({ error: updateErr.message }, 500, headers);

  if (revealEmail && result.email) {
    const leadPatch: Record<string, unknown> = { email: result.email };
    if (result.firstName || result.lastName) leadPatch.owner_name = [result.firstName, result.lastName].filter(Boolean).join(' ');
    await client.from('leads').update(leadPatch).eq('id', row.lead_id);
  }

  return json({ candidate: updated }, 200, headers);
});
