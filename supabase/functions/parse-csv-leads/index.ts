import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { mapCsvColumns } from '../_shared/ai.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';

const LEAD_FIELDS = ['business_name', 'owner_name', 'phone', 'email', 'website', 'address', 'city', 'postcode', 'vertical'] as const;
type LeadField = typeof LEAD_FIELDS[number];

function sanitizeMapping(raw: unknown, headers: string[]): Partial<Record<LeadField, string>> {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = (raw as { mapping?: unknown }).mapping;
  if (typeof r !== 'object' || r === null) return {};
  const entries = Object.entries(r as Record<string, unknown>);
  const result: Partial<Record<LeadField, string>> = {};
  const usedFields = new Set<string>();
  for (const [header, field] of entries) {
    if (!headers.includes(header)) continue;
    if (typeof field !== 'string' || !LEAD_FIELDS.includes(field as LeadField)) continue;
    if (usedFields.has(field)) continue; // first mapping to a given field wins
    result[field as LeadField] = header;
    usedFields.add(field);
  }
  return result;
}

function isDuplicate(seen: { business_name: string; city: string | null; email: string | null }[], businessName: string, city: string | null, email: string | null): boolean {
  return seen.some((s) =>
    (s.email && email && s.email.toLowerCase() === email.toLowerCase()) ||
    (s.business_name.toLowerCase() === businessName.toLowerCase() && (s.city ?? '').toLowerCase() === (city ?? '').toLowerCase()),
  );
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const authHeader = req.headers.get('Authorization') ?? '';
  const client: SupabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await client.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json({ error: 'Not signed in' }, 401, headers);

  const body = (await req.json()) as {
    org_id?: string; pipeline_id?: string; pipeline_is_new?: boolean; pipeline_name?: string;
    csv_headers?: string[]; rows?: string[][];
  };
  const orgId = String(body.org_id ?? '');
  const csvHeaders = Array.isArray(body.csv_headers) ? body.csv_headers : [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!orgId || csvHeaders.length === 0 || rows.length === 0) return json({ error: 'org_id, csv_headers, and rows are required' }, 400, headers);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  // Membership check must happen before any org-scoped work below (pipeline
  // creation, the AI call/resolveOrgApiKey, and the existing-leads duplicate
  // query) — org_id is client-supplied and every one of those queries after
  // this point runs on the service-role client, which bypasses RLS entirely.
  // Without this check, any authenticated user in ANY org could pass a
  // different org's org_id and use duplicate_count as a cross-org data
  // oracle (and burn that org's Gemini quota in the process).
  const { data: membership } = await service.from('org_members')
    .select('role').eq('org_id', orgId).eq('user_id', caller.id).maybeSingle();
  if (!membership) return json({ error: 'Not a member of this organization' }, 403, headers);

  // Resolve the target pipeline. New-pipeline creation goes through the caller's
  // own RLS-scoped client (not service role) so pipelines_insert's own checks
  // (org membership, is_default=false, created_by=self) apply exactly as they
  // would from the UI — this function isn't a privilege-widening shortcut.
  let pipelineId = String(body.pipeline_id ?? '');
  if (body.pipeline_is_new) {
    const name = String(body.pipeline_name ?? '').trim();
    if (!name) return json({ error: 'pipeline_name is required for a new pipeline' }, 400, headers);
    const { data: newPipeline, error: pipelineErr } = await client
      .from('pipelines').insert({ org_id: orgId, name, created_by: caller.id }).select('id').single();
    if (pipelineErr || !newPipeline) return json({ error: pipelineErr?.message ?? 'Could not create pipeline' }, 400, headers);
    pipelineId = newPipeline.id as string;
  }
  if (!pipelineId) return json({ error: 'pipeline_id is required' }, 400, headers);

  const apiKey = await resolveOrgApiKey(service, orgId, 'gemini');
  if (!apiKey) return json({ error: 'AI unavailable — configure a Gemini key for this organization' }, 400, headers);

  let mapping: Partial<Record<LeadField, string>>;
  try {
    const raw = await mapCsvColumns({ headers: csvHeaders, sampleRows: rows.slice(0, 5), apiKey });
    mapping = sanitizeMapping(raw, csvHeaders);
  } catch (e) {
    console.error('mapCsvColumns failed:', e);
    return json({ error: 'AI unavailable' }, 400, headers);
  }
  if (!mapping.business_name) return json({ error: 'Could not identify a business name column in this file' }, 400, headers);

  const { data: existingLeads } = await service.from('leads').select('business_name, city, email').eq('org_id', orgId);
  const seen = (existingLeads ?? []) as { business_name: string; city: string | null; email: string | null }[];

  const { data: job, error: jobErr } = await service.from('scrape_jobs').insert({
    org_id: orgId, created_by: caller.id, icp_raw_input: null, icp_params: null,
    sources: ['csv_upload'], status: 'completed', pipeline_id: pipelineId,
    results_count: rows.length, completed_at: new Date().toISOString(),
  }).select('id').single();
  if (jobErr || !job) return json({ error: jobErr?.message ?? 'Could not create import job' }, 500, headers);

  function cell(row: string[], field: LeadField): string | null {
    const header = mapping[field];
    if (!header) return null;
    const idx = csvHeaders.indexOf(header);
    const value = idx >= 0 ? row[idx]?.trim() : '';
    return value ? value : null;
  }

  let mappedCount = 0;
  let duplicateCount = 0;
  let unmappedCount = 0;
  const toInsert: Record<string, unknown>[] = [];

  for (const row of rows) {
    const businessName = cell(row, 'business_name');
    if (!businessName) { unmappedCount += 1; continue; }
    const city = cell(row, 'city');
    const email = cell(row, 'email');
    const duplicate = isDuplicate(seen, businessName, city, email);
    if (duplicate) duplicateCount += 1; else mappedCount += 1;
    toInsert.push({
      scrape_job_id: job.id, business_name: businessName, owner_name: cell(row, 'owner_name'),
      phone: cell(row, 'phone'), email, website: cell(row, 'website'), address: cell(row, 'address'),
      city, postcode: cell(row, 'postcode'), vertical: cell(row, 'vertical'),
      source: 'csv_upload', status: duplicate ? 'duplicate' : 'pending',
    });
    seen.push({ business_name: businessName, city, email });
  }

  if (toInsert.length > 0) {
    const { error: insertErr } = await service.from('raw_leads').insert(toInsert);
    if (insertErr) return json({ error: insertErr.message }, 500, headers);
  }

  return json({ job_id: job.id, mapped_count: mappedCount, duplicate_count: duplicateCount, unmapped_count: unmappedCount }, 200, headers);
});
