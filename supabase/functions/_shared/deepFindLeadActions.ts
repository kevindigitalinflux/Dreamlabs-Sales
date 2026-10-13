// supabase/functions/_shared/deepFindLeadActions.ts
// Signed-in actions on one lead's Deep find results (run-deep-find): "Use this company" and, later, "Not their
// domain". Every action re-checks: the lead is visible to the caller (RLS read), the caller is a member of its org,
// and can_edit_lead (as the caller). Writes then use the service client.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { checkRateLimit } from './rateLimit.ts';
import { resolveOrgApiKey } from './orgApiKeys.ts';
import { fetchCompanyProfile } from './companiesHouse.ts';
import { cleanCompanyNumber } from './registrySearch.ts';
import { isUuid } from './deepFindRules.ts';

/** An action result: the JSON body and HTTP status to send. */
export interface ActionResult { status: number; body: Record<string, unknown> }

/** Loads a lead the caller may edit, or an error result. */
export async function editableLead(
  client: SupabaseClient, service: SupabaseClient, callerId: string, leadId: unknown,
): Promise<{ ok: true; lead: { id: string; org_id: string } } | { ok: false; result: ActionResult }> {
  const fail = (status: number, error: string) => ({ ok: false as const, result: { status, body: { error } } });
  if (!isUuid(leadId)) return fail(400, 'lead_id is required');
  const { data, error } = await client.from('leads').select('id, org_id').eq('id', leadId).maybeSingle();
  if (error) return fail(500, 'Could not read this lead');
  const lead = data as { id: string; org_id: string } | null;
  if (!lead) return fail(404, 'Lead not found');
  const { data: member } = await service.from('org_members').select('role').eq('org_id', lead.org_id).eq('user_id', callerId).maybeSingle();
  if (!member) return fail(403, 'Not a member of this organisation');
  const { data: canEdit, error: editErr } = await client.rpc('can_edit_lead', { target_lead: lead.id });
  if (editErr || canEdit !== true) return fail(403, 'You can only change leads you can edit');
  return { ok: true, lead };
}

/**
 * Creates a run for the given leads with the service client (after the caller's checks). One queued row per lead;
 * a lead another run is already working on (unique index, 23505) is left out. Returns null when nothing was queued.
 */
export async function queueRun(
  service: SupabaseClient, orgId: string, userId: string, leadIds: string[], caps: { hunter: number; ai: number },
): Promise<{ runId: string; queued: number; raced: number } | { runId: null; queued: 0; raced: number; failed: boolean }> {
  const { data: runRow, error: runErr } = await service.from('deep_find_runs').insert({
    org_id: orgId, created_by: userId, lead_count: leadIds.length, credit_cap_hunter: caps.hunter, credit_cap_ai: caps.ai,
  }).select('id').single();
  if (runErr || !runRow) return { runId: null, queued: 0, raced: 0, failed: true };
  const runId = (runRow as { id: string }).id;
  let queued = 0;
  let raced = 0;
  for (const lead_id of leadIds) {
    const { error } = await service.from('deep_find_leads').insert({ run_id: runId, org_id: orgId, lead_id });
    if (!error) queued++;
    else if (error.code === '23505') raced++;
    else console.error('deep find: queue insert failed');
  }
  if (queued === 0) {
    await service.from('deep_find_runs').delete().eq('id', runId);
    return { runId: null, queued: 0, raced, failed: raced === 0 };
  }
  if (queued !== leadIds.length) await service.from('deep_find_runs').update({ lead_count: queued }).eq('id', runId);
  return { runId, queued, raced };
}

/** Caps for the follow-up run started after "Use this company": officers and their emails only need a few credits. */
export const CHOSEN_COMPANY_CAPS = { hunter: 20, ai: 5 } as const;

/**
 * "Use this company": checks the caller, the number's format and that Companies House knows the company, saves it on
 * the lead, then queues a small Deep find run for the lead so its officers are added and looked up. When Deep find is
 * already working on this lead (Review Focus 5), the number is still saved and the caller is told to run it again
 * after; the running pass never overwrites it (it only fills an empty company_number).
 */
export async function chooseCompany(
  client: SupabaseClient, service: SupabaseClient, callerId: string, body: Record<string, unknown>,
): Promise<ActionResult> {
  const number = cleanCompanyNumber(body.company_number);
  if (!number) return { status: 400, body: { error: 'That is not a Companies House company number' } };
  const access = await editableLead(client, service, callerId, body.lead_id);
  if (!access.ok) return access.result;
  const { lead } = access;
  if (!await checkRateLimit(service, `deep-find-choose:${callerId}`, 30, 24 * 60, true)) {
    return { status: 429, body: { error: 'Too many changes today. Try again tomorrow.' } };
  }
  const chKey = await resolveOrgApiKey(service, lead.org_id, 'companies_house');
  if (!chKey) return { status: 400, body: { error: 'No Companies House key is set for this organisation' } };
  const profile = await fetchCompanyProfile(number, chKey);
  if (!profile) return { status: 404, body: { error: 'Companies House does not know that company number' } };
  const { error } = await service.from('leads').update({ company_number: number }).eq('id', lead.id).eq('org_id', lead.org_id);
  if (error) return { status: 500, body: { error: 'Could not save the company on this lead' } };
  const run = await queueRun(service, lead.org_id, callerId, [lead.id], CHOSEN_COMPANY_CAPS);
  return {
    status: 200,
    body: {
      saved: true, company_name: profile.name, run_id: run.runId, queued: run.queued > 0,
      ...(run.queued === 0 ? { notice: 'Saved. Deep find is already working on this lead: run it again when it finishes to add the officers.' } : {}),
    },
  };
}
