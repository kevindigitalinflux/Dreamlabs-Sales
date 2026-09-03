// supabase/functions/scrape-companies-house/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { runBounded } from '../_shared/concurrency.ts';

interface IcpParams {
  industry: string | null; location: string | null; city: string | null;
  country: 'GB' | 'US' | 'other'; keywords: string[];
}

interface CHCompany {
  company_number: string; title: string;
  address_snippet?: string;
}

/**
 * Companies House returns officer names as "SURNAME, Forename Middlename".
 * Reformat to "Forename Middlename SURNAME" so downstream consumers (e.g.
 * templateVars.ts's `owner_name?.split(' ')[0]` for {{first_name}}) get a
 * real first name instead of "SURNAME," with a trailing comma. Falls back to
 * the raw value unchanged if it isn't in the comma-separated format.
 */
function normalizeOfficerName(rawName: string): string {
  const commaIndex = rawName.indexOf(', ');
  if (commaIndex === -1) return rawName;
  const surname = rawName.slice(0, commaIndex);
  const forenames = rawName.slice(commaIndex + 2);
  return `${forenames} ${surname}`;
}

async function fetchFirstOfficer(companyNumber: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { name?: string }[] };
    const rawName = data.items?.[0]?.name;
    return rawName ? normalizeOfficerName(rawName) : null;
  } catch {
    return null;
  }
}

async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string, cap: number) {
  try {
    await service.from('scrape_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);

    const query = [icp.industry, icp.city ?? icp.location, ...icp.keywords].filter(Boolean).join(' ');
    const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=${cap}`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) throw new Error(`Companies House HTTP ${res.status}`);
    const data = await res.json() as { items?: CHCompany[] };
    const companies = (data.items ?? []).slice(0, cap);

    const { data: existingLeads } = await service.from('leads').select('business_name, city').eq('org_id', orgId);
    const { data: existingRaw } = await service.from('raw_leads')
      .select('business_name, city, scrape_jobs!inner(org_id)').eq('scrape_jobs.org_id', orgId).eq('status', 'pending');
    const seen = [...(existingLeads ?? []), ...(existingRaw ?? [])];
    function isDuplicate(businessName: string): boolean {
      return seen.some((s) => s.business_name.toLowerCase() === businessName.toLowerCase());
    }

    const owners = await runBounded(companies, 5, (c) => fetchFirstOfficer(c.company_number, apiKey));

    const rows = companies.map((c, i) => ({
      scrape_job_id: jobId,
      business_name: c.title,
      owner_name: owners[i],
      address: c.address_snippet ?? null,
      city: icp.city ?? null,
      vertical: icp.industry,
      source: 'companies_house',
      source_id: c.company_number,
      raw_data: { company: c },
      status: isDuplicate(c.title) ? 'duplicate' : 'pending',
    }));

    if (rows.length > 0) {
      const { error: insertErr } = await service.from('raw_leads').insert(rows);
      if (insertErr) throw new Error(insertErr.message);
    }

    await service.from('scrape_jobs').update({
      status: 'completed', results_count: rows.length, completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  } catch (e) {
    await service.from('scrape_jobs').update({
      status: 'failed', error_message: e instanceof Error ? e.message : String(e), completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Trusted service-to-service trigger (run-autopilot cron) — same shared-secret
  // pattern as check-sequences/auto-enroll-cold-outreach/check-replies. A
  // service-role key is a valid JWT for the platform gateway's verify_jwt check,
  // but it carries no `sub` claim, so auth.getUser() below can never resolve it
  // to a user — this bypass is the only way for a cron job to reuse this
  // endpoint without duplicating the scrape logic.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const isCronCall = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;

  let callerId: string | null = null;
  if (!isCronCall) {
    const authHeader = req.headers.get('Authorization') ?? '';
    const client = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await client.auth.getUser();
    if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);
    callerId = userData.user.id;
  }

  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams; max_results?: number };
  const orgId = String(body.org_id ?? '');
  if (!orgId || !body.icp_params) return json({ error: 'org_id and icp_params are required' }, 400, headers);
  if (body.icp_params.country !== 'GB') return json({ error: 'Companies House only covers UK companies' }, 400, headers);

  // A cron-triggered call is inherently org-scoped by the caller (run-autopilot
  // only ever passes the org_id of an autopilot_runs row it already fetched via
  // service role) — the membership check exists to stop a signed-in browser
  // user from scraping into an org they don't belong to, which doesn't apply.
  // (Caller-must-belong-to-org itself: Task 5 review fix, unchanged here.)
  if (!isCronCall) {
    const { data: membership } = await service.from('org_members')
      .select('role').eq('org_id', orgId).eq('user_id', callerId!).maybeSingle();
    if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);
  }

  const apiKey = await resolveOrgApiKey(service, orgId, 'companies_house');
  if (!apiKey) return json({ error: 'No Companies House API key configured for this organization' }, 400, headers);

  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: callerId, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['companies_house'], status: 'pending',
  }).select('id').single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'Could not create job' }, 500, headers);

  // Construct the promise outside the optional chain — `a?.b(c())` short-circuits
  // the entire call including argument evaluation when `a` is nullish, so
  // hoisting this out ensures runScrapeJob always actually runs.
  const cap = Math.min(30, body.max_results ?? 30);
  const task = runScrapeJob(service, job.id, orgId, body.icp_params, apiKey, cap);
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(task);

  return json({ job_id: job.id }, 200, headers);
});
