// Exercise the actual handler with fake clients; no network or credentials.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/lookupJobs', () => ({ runLookupTick: vi.fn() }));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('../../supabase/functions/_shared/timingSafe', () => ({ cronSecretMatches: vi.fn().mockResolvedValue(true) }));
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runLookupTick } from '../../supabase/functions/_shared/lookupJobs';
import { checkRateLimit } from '../../supabase/functions/_shared/rateLimit';

const leadId = '12345678-1234-1234-1234-123456789abc';
let handler;
let canEdit;
let leads;
let rpc;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: (fn) => { handler = fn; } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  canEdit = true;
  leads = [{ id: leadId, org_id: 'org' }];
  rpc = vi.fn(async (name) => {
    if (name === 'can_edit_lead') {
      vi.setSystemTime(Date.now() + 25_000);
      return { data: canEdit, error: null };
    }
    return { data: 'job', error: null };
  });
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) }, rpc,
    from: (table) => {
      const query = { select: () => query, eq: () => query,
        in: async () => ({ data: leads, error: null }),
        maybeSingle: async () => ({ data: table === 'org_members' ? { user_id: 'user' } : null, error: null }) };
      return query;
    },
  });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(runLookupTick).mockResolvedValue(0);
  await import('../../supabase/functions/run-lookup-jobs/index');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = (body) => new Request('https://example.invalid/lookup', { method: 'POST', body: JSON.stringify(body) });
it.each(['body', 'missing', 'rights'])('invalid %s does not consume the create allowance', async (kind) => {
  if (kind === 'missing') leads = [];
  if (kind === 'rights') canEdit = false;
  const response = await handler(request(kind === 'body' ? {} : { kind: 'enrich', lead_ids: [leadId] }));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(runLookupTick).not.toHaveBeenCalled();
});
it('passes request arrival time through slow ownership validation and only then reserves allowance', async () => {
  const response = await handler(request({ kind: 'enrich', lead_ids: [leadId] }));
  expect(response.status).toBe(202);
  expect(runLookupTick).toHaveBeenCalledWith(expect.anything(), 1_000_000);
  expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), 'lookup-create:user', 30, 1440, true);
  const editCall = rpc.mock.invocationCallOrder[0];
  expect(checkRateLimit.mock.invocationCallOrder[0]).toBeGreaterThan(editCall);
});
it('passes request start to cron and logs only the background error code', async () => {
  vi.mocked(runLookupTick).mockRejectedValue({ code: '42501', message: 'private database message', details: 'private details' });
  const response = await handler(request({ action: 'tick' }));
  expect(response.status).toBe(202);
  expect(runLookupTick).toHaveBeenCalledWith(expect.anything(), 1_000_000);
  expect(console.error).toHaveBeenCalledWith('lookup jobs: background tick failed', '42501');
});
it('logs only the classification of a thrown request error', async () => {
  vi.mocked(checkRateLimit).mockRejectedValue(new TypeError('private provider response'));
  const response = await handler(request({ kind: 'enrich', lead_ids: [leadId] }));
  expect(response.status).toBe(500);
  expect(console.error).toHaveBeenCalledWith('lookup jobs: request failed', 'TypeError');
  expect(await response.text()).not.toContain('private provider');
});
