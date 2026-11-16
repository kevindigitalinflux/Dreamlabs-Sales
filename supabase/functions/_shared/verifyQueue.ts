import type { WorkerClient } from './workerClient.ts';
import { cachedMailProvider } from './dnsLookup.ts';
import { nextStep, type QueueCandidate, type QueueOutcome } from './verifyQueueRules.ts';
import { QueueStepError } from './verifyQueueRetry.ts';

export interface QueueRow {
  id: string; org_id: string; run_id: string; lead_id: string; contact_id: string | null;
  address: string; domain: string; kind: 'smtp' | 'ms_exists'; person_key: string | null; person_name: string | null; attempts: number; created_at: string;
}
export interface QueueDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  workerFor(orgId: string): WorkerClient;
  recordOutcome(input: { orgId: string; leadId: string; address: string; outcome: string }): Promise<void>;
  applyProven(input: { orgId: string; leadId: string; contactId: string | null; address: string }): Promise<'applied' | 'suggested' | 'skipped'>;
  refreshReadiness(leadId: string): Promise<void>;
  canStillEdit(runId: string, leadId: string): Promise<boolean>;
  now(): number;
  /** Production callbacks capture one claimed row, avoiding shared mutable scope during Promise.all. */
  forRow?(row: QueueRow): QueueDeps;
  recoverProven?(deadline: number): Promise<void>;
}

export async function enqueueLeadChecks(deps: Pick<QueueDeps, 'rpc'>, input: { orgId: string; runId: string; leadId: string; plan: QueueCandidate[] }): Promise<number> {
  if (!input.plan.length) return 0;
  const { data, error } = await deps.rpc('deep_find_checks_enqueue', { p_rows: input.plan.map(row => ({
    org_id: input.orgId, run_id: input.runId, lead_id: input.leadId, contact_id: row.contactId,
    person_key: row.personKey, person_name: row.personName, address: row.address, domain: row.domain, kind: row.kind, rank: row.rank,
  })) });
  if (error || typeof data !== 'number' || !Number.isInteger(data) || data < 0) throw Error('Could not enqueue background checks');
  return data;
}

export async function drainQueue(deps: QueueDeps, startedAt: number, wallBudgetMs: number): Promise<{ processed: number }> {
  let processed = 0;
  let stopClaiming = false;
  if (deps.now() - startedAt < wallBudgetMs - 55_000 && deps.recoverProven) {
    try { await deps.recoverProven(startedAt + wallBudgetMs - 55_000); }
    catch (error) { console.error('Background check recovery failed', error instanceof QueueStepError ? error.step : 'recovery_read'); }
  }
  const expire = async () => {
    const result = await deps.rpc('deep_find_checks_expire', {});
    if (result.error) throw Error('Could not expire background checks');
  };
  while (!stopClaiming && deps.now() - startedAt < wallBudgetMs - 55_000) {
    let rows: QueueRow[];
    try {
      await expire();
      const result = await deps.rpc('deep_find_checks_claim', { p_max: 4 });
      if (result.error || !Array.isArray(result.data)) throw Error('Could not claim background checks');
      rows = result.data as QueueRow[];
    } catch (error) { console.error('Background check claim failed', error instanceof Error ? error.name : 'UnknownError'); break; }
    if (!rows.length) break;
    let provenPerson = false;
    await Promise.all(rows.map(async row => {
      let step = 'access_read';
      try {
        const scope = deps.forRow?.(row) ?? deps;
        const finish = async (outcome: QueueOutcome) => {
          step = 'finish';
          const result = await scope.rpc('deep_find_checks_finish', {
            p_id: row.id, p_status: outcome.status, p_verdict: outcome.status === 'done' ? outcome.verdict : null,
            p_reason: outcome.reason, p_provider: row.kind === 'ms_exists' ? 'microsoft' : cachedMailProvider(row.domain) ?? 'unknown',
            p_next_at: outcome.status === 'queued' ? new Date(outcome.nextAt).toISOString() : null,
          });
          if (result.error) throw Error('Could not finish background check');
          if (result.data !== true) return false;
          processed++;
          return true;
        };
        if (!await scope.canStillEdit(row.run_id, row.lead_id)) { await finish({ status: 'skipped', reason: 'no_access' }); return; }
        step = 'worker_config';
        const worker = scope.workerFor(row.org_id);
        step = 'worker_call';
        const answer = row.kind === 'ms_exists' ? await worker.msExists(row.address) : await worker.verifyEmail(row.address, { timeoutMs: 48_000 });
        step = 'access_read';
        if (!await scope.canStillEdit(row.run_id, row.lead_id)) { await finish({ status: 'skipped', reason: 'no_access' }); return; }
        const outcome = nextStep(row, answer.ok ? row.kind === 'ms_exists'
          ? { ok: true, status: answer.value as string, reason: answer.value as string }
          : { ok: true, status: (answer.value as { status: string }).status, reason: (answer.value as { reason: string }).reason }
          : answer, scope.now());
        // Claim has no organisation-exclusion argument: end this tick after its current concurrent batch.
        if (!answer.ok && answer.failure === 'limit_reached') stopClaiming = true;
        if (!await finish(outcome) || outcome.status !== 'done') return;
        if (row.person_key !== null && ['valid', 'exists'].includes(outcome.verdict)) provenPerson = true;
        step = 'access_read';
        if (!await scope.canStillEdit(row.run_id, row.lead_id)) { console.info('Background check result skipped', 'no_access'); return; }
        step = 'record_outcome';
        if (row.kind === 'smtp') await scope.recordOutcome({ orgId: row.org_id, leadId: row.lead_id, address: row.address, outcome: `checked_${outcome.verdict}` });
        if (row.person_key !== null && ['valid', 'exists'].includes(outcome.verdict) && outcome.reason !== 'role_account') {
          step = 'apply_proven';
          await scope.applyProven({ orgId: row.org_id, leadId: row.lead_id, contactId: row.contact_id, address: row.address });
        }
        step = 'access_read';
        if (await scope.canStillEdit(row.run_id, row.lead_id)) { step = 'refresh_readiness'; await scope.refreshReadiness(row.lead_id); }
      } catch (error) { console.error('Background check row failed', error instanceof QueueStepError ? error.step : step); }
    }));
    if (provenPerson) {
      try { await expire(); } catch (error) { console.error('Background check sibling expiry failed', error instanceof Error ? error.name : 'UnknownError'); break; }
    }
  }
  return { processed };
}
