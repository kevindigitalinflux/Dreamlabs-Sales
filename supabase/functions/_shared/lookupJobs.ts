import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { enrichOneLead, type EnrichLeadRow } from './enrichLead.ts';
import { findAndStoreDecisionMakers } from './findDecisionMakers.ts';
import { resolveOrgApiKey } from './orgApiKeys.ts';
import { checkRateLimit } from './rateLimit.ts';
import { parseSafeWebsiteUrl } from './hostGuard.ts';
import { makeWorkerClient } from './workerClient.ts';
import { readWorkerConfig } from './workerRules.ts';
import { LOOKUP_LIMITS, lookupReview, lookupSkipReason, type LookupKind } from './lookupJobRules.ts';

interface Claimed { id: string; job_id: string; org_id: string; lead_id: string; attempts: number }
interface Job { id: string; org_id: string; created_by: string; kind: LookupKind; status: string }
interface Outcome { status: 'done' | 'failed' | 'skipped'; reason: string; result: Record<string, unknown>; review: 'none' | 'pending' }
const skipped = (reason: string): Outcome => ({ status: 'skipped', reason, result: {}, review: 'none' });

/** Recheck authorisation before providers and candidate writes, not just at enqueue time. */
async function authorised(service: SupabaseClient, row: Claimed, job: Job): Promise<boolean> {
  const [current, membership, edit, lead] = await Promise.all([
    service.from('lookup_job_leads').select('status, attempts, lookup_jobs!inner(status)').eq('id', row.id).maybeSingle(),
    service.from('org_members').select('user_id').eq('org_id', job.org_id).eq('user_id', job.created_by).maybeSingle(),
    service.rpc('deep_find_creator_can_edit', { target_user: job.created_by, target_lead: row.lead_id }),
    service.from('leads').select('id').eq('id', row.lead_id).eq('org_id', job.org_id).maybeSingle(),
  ]);
  const currentJob = current.data?.lookup_jobs as unknown as { status: string } | null;
  return !current.error && !membership.error && !edit.error && !lead.error && !!lead.data && !!membership.data
    && edit.data === true && current.data?.status === 'running' && current.data.attempts === row.attempts && currentJob?.status === 'active';
}

async function processLead(service: SupabaseClient, row: Claimed, job: Job): Promise<Outcome> {
  const deadline = Date.now() + LOOKUP_LIMITS.leadBudgetMs;
  const { data, error } = await service.from('leads').select('id, org_id, business_name, website, email, phone, owner_name, city')
    .eq('id', row.lead_id).eq('org_id', job.org_id).maybeSingle();
  if (error) throw new Error('Lead read failed');
  const lead = data as EnrichLeadRow | null;
  const { data: member, error: memberError } = await service.from('org_members').select('user_id')
    .eq('org_id', job.org_id).eq('user_id', job.created_by).maybeSingle();
  const { data: canEdit, error: editError } = await service.rpc('deep_find_creator_can_edit', { target_user: job.created_by, target_lead: row.lead_id });
  if (memberError || editError) throw new Error('Permission check failed');
  const reason = lookupSkipReason(!!lead, !!member, canEdit === true);
  if (reason || !lead) return skipped(reason ?? 'This lead is no longer available.');
  const checkpoint = async () => {
    if (Date.now() > deadline - 10_000) throw new Error('Lookup time budget reached');
    if (!await authorised(service, row, job)) throw new Error('Lookup no longer authorised');
  };
  await checkpoint();
  if (!await checkRateLimit(service, `lookup-org:${job.org_id}`, LOOKUP_LIMITS.orgPerDay, 1440, true))
    return skipped('The daily lookup limit for this organisation was reached.');
  if (!await checkRateLimit(service, `lookup-lead:${row.lead_id}`, LOOKUP_LIMITS.leadPerDay, 1440, true))
    return skipped('This lead has reached its daily lookup limit.');

  const [hunter, apollo] = await Promise.all([
    resolveOrgApiKey(service, job.org_id, 'hunter'), resolveOrgApiKey(service, job.org_id, 'apollo'),
  ]);
  if (job.kind === 'decision_makers') {
    const candidates = await findAndStoreDecisionMakers(service, lead, { hunterKey: hunter, apolloKey: apollo }, job.created_by, checkpoint);
    return { status: 'done', reason: `${candidates.length} people available to review.`, review: 'none', result: {
      stored: candidates.length, steps: [!lead.website ? 'No company website is saved for this lead.'
        : !hunter && !apollo ? 'Set up Hunter or Apollo for this organisation to find decision makers.'
        : `Found ${candidates.length} people. Review their details on the lead before using them.`],
    } };
  }
  const [companiesHouse, openCorporates, googlePlaces] = await Promise.all([
    resolveOrgApiKey(service, job.org_id, 'companies_house'), resolveOrgApiKey(service, job.org_id, 'opencorporates'),
    resolveOrgApiKey(service, job.org_id, 'google_places'),
  ]);
  const worker = makeWorkerClient({ usage: service, orgId: job.org_id,
    config: readWorkerConfig(Deno.env.get('WORKER_URL'), Deno.env.get('WORKER_SECRET')) });
  const found = await enrichOneLead(lead, { hunter, apollo, companiesHouse, openCorporates, googlePlaces }, {
    checkpoint,
    siteFallback: async (website) => {
      const safe = parseSafeWebsiteUrl(website);
      if (!safe) return null;
      const timeoutMs = Math.min(25_000, deadline - Date.now() - 32_000);
      if (timeoutMs < 10_000) return null;
      const reply = await worker.scrapeSite(safe.hostname.replace(/^www\./, ''), 'key_pages', { timeoutMs });
      return reply.ok ? { email: reply.value.emails[0]?.value, phone: reply.value.phones[0]?.value } : null;
    },
  });
  const proposed = found?.proposed ?? {};
  return { status: 'done', reason: Object.keys(proposed).length ? 'Found details to review.' : 'No additional details were found.',
    review: lookupReview('enrich', proposed) as 'none' | 'pending',
    result: { proposed, source: found?.source ?? {}, steps: ['Checked available sources for contact details.', ...worker.lines()] } };
}

/** Cron and create share this runner. SQL handles stale leases, cancellation and atomic completion. */
export async function runLookupTick(service: SupabaseClient, startedAt = Date.now()): Promise<number> {
  let processed = 0;
  while (Date.now() - startedAt < LOOKUP_LIMITS.wallBudgetMs - LOOKUP_LIMITS.leadBudgetMs) {
    const { data, error } = await service.rpc('lookup_job_claim', { max_leads: 1 });
    if (error) { console.error('lookup jobs: claim failed'); break; }
    const row = (data as Claimed[] | null)?.[0];
    if (!row) break;
    let outcome: Outcome;
    try {
      const { data: job, error: jobError } = await service.from('lookup_jobs').select('id, org_id, created_by, kind, status').eq('id', row.job_id).maybeSingle();
      if (jobError) throw new Error('Job read failed');
      outcome = !job || job.status !== 'active' ? skipped('This job was stopped.') : await processLead(service, row, job as Job);
    } catch {
      console.error('lookup jobs: lead processing failed');
      outcome = { status: 'failed', reason: 'This lookup could not finish. Please try again.', result: {}, review: 'none' };
    }
    const { error: finishError } = await service.rpc('lookup_job_finish', {
      lead_row: row.id, claim_attempt: row.attempts, new_status: outcome.status, new_reason: outcome.reason,
      new_result: outcome.result, new_review: outcome.review,
    });
    if (finishError) { console.error('lookup jobs: saving result failed'); break; }
    processed++;
  }
  return processed;
}
