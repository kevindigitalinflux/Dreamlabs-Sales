// supabase/functions/enrich-apollo/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { bareDomain } from '../_shared/domain.ts';

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
  // client-supplied org_id here. (Found in Task 5's review: a caller who owns
  // a lead in Org A could otherwise pass org_id=OrgB in the body and steal
  // Org B's Apollo credits to enrich Org A's lead. Deriving org_id from the
  // lead's own scrape_job closes this off entirely — there's no org_id
  // parameter left to spoof.)
  const { data: rawLead, error: readErr } = await service
    .from('raw_leads')
    .select('id, website, email, owner_name, raw_data, scrape_jobs!inner(org_id)')
    .eq('id', rawLeadId).single();
  if (readErr || !rawLead) return json({ error: 'Lead not found' }, 404, headers);
  const orgId = (rawLead.scrape_jobs as unknown as { org_id: string }).org_id;

  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'apollo');
  if (!apiKey) return json({ error: 'No Apollo API key configured for this organization' }, 400, headers);

  const domain = bareDomain(rawLead.website ?? '');
  if (!domain) return json({ error: 'This lead has no usable website domain to enrich against' }, 400, headers);

  const res = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return json({ error: `Apollo HTTP ${res.status}` }, 502, headers);
  const data = await res.json() as { organization?: { primary_phone?: { number?: string }; name?: string } };
  const org = data.organization;
  if (!org) return json({ error: 'Apollo found no match for this domain' }, 404, headers);

  const existingRawData = (rawLead.raw_data ?? {}) as Record<string, unknown>;
  const existingEnrichment = (existingRawData.enrichment ?? {}) as Record<string, unknown>;
  const { error: updateErr } = await service.from('raw_leads').update({
    raw_data: { ...existingRawData, enrichment: { ...existingEnrichment, apollo: org } },
  }).eq('id', rawLeadId);
  if (updateErr) return json({ error: updateErr.message }, 500, headers);

  return json({ ok: true, organization: org }, 200, headers);
});
