import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/smtp', () => ({ sendMail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/selectedLeadPipeline', () => ({ processLeadPipeline: vi.fn(async () => ({ outcome: 'sent' })) }));
import { processRun, precheckLead } from '../../supabase/functions/_shared/selectedAutopilot';
import { processLeadPipeline } from '../../supabase/functions/_shared/selectedLeadPipeline';

const run = { id: 'run', org_id: 'org', created_by: 'user', mode: 'selected', status: 'active', started_at: '2026-10-26T10:00:00Z',
  window_start: '00:00', window_end: '23:59', timezone: 'UTC', window_date: '2026-10-26' };
let writes, reads, mailboxError, verified, parked, draftError;
function database() {
  return { rpc: async () => ({ data: 'dummy-password', error: null }), from(table) {
    let patch; const filters = [];
    const result = () => {
      reads.push({ table, filters });
      if (patch) writes.push({ table, patch });
      const rows = table === 'org_members' ? [{ user_id: 'user' }]
        : table === 'user_email_settings' ? [{ is_verified: verified }]
        : table === 'leads' ? [{ id: 'lead', org_id: 'org', stage: 'new_lead', opted_out: false }]
        : table === 'email_logs' ? parked : [];
      return { data: rows, error: table === 'user_email_settings' && mailboxError ? { message: 'blip' }
        : table === 'email_logs' && draftError ? { message: 'blip' } : null };
    };
    const q = { select: () => q, eq: (k, v) => { filters.push([k, v]); return q; }, in: (k, v) => { filters.push([k, v]); return q; },
      order: () => q, limit: () => q, update: p => { patch = p; return q; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null }; }, then: resolve => resolve(result()) };
    return q;
  } };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.clearAllMocks(); writes = []; reads = []; mailboxError = false; verified = true; parked = []; draftError = false;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('a persistent mailbox database blip leaves the run active and every lead untouched', async () => {
  mailboxError = true;
  const pending = processRun(database(), run, Date.now()); await vi.runAllTimersAsync(); await pending;
  expect(writes).toEqual([]);
  expect(reads.filter(r => r.table === 'user_email_settings')).toHaveLength(3);
  expect(reads.some(r => r.table === 'leads')).toBe(false);
});
it('a real unverified sender still cancels safely before touching a lead', async () => {
  verified = false;
  await processRun(database(), run, Date.now());
  expect(writes).toContainEqual({ table: 'autopilot_runs', patch: expect.objectContaining({ status: 'cancelled' }) });
  expect(reads.filter(r => r.table === 'user_email_settings')).toHaveLength(1);
});
it.each(['draft', 'failed'])('a later run skips a lead with an earlier unsent %s before any pipeline work', async status => {
  parked = [{ id: 'draft', status, autopilot_run_leads: [{ id: 'earlier' }] }];
  const out = await precheckLead(database(), run, { id: 'row', lead_id: 'lead' }, {});
  expect(out).toMatchObject({ outcome: 'skipped', reason: expect.stringContaining('review') });
  expect(processLeadPipeline).not.toHaveBeenCalled();
  expect(reads.find(r => r.table === 'email_logs').filters).toEqual(expect.arrayContaining([['org_id', 'org'], ['lead_id', 'lead'], ['status', ['draft', 'failed']]]));
});
it('a draft lookup error fails closed without doing pipeline work', async () => {
  draftError = true;
  expect(await precheckLead(database(), run, { id: 'row', lead_id: 'lead' }, {})).toMatchObject({ outcome: 'failed' });
  expect(processLeadPipeline).not.toHaveBeenCalled();
});
it('a sent or discarded parked draft no longer blocks a later run', async () => {
  expect(await precheckLead(database(), run, { id: 'row', lead_id: 'lead' }, {})).toMatchObject({ outcome: 'sent' });
  expect(processLeadPipeline).toHaveBeenCalledOnce();
});
