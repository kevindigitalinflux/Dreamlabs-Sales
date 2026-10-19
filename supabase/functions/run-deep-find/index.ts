// supabase/functions/run-deep-find/index.ts
// DEPLOY WITH verify_jwt = false (see supabase/config.toml): the pg_cron tick sends only x-cron-secret, no Authorization
// header, so the gateway would answer 401. The function authenticates every action itself:
//   create  signed-in user: validates the leads (RLS read, same org, caller is a member and can edit each one), max 25,
//           30 creates per user per day, 5 active runs per org, leads not already queued or running; then inserts the
//           run and its queued rows with the SERVICE client (clients have no INSERT on the 057 tables) and starts
//           processing in the background.
//   cancel  signed-in user who created the run, or an org admin.
//   choose_company  signed-in user who can edit the lead: "Use this company" (deepFindLeadActions.ts).
//   block_domain    signed-in user who can edit the lead: "Not their domain" (deepFindLeadActions.ts).
//   hunter_account  signed-in org member: Hunter searches left this month (free endpoint, key resolved server side,
//                   only numbers returned).
//   tick    cron only (x-cron-secret, compared in constant time; refused when CRON_SECRET is not set).
// Deep find never emails anyone and never touches sequences. Keys never leave the providers' request headers.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { cancelDeepFindRun, runDeepFindTick } from '../_shared/deepFind.ts';
import { isUuid, parseCreateRequest } from '../_shared/deepFindRules.ts';
import { cronSecretMatches } from '../_shared/timingSafe.ts';
import { blockDomain, chooseCompany, queueRun } from '../_shared/deepFindLeadActions.ts';
import { resolveOrgApiKey } from '../_shared/orgApiKeys.ts';
import { hunterAccount } from '../_shared/knownPersonLookup.ts';
import { hunterAccountEmpty } from '../_shared/hunterLimits.ts';

const MAX_ACTIVE_RUNS_PER_ORG = 5;

