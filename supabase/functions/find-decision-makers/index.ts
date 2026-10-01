// supabase/functions/find-decision-makers/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';
import { bareDomain } from '../_shared/domain.ts';
import { findHunterDecisionMakers } from '../_shared/apolloHunterLookup.ts';
import { searchApolloDecisionMakers } from '../_shared/apolloPeopleSearch.ts';

// A business usually has more than one decision-maker; keep the best few per source.
const MAX_PER_SOURCE = 3;

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
    const domain = bareDomain(lead.website ?? '');
    if (!domain) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };

    const rows: Record<string, unknown>[] = [];

    if (hunterKey) {
      for (const hunter of await findHunterDecisionMakers(lead.website, hunterKey, MAX_PER_SOURCE)) {
        rows.push({
          lead_id: lead.id, source: 'hunter',
          first_name: hunter.firstName, last_name: hunter.lastName, title: hunter.title,
          email: hunter.email, email_revealed: true, name_obfuscated: false,
          linkedin_url: hunter.linkedinUrl,
          created_by: userData.user.id,
        });
      }
    }
    if (apolloKey) {
      for (const apollo of await searchApolloDecisionMakers(domain, apolloKey, MAX_PER_SOURCE)) {
        rows.push({
          lead_id: lead.id, source: 'apollo', apollo_person_id: apollo.apolloPersonId,
          first_name: apollo.firstName, last_name: apollo.lastNameObfuscated, title: apollo.title,
          name_obfuscated: true, email_revealed: false,
          linkedin_url: apollo.linkedinUrl,
          created_by: userData.user.id,
        });
      }
    }

    if (rows.length === 0) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };

    // One row per person (Hunter by email, Apollo by person id) via the
    // generated dedupe_key (migration 039), so re-running never duplicates.
    // ignoreDuplicates (ON CONFLICT DO NOTHING) rather than an overwriting upsert:
    // an overwrite resets email_revealed/email on an Apollo contact whose email
    // was already paid for and revealed. Existing rows are left exactly as they are.
    const { error: upsertErr } = await service
      .from('decision_maker_candidates')
      .upsert(rows, { onConflict: 'lead_id,dedupe_key', ignoreDuplicates: true });
    if (upsertErr) return { lead_id: lead.id, candidates: [] as Record<string, unknown>[] };
    // Everyone stored for this lead (new and from earlier runs), not only this run's inserts.
    const { data: upserted } = await service
      .from('decision_maker_candidates').select('*').eq('lead_id', lead.id).is('dismissed_at', null).order('created_at');

    // Auto-capture: any candidate with a LinkedIn URL gets a linked
    // linkedin_contacts row immediately, so it shows up in the LinkedIn
    // queue without a separate action (matches the controller-approved
    // design: "automatic, as soon as found"). context_signal stays null --
    // see this plan's Global Constraints for why. Idempotent via the
    // unique index on decision_maker_candidate_id (Task 1; made non-partial
    // in migration 035 so PostgREST's onConflict inference can target it).
    for (const candidate of (upserted ?? []) as { id: string; first_name: string | null; last_name: string | null; linkedin_url: string | null }[]) {
      if (!candidate.linkedin_url) continue;
      const fullName = `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() || 'Unknown';
      // Best-effort: auto-capture is additive, never load-bearing for the
      // decision-maker search itself (matches this plan's Error Handling
      // section and pipeline-shares' notifyShare pattern) -- log and move on
      // rather than failing the whole request.
      const { error: linkedinErr } = await service.from('linkedin_contacts').upsert({
        org_id: orgId,
        lead_id: lead.id,
        decision_maker_candidate_id: candidate.id,
        full_name: fullName,
        linkedin_url: candidate.linkedin_url,
        context_signal: null,
        created_by: userData.user.id,
      }, { onConflict: 'decision_maker_candidate_id' });
      if (linkedinErr) console.error('Failed to auto-capture linkedin_contacts row:', linkedinErr);
    }

    return { lead_id: lead.id, candidates: upserted ?? [] };
  });

  const results = perLead.filter((r) => r.candidates.length > 0);
  return json({ results }, 200, headers);
});
