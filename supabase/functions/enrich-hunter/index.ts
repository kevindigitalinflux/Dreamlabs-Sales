// supabase/functions/enrich-hunter/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { bareDomain } from '../_shared/domain.ts';

interface HunterEmail { value: string; type: string; confidence: number; first_name?: string; last_name?: string; position?: string }

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

  const body = (await req.json()) as { raw_lead_id?: string };
  const rawLeadId = String(body.raw_lead_id ?? '');
  if (!rawLeadId) return json({ error: 'raw_lead_id is required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Derive org_id from the lead itself via a service-role join — never trust a
  // client-supplied org_id here. Same fix as enrich-apollo, see its comment.
  const { data: rawLead, error: readErr } = await service
    .from('raw_leads')
    .select('id, website, email, raw_data, scrape_jobs!inner(org_id)')
    .eq('id', rawLeadId).single();
  if (readErr || !rawLead) return json({ error: 'Lead not found' }, 404, headers);
  const orgId = (rawLead.scrape_jobs as unknown as { org_id: string }).org_id;

  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'hunter');
  if (!apiKey) return json({ error: 'No Hunter API key configured for this organization' }, 400, headers);

  const domain = bareDomain(rawLead.website ?? '');
  if (!domain) return json({ error: 'This lead has no usable website domain to search' }, 400, headers);

  const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`);
  if (!res.ok) return json({ error: `Hunter HTTP ${res.status}` }, 502, headers);
  const data = await res.json() as { data?: { emails?: HunterEmail[] } };
  const emails = data.data?.emails ?? [];
  if (emails.length === 0) return json({ error: 'Hunter found no emails for this domain' }, 404, headers);

  // Highest-confidence email wins; only overwrite the lead's email if we don't already have a better one.
  const best = [...emails].sort((a, b) => b.confidence - a.confidence)[0];

  const existingRawData = (rawLead.raw_data ?? {}) as Record<string, unknown>;
  const existingEnrichment = (existingRawData.enrichment ?? {}) as Record<string, unknown>;
  const { error: updateErr } = await service.from('raw_leads').update({
    email: rawLead.email ?? best.value,
    raw_data: { ...existingRawData, enrichment: { ...existingEnrichment, hunter: { emails } } },
  }).eq('id', rawLeadId);
  if (updateErr) return json({ error: updateErr.message }, 500, headers);

  return json({ ok: true, best_email: best.value, confidence: best.confidence }, 200, headers);
});
