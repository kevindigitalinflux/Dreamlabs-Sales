// supabase/functions/find-decision-makers/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';
import { findAndStoreDecisionMakers } from '../_shared/findDecisionMakers.ts';
import { validateContactEdit } from '../_shared/contacts.ts';
import { isLinkedinUrl } from '../_shared/knownPerson.ts';
import { runKnownPerson } from '../_shared/knownPersonFlow.ts';

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

  let body: { lead_ids?: string[]; known_person?: unknown };
  try {
    body = (await req.json()) as { lead_ids?: string[]; known_person?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers);
  }
  if (typeof body !== 'object' || body === null) return json({ error: 'Invalid JSON body' }, 400, headers);
  const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.map(String) : [];
  if (leadIds.length === 0) return json({ error: 'lead_ids is required' }, 400, headers);
  if (leadIds.length > MAX_LEADS) return json({ error: `Select ${MAX_LEADS} or fewer leads at once` }, 400, headers);

  let knownPerson: ReturnType<typeof validateContactEdit> | null = null;
  let usePaidLookups = true;
  if (body.known_person !== undefined && body.known_person !== null) {
    if (leadIds.length !== 1) return json({ error: 'known_person works for one lead at a time' }, 400, headers);
    const kp = body.known_person as Record<string, unknown>;
    if (typeof kp !== 'object' || Array.isArray(kp)) return json({ error: 'known_person must be an object' }, 400, headers);
    const s = (v: unknown) => (typeof v === 'string' ? v : null);
    knownPerson = validateContactEdit({
      kind: 'person', first_name: s(kp.first_name), last_name: s(kp.last_name), title: s(kp.title),
      email: s(kp.email), linkedin_url: s(kp.linkedin_url),
    });
    if (!knownPerson.ok) return json({ error: knownPerson.error }, 400, headers);
    if (knownPerson.value.linkedin_url && !isLinkedinUrl(knownPerson.value.linkedin_url)) {
      return json({ error: 'The LinkedIn link must be a linkedin.com address.' }, 400, headers);
    }
    usePaidLookups = kp.use_paid_lookups !== false;
  }

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
  if (resolvedLeads.length === 0) {
    return knownPerson ? json({ error: 'Lead not found' }, 404, headers) : json({ results: [] }, 200, headers);
  }

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

  if (knownPerson && knownPerson.ok) {
    // Targeted lookups only: the generic domain search is skipped so provider cost stays bounded.
    const outcome = await runKnownPerson(client, service, resolvedLeads[0]!, knownPerson.value, userData.user.id, { hunterKey, apolloKey }, usePaidLookups);
    if (outcome.error) return json({ error: outcome.error }, outcome.status, headers);
    return json({
      results: [{ lead_id: resolvedLeads[0]!.id, candidates: outcome.candidates }],
      known_person: outcome.known_person,
    }, 200, headers);
  }

  const perLead = await runBounded(resolvedLeads, 5, async (lead) => {
    const candidates = await findAndStoreDecisionMakers(service, lead, { hunterKey, apolloKey }, userData.user.id);
    return { lead_id: lead.id, candidates };
  });

  const results = perLead.filter((r) => r.candidates.length > 0);
  return json({ results }, 200, headers);
});
