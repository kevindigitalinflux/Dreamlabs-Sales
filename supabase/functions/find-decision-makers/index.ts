// supabase/functions/find-decision-makers/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';
import { findAndStoreDecisionMakers } from '../_shared/findDecisionMakers.ts';

const MAX_LEADS = 40;

interface LeadRow { id: string; org_id: string; website: string | null }

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

  let body: { lead_ids?: string[] };
  try {
    body = (await req.json()) as { lead_ids?: string[] };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers);
  }
  if (typeof body !== 'object' || body === null) return json({ error: 'Invalid JSON body' }, 400, headers);
  const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.map(String) : [];
  if (leadIds.length === 0) return json({ error: 'lead_ids is required' }, 400, headers);
  if (leadIds.length > MAX_LEADS) return json({ error: `Select ${MAX_LEADS} or fewer leads at once` }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // RLS-scoped read: a caller only gets back leads they're actually allowed
  // to see (can_view_lead policy) — matches enrich-leads-bulk's pattern. The
  // org-membership check below stays as a defensive second layer.
  const { data: leads, error: leadsErr } = await client
    .from('leads').select('id, org_id, website').in('id', leadIds);
  if (leadsErr) return json({ error: leadsErr.message }, 500, headers);
  const resolvedLeads = (leads ?? []) as LeadRow[];
  if (resolvedLeads.length === 0) return json({ results: [] }, 200, headers);

  const orgIds = new Set(resolvedLeads.map((l) => l.org_id));
  if (orgIds.size > 1) return json({ error: 'Selected leads span more than one organization' }, 400, headers);
  const orgId = [...orgIds][0]!;
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const [hunterKey, apolloKey] = await Promise.all([
    resolveOrgApiKey(service, orgId, 'hunter'),
    resolveOrgApiKey(service, orgId, 'apollo'),
  ]);

  const perLead = await runBounded(resolvedLeads, 5, async (lead) => {
    const candidates = await findAndStoreDecisionMakers(service, lead, { hunterKey, apolloKey }, userData.user.id);
    return { lead_id: lead.id, candidates };
  });

  const results = perLead.filter((r) => r.candidates.length > 0);
  return json({ results }, 200, headers);
});