/** Runs work after the response is sent (EdgeRuntime.waitUntil); awaits it when that is unavailable. */
async function background(task: Promise<unknown>): Promise<void> {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt) rt.waitUntil(task); else await task;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, headers);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ error: 'Invalid request' }, 400, headers); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'Invalid request' }, 400, headers);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (body.action === 'tick') {
    if (!await cronSecretMatches(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET'))) return json({ error: 'Forbidden' }, 403, headers);
    await background(runDeepFindTick(service, startedAt).catch(() => console.error('deep find tick failed')));
    return json({ ok: true }, 202, headers);
  }

  if (!['create', 'cancel', 'choose_company', 'block_domain', 'hunter_account'].includes(String(body.action))) return json({ error: 'Unknown action' }, 400, headers);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData } = await client.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json({ error: 'Not signed in' }, 401, headers);

  if (body.action === 'cancel') {
    if (!isUuid(body.run_id)) return json({ error: 'run_id is required' }, 400, headers);
    const { data: runData } = await service.from('deep_find_runs').select('id, org_id, created_by, status').eq('id', body.run_id).maybeSingle();
    const run = runData as { id: string; org_id: string; created_by: string; status: string } | null;
    if (!run) return json({ error: 'Deep find not found' }, 404, headers);
    const { data: member } = await service.from('org_members').select('role').eq('org_id', run.org_id).eq('user_id', caller.id).maybeSingle();
    if (!member || (run.created_by !== caller.id && member.role !== 'admin')) return json({ error: 'Not allowed' }, 403, headers);
    if (run.status === 'active') await cancelDeepFindRun(service, run.id, 'Stopped by user');
    return json({ ok: true }, 200, headers);
  }

  if (body.action === 'choose_company') {
    const result = await chooseCompany(client, service, caller.id, body);
    if (result.body.queued === true) await background(runDeepFindTick(service, startedAt).catch(() => console.error('deep find start failed')));
    return json(result.body, result.status, headers);
  }

  if (body.action === 'hunter_account') {
    if (!isUuid(body.org_id)) return json({ error: 'org_id is required' }, 400, headers);
    const { data: member } = await service.from('org_members').select('role').eq('org_id', body.org_id).eq('user_id', caller.id).maybeSingle();
    if (!member) return json({ error: 'Not a member of this organisation' }, 403, headers);
    if (!await checkRateLimit(service, `deep-find-hunter-account:${caller.id}`, 120, 24 * 60, true)) {
      return json({ error: 'Too many checks today. Try again tomorrow.' }, 429, headers);
    }
    const key = await resolveOrgApiKey(service, String(body.org_id), 'hunter');
    if (!key) return json({ configured: false }, 200, headers);
    const acc = await hunterAccount(key, 5_000);
    if (!acc.ok) {
      // Only fixed codes go back: never the key or provider text.
      return json({ configured: true, available: false, used_up: acc.failure === 'usage_exhausted' }, 200, headers);
    }
    const a = acc.account;
    return json({
      configured: true, available: !!a, used_up: hunterAccountEmpty(a),
      searches_left: a?.searchesLeft ?? null, searches_available: a?.searchesAvailable ?? null, credits_left: a?.creditsLeft ?? null,
      reset_date: a?.resetDate ?? null,
    }, 200, headers);
  }

  if (body.action === 'block_domain') {
    const result = await blockDomain(client, service, caller.id, body);
    return json(result.body, result.status, headers);
  }

  // create
  const parsed = parseCreateRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400, headers);
  if (!await checkRateLimit(service, `deep-find-create:${caller.id}`, 30, 24 * 60, true)) {
    return json({ error: 'You have started a lot of Deep finds today. Try again tomorrow.' }, 429, headers);
  }

  // RLS-scoped read: only leads the caller can see come back.
  const { data: leadData, error: leadErr } = await client.from('leads').select('id, org_id').in('id', parsed.leadIds);
  if (leadErr) return json({ error: 'Could not read the selected leads' }, 500, headers);
  const leads = (leadData ?? []) as { id: string; org_id: string }[];
  if (leads.length !== parsed.leadIds.length) return json({ error: 'Some of the selected leads could not be found' }, 404, headers);
  const orgIds = new Set(leads.map((l) => l.org_id));
  if (orgIds.size !== 1) return json({ error: 'Selected leads span more than one organisation' }, 400, headers);
  const orgId = [...orgIds][0]!;
  const { data: member } = await service.from('org_members').select('role').eq('org_id', orgId).eq('user_id', caller.id).maybeSingle();
  if (!member) return json({ error: 'Not a member of this organisation' }, 403, headers);
  for (const l of leads) {
    const { data: canEdit, error } = await client.rpc('can_edit_lead', { target_lead: l.id });
    if (error || canEdit !== true) return json({ error: 'You can only run Deep find on leads you can edit' }, 403, headers);
  }

  const { count: activeRuns } = await service.from('deep_find_runs').select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('status', 'active');
  if ((activeRuns ?? 0) >= MAX_ACTIVE_RUNS_PER_ORG) {
    return json({ error: 'Several Deep finds are already running for this organisation. Wait for one to finish.' }, 409, headers);
  }
  const { data: busy } = await service.from('deep_find_leads').select('lead_id').in('lead_id', parsed.leadIds).in('status', ['queued', 'running']);
  const busyIds = new Set(((busy ?? []) as { lead_id: string }[]).map((b) => b.lead_id));
  const leadIds = parsed.leadIds.filter((id) => !busyIds.has(id));
  if (leadIds.length === 0) return json({ error: 'Deep find is already working on these leads' }, 409, headers);

  // Service-client inserts: every check above has passed (no client INSERT exists on the 057 tables).
  const queued = await queueRun(service, orgId, caller.id, leadIds, parsed.caps, parsed.effort);
  if (!queued.runId) {
    return 'failed' in queued && queued.failed
      ? json({ error: 'Could not queue the selected leads' }, 500, headers)
      : json({ error: 'Deep find is already working on these leads' }, 409, headers);
  }

  await background(runDeepFindTick(service, startedAt).catch(() => console.error('deep find start failed')));
  return json({ run_id: queued.runId, queued: queued.queued, already_running: busyIds.size + queued.raced }, 202, headers);
});
