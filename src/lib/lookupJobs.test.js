// Runtime integration tests keep Deno-only types outside the browser TypeScript graph.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/enrichLead', () => ({ enrichOneLead: vi.fn() }));
vi.mock('../../supabase/functions/_shared/findDecisionMakers', () => ({ findAndStoreDecisionMakers: vi.fn() }));
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(), resolveOrgWorkerConfig: vi.fn() }));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn() }));
import { enrichOneLead } from '../../supabase/functions/_shared/enrichLead';
import { findAndStoreDecisionMakers } from '../../supabase/functions/_shared/findDecisionMakers';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
import { checkRateLimit } from '../../supabase/functions/_shared/rateLimit';
import { runLookupTick } from '../../supabase/functions/_shared/lookupJobs';

function fixture(options = {}) {
  let claimed = false;
  const rpc = vi.fn(async (name) => {
    if (name === 'lookup_job_claim') {
      if (options.claimDelay) vi.setSystemTime(Date.now() + options.claimDelay);
      if (options.claimError) return { data: null, error: { code: '42501', message: 'private error' } };
      if (claimed) return { data: [], error: null };
      claimed = true;
      return { data: [{ id: 'row', job_id: 'job', org_id: 'org', lead_id: 'lead', attempts: 1 }], error: null };
    }
    if (name === 'deep_find_creator_can_edit') return { data: options.edit !== false, error: null };
    if (name === 'lookup_job_finish' && options.deleted) return { data: false, error: null };
    return { data: true, error: options.saveError ? { code: '42501', message: 'private error' } : null };
  });
  const from = vi.fn((table) => {
    const data = table === 'lookup_jobs' ? { id: 'job', org_id: 'org', created_by: 'user', kind: options.kind ?? 'enrich', status: options.stopped ? 'cancelled' : 'active' }
      : table === 'org_members' ? options.member === false ? null : { user_id: 'user' }
      : table === 'leads' ? options.deleted ? null : { id: 'lead', org_id: 'org', website: 'https://example.com' }
      : { status: 'running', attempts: 1, lookup_jobs: { status: 'active' } };
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data, error: null }) };
    return query;
  });
  const service = { rpc, from };
  return { service, rpc, finish: () => rpc.mock.calls.find(([name]) => name === 'lookup_job_finish') };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(resolveOrgApiKey).mockResolvedValue(null);
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue(null);
  vi.mocked(enrichOneLead).mockResolvedValue({ lead_id: 'lead', proposed: { email: 'hello@example.com' }, source: { email: 'website' } });
  vi.mocked(findAndStoreDecisionMakers).mockResolvedValue([{ id: 'candidate' }]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('lookup tick', () => {
  it('stores proposals for review with claim fencing, never applying them', async () => {
    const f = fixture();
    expect(await runLookupTick(f.service)).toBe(1);
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({
      lead_row: 'row', claim_attempt: 1, new_status: 'done', new_review: 'pending',
      new_result: expect.objectContaining({ proposed: { email: 'hello@example.com' } }),
    }));
    expect(checkRateLimit).toHaveBeenCalledWith(f.service, 'lookup-org:org', 300, 1440, true);
    expect(checkRateLimit).toHaveBeenCalledWith(f.service, 'lookup-lead:lead', 5, 1440, true);
    expect(resolveOrgWorkerConfig).toHaveBeenCalledWith(f.service, 'org');
  });
  it.each([{ edit: false }, { member: false }, { deleted: true }, { stopped: true }])('skips without provider calls: %j', async (options) => {
    const f = fixture(options);
    await runLookupTick(f.service);
    expect(enrichOneLead).not.toHaveBeenCalled();
    expect(findAndStoreDecisionMakers).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({ new_status: 'skipped', new_review: 'none' }));
  });
  it('honours a failed rate-limit reservation without any provider calls', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const f = fixture();
    await runLookupTick(f.service);
    expect(enrichOneLead).not.toHaveBeenCalled();
    expect(resolveOrgApiKey).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({ new_status: 'skipped' }));
  });
  it('survives a claimed lead cascading away and uses a plain skip reason', async () => {
    const f = fixture({ deleted: true });
    expect(await runLookupTick(f.service)).toBe(1);
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({
      new_status: 'skipped', new_reason: 'This lead is no longer available.', new_review: 'none',
    }));
    expect(enrichOneLead).not.toHaveBeenCalled();
    expect(findAndStoreDecisionMakers).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
  it('stores decision-maker counts without marking them as applied', async () => {
    const f = fixture({ kind: 'decision_makers' });
    await runLookupTick(f.service);
    expect(enrichOneLead).not.toHaveBeenCalled();
    expect(findAndStoreDecisionMakers).toHaveBeenCalledOnce();
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({ new_status: 'done', new_review: 'none', new_result: expect.objectContaining({ stored: 1 }) }));
  });
  it('uses fixed failure sentences instead of provider errors', async () => {
    vi.mocked(enrichOneLead).mockRejectedValue(new Error('private provider payload'));
    const f = fixture();
    await runLookupTick(f.service);
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({ new_status: 'failed', new_reason: 'This lookup could not finish. Please try again.' }));
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain('private provider');
    expect(console.error).toHaveBeenCalledWith('lookup jobs: lead processing failed', 'Error');
  });
  it('skips when the creator loses edit rights at a provider checkpoint', async () => {
    const options = {};
    const f = fixture(options);
    vi.mocked(enrichOneLead).mockImplementation(async (_lead, _keys, { checkpoint }) => {
      options.edit = false;
      await checkpoint();
      throw new Error('Should not reach the next provider');
    });
    await runLookupTick(f.service);
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({
      new_status: 'skipped', new_reason: 'The person who started this job can no longer edit this lead.',
    }));
  });
  it('does not claim when there is insufficient wall time', async () => {
    const f = fixture();
    expect(await runLookupTick(f.service, Date.now() - 50_000)).toBe(0);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('does not start providers when claiming used up the lead reserve', async () => {
    vi.useFakeTimers();
    const f = fixture({ claimDelay: 21_000 });
    await runLookupTick(f.service);
    expect(enrichOneLead).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({ new_status: 'skipped' }));
  });
  it('stops the next provider at the final checkpoint margin', async () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.mocked(enrichOneLead).mockImplementation(async (_lead, _keys, { checkpoint }) => {
      vi.setSystemTime(Date.now() + 90_000);
      await checkpoint();
      return { proposed: { email: 'must-not-be-saved@example.com' } };
    });
    await runLookupTick(f.service);
    expect(f.rpc).toHaveBeenCalledWith('lookup_job_finish', expect.objectContaining({ new_status: 'failed', new_result: {} }));
    expect(f.rpc.mock.calls.filter(([name]) => name === 'lookup_job_claim')).toHaveLength(1);
  });
  it('stops on claim or persistence errors instead of silently continuing', async () => {
    const f = fixture({ claimError: true });
    expect(await runLookupTick(f.service)).toBe(0);
    expect(enrichOneLead).not.toHaveBeenCalled();
    const g = fixture({ saveError: true });
    expect(await runLookupTick(g.service)).toBe(0);
    expect(console.error).toHaveBeenCalledWith('lookup jobs: saving result failed', '42501');
    expect(console.error).toHaveBeenCalledWith('lookup jobs: claim failed', '42501');
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('private error');
  });
});
