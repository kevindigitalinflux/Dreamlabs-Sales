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

async function fetchFirstOfficer(companyNumber: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { name?: string }[] };
    return data.items?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function runScrapeJob(service: SupabaseClient, jobId: string, orgId: string, icp: IcpParams, apiKey: string) {
  try {
    await service.from('scrape_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', jobId);

    const query = [icp.industry, icp.city ?? icp.location, ...icp.keywords].filter(Boolean).join(' ');
    const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=30`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) throw new Error(`Companies House HTTP ${res.status}`);
    const data = await res.json() as { items?: CHCompany[] };
    const companies = (data.items ?? []).slice(0, 30);

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

  const authHeader = req.headers.get('Authorization') ?? '';
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return json({ error: 'Not signed in' }, 401, headers);

  const body = (await req.json()) as { org_id?: string; icp_raw_input?: string; icp_params?: IcpParams };
  const orgId = String(body.org_id ?? '');
  if (!orgId || !body.icp_params) return json({ error: 'org_id and icp_params are required' }, 400, headers);
  if (body.icp_params.country !== 'GB') return json({ error: 'Companies House only covers UK companies' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Caller must belong to the org they're asking to scrape into — found missing
  // in Task 5's review (Critical: cross-tenant scrape + API-spend theft), fixed
  // here proactively before this code was ever transcribed.
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', userData.user.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'companies_house');
  if (!apiKey) return json({ error: 'No Companies House API key configured for this organization' }, 400, headers);

  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: userData.user.id, icp_raw_input: body.icp_raw_input ?? null,
    icp_params: body.icp_params, sources: ['companies_house'], status: 'pending',
  }).select('id').single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'Could not create job' }, 500, headers);

  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(runScrapeJob(service, job.id, orgId, body.icp_params, apiKey));

  return json({ job_id: job.id }, 200, headers);
});
