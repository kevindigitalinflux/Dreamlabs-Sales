import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { enrichOneLead, type EnrichLeadRow } from './enrichLead.ts';
import { findAndStoreDecisionMakers } from './findDecisionMakers.ts';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from './orgApiKeys.ts';
import { checkRateLimit } from './rateLimit.ts';
import { parseSafeWebsiteUrl } from './hostGuard.ts';
import { makeWorkerClient } from './workerClient.ts';
import { scrapeTimeoutFor } from './workerRules.ts';
import { LOOKUP_LIMITS, canStartLookupLead, lookupErrorKind, lookupReview, lookupSkipReason, type LookupKind } from './lookupJobRules.ts';
import { makeFirecrawlClient } from './firecrawlClient.ts';
import { FIRECRAWL_DAILY_PAGES } from './firecrawlRules.ts';
import { DOMAIN_CHECKS, savedDomains } from './domainChecks.ts';
import { domainFromWebsite } from './knownPerson.ts';
import { websiteSuspicion } from './domainDiscovery.ts';

interface Claimed { id: string; job_id: string; org_id: string; lead_id: string; attempts: number }
interface Job { id: string; org_id: string; created_by: string; kind: LookupKind; status: string }
interface Outcome { status: 'done' | 'failed' | 'skipped'; reason: string; result: Record<string, unknown>; review: 'none' | 'pending' }
const skipped = (reason: string): Outcome => ({ status: 'skipped', reason, result: {}, review: 'none' });
class LookupSkipped extends Error {}

/** Recheck authorisation before providers and candidate writes, not just at enqueue time. */
async function checkAuthorisation(service: SupabaseClient, row: Claimed, job: Job): Promise<void> {
  const [current, membership, edit, lead] = await Promise.all([
    service.from('lookup_job_leads').select('status, attempts, lookup_jobs!inner(status)').eq('id', row.id).maybeSingle(),
    service.from('org_members').select('user_id').eq('org_id', job.org_id).eq('user_id', job.created_by).maybeSingle(),
    service.rpc('deep_find_creator_can_edit', { target_user: job.created_by, target_lead: row.lead_id }),
    service.from('leads').select('id').eq('id', row.lead_id).eq('org_id', job.org_id).maybeSingle(),
  ]);
  const currentJob = current.data?.lookup_jobs as unknown as { status: string } | null;
  const error = current.error ?? membership.error ?? edit.error ?? lead.error;
  if (error) throw error;
  const reason = lookupSkipReason(!!lead.data, !!membership.data, edit.data === true);
  if (reason) throw new LookupSkipped(reason);
  if (current.data?.status !== 'running' || current.data.attempts !== row.attempts || currentJob?.status !== 'active')
    throw new LookupSkipped('This job was stopped or this lookup is no longer current.');
}

