// supabase/functions/enrich-leads-bulk/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';
import { scrapeWebsiteContact } from '../_shared/websiteContact.ts';
import { lookupCompaniesHouseOfficer } from '../_shared/companiesHouse.ts';
import { lookupOpenCorporatesOfficer } from '../_shared/openCorporates.ts';
import { lookupApolloPhone, lookupHunterEmail } from '../_shared/apolloHunterLookup.ts';

const MAX_LEADS = 40;

interface LeadRow {
  id: string; org_id: string; business_name: string;
  website: string | null; email: string | null; phone: string | null; owner_name: string | null;
}

// Deno copy of src/types/index.ts's EnrichableField/EnrichmentResult — keep
// the two in sync (same convention as templateVars.ts's Deno/browser split).
type Field = 'email' | 'phone' | 'owner_name';

interface EnrichResult {
  lead_id: string;
  proposed: Partial<Record<Field, string>>;
  source: Partial<Record<Field, string>>;
}

async function enrichOneLead(
  lead: LeadRow,
  keys: { companiesHouse: string | null; openCorporates: string | null; apollo: string | null; hunter: string | null },
): Promise<EnrichResult | null> {
  const proposed: Partial<Record<Field, string>> = {};
  const source: Partial<Record<Field, string>> = {};

  // 1. Website scrape — free, no key required.
  const { email: siteEmail, phone: sitePhone } = await scrapeWebsiteContact(lead.website);
  if (siteEmail && siteEmail !== lead.email) { proposed.email = siteEmail; source.email = 'website'; }
  if (sitePhone && sitePhone !== lead.phone) { proposed.phone = sitePhone; source.phone = 'website'; }

  // 2. Companies House (UK) — free registration. Skip if the lead already has an owner_name.
  if (!lead.owner_name && keys.companiesHouse) {
    const officer = await lookupCompaniesHouseOfficer(lead.business_name, keys.companiesHouse);
    if (officer && officer !== lead.owner_name) { proposed.owner_name = officer; source.owner_name = 'companies_house'; }
  }

  // 3. OpenCorporates (non-UK best-effort) — only if Companies House found nothing AND the lead has no owner_name.
  if (!proposed.owner_name && !lead.owner_name && keys.openCorporates) {
    const officer = await lookupOpenCorporatesOfficer(lead.business_name, keys.openCorporates);
    if (officer && officer !== lead.owner_name) { proposed.owner_name = officer; source.owner_name = 'opencorporates'; }
  }

  // 4. Apollo/Hunter — paid, opt-in, only for fields still blank after 1–3 AND not already on the lead.
  if (!proposed.email && !lead.email && keys.hunter && lead.website) {
    const email = await lookupHunterEmail(lead.website, keys.hunter);
    if (email && email !== lead.email) { proposed.email = email; source.email = 'hunter'; }
  }
  if (!proposed.phone && !lead.phone && keys.apollo && lead.website) {
    const phone = await lookupApolloPhone(lead.website, keys.apollo);
    if (phone && phone !== lead.phone) { proposed.phone = phone; source.phone = 'apollo'; }
  }

  if (Object.keys(proposed).length === 0) return null;
  return { lead_id: lead.id, proposed, source };
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

  let body: { lead_ids?: string[] };
  try {
    body = (await req.json()) as { lead_ids?: string[] };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers);
  }
  const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.map(String) : [];
  if (leadIds.length === 0) return json({ error: 'lead_ids is required' }, 400, headers);
  if (leadIds.length > MAX_LEADS) return json({ error: `Select ${MAX_LEADS} or fewer leads at once` }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // RLS-scoped read: a caller only gets back the leads they're actually
  // allowed to see (can_view_lead policy) — any requested id outside that
  // scope silently drops out of resolvedLeads below, same as an id that
  // doesn't exist at all. The org-membership check below stays as a
  // defensive second layer.
  const { data: leads, error: leadsErr } = await client
    .from('leads').select('id, org_id, business_name, website, email, phone, owner_name').in('id', leadIds);
  if (leadsErr) return json({ error: leadsErr.message }, 500, headers);
  const resolvedLeads = (leads ?? []) as LeadRow[];
  if (resolvedLeads.length === 0) return json({ results: [] }, 200, headers);

  // Every requested lead must belong to the same org, and the caller must be
  // a member of it — never trust a client-supplied org_id, derive it from
  // the leads themselves (same discipline as enrich-apollo/enrich-hunter).
  const orgIds = new Set(resolvedLeads.map((l) => l.org_id));
  if (orgIds.size > 1) return json({ error: 'Selected leads span more than one organization' }, 400, headers);
  const orgId = [...orgIds][0]!;
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const [companiesHouse, openCorporates, apollo, hunter] = await Promise.all([
    resolveOrgApiKey(service, orgId, 'companies_house'),
    resolveOrgApiKey(service, orgId, 'opencorporates'),
    resolveOrgApiKey(service, orgId, 'apollo'),
    resolveOrgApiKey(service, orgId, 'hunter'),
  ]);
  const keys = { companiesHouse, openCorporates, apollo, hunter };

  const enriched = await runBounded(resolvedLeads, 5, (lead) => enrichOneLead(lead, keys));
  const results = enriched.filter((r): r is EnrichResult => r !== null);

  return json({ results }, 200, headers);
});
