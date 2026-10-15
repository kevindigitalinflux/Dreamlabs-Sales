// Gateway JWT verification is disabled for cron. Every action authenticates here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { cronSecretMatches } from '../_shared/timingSafe.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { isUuid } from '../_shared/deepFindRules.ts';
import { lookupErrorKind, parseLookupRequest } from '../_shared/lookupJobRules.ts';
import { runLookupTick } from '../_shared/lookupJobs.ts';

function background(task: Promise<unknown>): void {
  const guarded = task.catch((err) => console.error('lookup jobs: background tick failed', lookupErrorKind(err)));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(guarded);
  // Outside EdgeRuntime cron will pick up the queued row; never wait on providers in the create response.
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (err) { console.error('lookup jobs: invalid request', lookupErrorKind(err)); return json({ error: 'Invalid request' }, 400, headers); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request' }, 400, headers);
  try {
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (body.action === 'tick') {
      if (!await cronSecretMatches(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET')))
        return json({ error: 'Forbidden' }, 403, headers);
      background(runLookupTick(service, startedAt));
      return json({ ok: true }, 202, headers);
    }
    if (body.action !== undefined && body.action !== 'create' && body.action !== 'cancel')
      return json({ error: 'Unknown action' }, 400, headers);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: userData, error: authError } = await client.auth.getUser();
    const caller = userData?.user;
    if (authError || !caller) return json({ error: 'Not signed in' }, 401, headers);
    if (body.action === 'cancel') {
      if (!isUuid(body.job_id)) return json({ error: 'Choose a job to stop' }, 400, headers);
      // RLS read: no other-organisation job existence is disclosed.
      const { data: job, error } = await client.from('lookup_jobs').select('id, org_id, created_by, status').eq('id', body.job_id).maybeSingle();
      if (error) return json({ error: 'Could not read this job' }, 500, headers);
      if (!job) return json({ error: 'Job not found' }, 404, headers);
      const { data: member, error: memberError } = await service.from('org_members').select('role').eq('org_id', job.org_id).eq('user_id', caller.id).maybeSingle();
      if (memberError || !member || (job.created_by !== caller.id && member.role !== 'admin'))
        return json({ error: 'Only the creator or an organisation admin can stop this job' }, 403, headers);
      const { error: cancelError } = await service.rpc('lookup_job_cancel', { target_job: job.id });
      if (cancelError) return json({ error: 'Could not stop this job' }, 500, headers);
      return json({ ok: true }, 200, headers);
    }
    const parsed = parseLookupRequest(body);
    if (!parsed) return json({ error: 'Choose a lookup type and between 1 and 50 leads' }, 400, headers);
    const { data: leads, error } = await client.from('leads').select('id, org_id').in('id', parsed.leadIds);
    if (error) return json({ error: 'Could not read the selected leads' }, 500, headers);
    if (!leads || leads.length !== parsed.leadIds.length) return json({ error: 'Some selected leads are unavailable' }, 404, headers);
    const orgIds = new Set(leads.map((lead) => lead.org_id as string));
    if (orgIds.size !== 1) return json({ error: 'Choose leads from one organisation' }, 400, headers);
    const orgId = [...orgIds][0]!;
    const { data: member, error: memberError } = await service.from('org_members').select('user_id').eq('org_id', orgId).eq('user_id', caller.id).maybeSingle();
    if (memberError || !member) return json({ error: 'Not a member of this organisation' }, 403, headers);
    for (const lead of leads) {
      const { data: canEdit, error: editError } = await client.rpc('can_edit_lead', { target_lead: lead.id });
      if (editError || canEdit !== true) return json({ error: 'You can only look up leads you can edit' }, 403, headers);
    }
    if (!await checkRateLimit(service, `lookup-create:${caller.id}`, 30, 1440, true))
      return json({ error: 'You have started a lot of lookups today. Try again tomorrow.' }, 429, headers);
    const { data: jobId, error: createError } = await service.rpc('lookup_job_create', {
      target_org: orgId, creator: caller.id, job_kind: parsed.kind, lead_ids: parsed.leadIds,
    });
    if (createError || !jobId) return json({ error: 'Could not queue these leads' }, 500, headers);
    background(runLookupTick(service, startedAt));
    return json({ job_id: jobId, queued: parsed.leadIds.length }, 202, headers);
  } catch (err) {
    console.error('lookup jobs: request failed', lookupErrorKind(err));
    return json({ error: 'This lookup request could not be completed. Try again.' }, 500, headers);
  }
});