async function processLead(service: SupabaseClient, row: Claimed, job: Job, startedAt: number): Promise<Outcome> {
  const deadline = Math.min(Date.now() + LOOKUP_LIMITS.leadBudgetMs,
    startedAt + LOOKUP_LIMITS.wallBudgetMs - LOOKUP_LIMITS.checkpointMarginMs);
  const { data, error } = await service.from('leads').select('id, org_id, business_name, website, email, phone, owner_name, city, blocked_domains')
    .eq('id', row.lead_id).eq('org_id', job.org_id).maybeSingle();
  if (error) throw error;
  const lead = data as EnrichLeadRow | null;
  const { data: member, error: memberError } = await service.from('org_members').select('user_id')
    .eq('org_id', job.org_id).eq('user_id', job.created_by).maybeSingle();
  const { data: canEdit, error: editError } = await service.rpc('deep_find_creator_can_edit', { target_user: job.created_by, target_lead: row.lead_id });
  if (memberError || editError) throw memberError ?? editError;
  const reason = lookupSkipReason(!!lead, !!member, canEdit === true);
  if (reason || !lead) return skipped(reason ?? 'This lead is no longer available.');
  const checkpoint = async () => {
    if (Date.now() >= deadline - LOOKUP_LIMITS.checkpointMarginMs) throw new Error('Lookup time budget reached');
    await checkAuthorisation(service, row, job);
    if (Date.now() >= deadline - LOOKUP_LIMITS.checkpointMarginMs) throw new Error('Lookup time budget reached');
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
  const [companiesHouse, openCorporates, googlePlaces, firecrawlKey] = await Promise.all([
    resolveOrgApiKey(service, job.org_id, 'companies_house'), resolveOrgApiKey(service, job.org_id, 'opencorporates'),
    resolveOrgApiKey(service, job.org_id, 'google_places'),
    resolveOrgApiKey(service, job.org_id, 'firecrawl'),
  ]);
  const worker = makeWorkerClient({ usage: service, orgId: job.org_id,
    config: await resolveOrgWorkerConfig(service, job.org_id) });
  const firecrawl = makeFirecrawlClient({ key: firecrawlKey, checkpoint,
    reserve: () => checkRateLimit(service, `firecrawl-pages:${job.org_id}`, FIRECRAWL_DAILY_PAGES, 1440, true) });
  const found = await enrichOneLead(lead, { hunter, apollo, companiesHouse, openCorporates, googlePlaces }, {
    checkpoint,
    teamFallback: async (website, pages) => {
      const domain = domainFromWebsite(website);
      if (!domain || !parseSafeWebsiteUrl(website) || !DOMAIN_CHECKS.usable(domain) || savedDomains(lead.blocked_domains).includes(domain)
        || websiteSuspicion(pages, [lead.business_name]).suspect) return null;
      return firecrawl.readTeam(domain, pages, deadline - Date.now());
    },
    siteFallback: async (website) => {
      const safe = parseSafeWebsiteUrl(website);
      if (!safe) return null;
      const timeoutMs = scrapeTimeoutFor(deadline - Date.now());
      if (timeoutMs === null) return null;
      const reply = await worker.scrapeSite(safe.hostname.replace(/^www\./, ''), 'key_pages', { timeoutMs });
      return reply.ok ? { email: reply.value.emails[0]?.value, phone: reply.value.phones[0]?.value } : null;
    },
  });
  const proposed = found?.proposed ?? {};
  return { status: 'done', reason: Object.keys(proposed).length ? 'Found details to review.' : 'No additional details were found.',
    review: lookupReview('enrich', proposed) as 'none' | 'pending',
    result: { proposed, source: found?.source ?? {}, steps: ['Checked available sources for contact details.', ...worker.lines(), ...firecrawl.lines()] } };
}

/** Cron and create share this runner. SQL handles stale leases, cancellation and atomic completion. */
export async function runLookupTick(service: SupabaseClient, startedAt = Date.now()): Promise<number> {
  let processed = 0;
  while (canStartLookupLead(startedAt, Date.now())) {
    const { data, error } = await service.rpc('lookup_job_claim', { max_leads: 1 });
    if (error) { console.error('lookup jobs: claim failed', lookupErrorKind(error)); break; }
    const row = (data as Claimed[] | null)?.[0];
    if (!row) break;
    let outcome: Outcome;
    try {
      const { data: job, error: jobError } = await service.from('lookup_jobs').select('id, org_id, created_by, kind, status').eq('id', row.job_id).maybeSingle();
      if (jobError) throw jobError;
      outcome = !job || job.status !== 'active' ? skipped('This job was stopped.')
        : !canStartLookupLead(startedAt, Date.now()) ? skipped('There was not enough time to start this lookup. Please try again.')
        : await processLead(service, row, job as Job, startedAt);
    } catch (err) {
      console.error('lookup jobs: lead processing failed', lookupErrorKind(err));
      outcome = err instanceof LookupSkipped ? skipped(err.message)
        : { status: 'failed', reason: 'This lookup could not finish. Please try again.', result: {}, review: 'none' };
    }
    const { error: finishError } = await service.rpc('lookup_job_finish', {
      lead_row: row.id, claim_attempt: row.attempts, new_status: outcome.status, new_reason: outcome.reason,
      new_result: outcome.result, new_review: outcome.review,
    });
    if (finishError) { console.error('lookup jobs: saving result failed', lookupErrorKind(finishError)); break; }
    processed++;
  }
  return processed;
}
