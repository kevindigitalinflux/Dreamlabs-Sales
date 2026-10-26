import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/ai', () => ({ draftEmail: vi.fn(), draftEmailClaude: vi.fn(), generateLeadNotes: vi.fn() }));
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(async () => null) }));
import { createClient } from 'npm:@supabase/supabase-js@2';
import { enrolmentActionAfterSend } from './runLeadGroups';
import { advanceEnrollment } from './sequenceMath';
import { decidePostSend } from '../../supabase/functions/_shared/postSendRules';

const steps = [1, 2, 3].map(() => ({ template_type: 'custom', template_id: 'template', delay_days: 1, subject_override: null }));
let handler, enrollment, log, writes, lookupError;
function database() {
  return { from(table) {
    let patch; const filters = [];
    const matches = row => filters.every(([k, v]) => k.includes('.') || (Array.isArray(v) ? v.includes(row[k]) : row[k] === v));
    const result = () => {
      const rows = table === 'sequence_enrollments' ? [enrollment]
        : table === 'email_logs' ? [log] : table === 'email_templates' ? [{ id: 'template', subject: 'Hi', body: 'Hello', org_id: 'org' }] : [];
      const found = rows.filter(matches);
      if (patch) { writes.push({ table, patch }); found.forEach(row => Object.assign(row, patch)); }
      return { data: found, error: table === 'email_logs' && lookupError ? { message: 'blip' } : null };
    };
    const q = { select: () => q, eq: (k, v) => { filters.push([k, v]); return q; }, in: (k, v) => { filters.push([k, v]); return q; },
      lte: () => q, gte: () => q, is: () => q, order: () => q, limit: () => q, or: () => q, not: () => q, neq: () => q,
      insert: patch => { writes.push({ table, patch }); return q; }, update: p => { patch = p; return q; },
      maybeSingle: async () => { const out = result(); return { ...out, data: out.data[0] ?? null }; }, then: resolve => resolve(result()) };
    return q;
  } };
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.resetModules();
  vi.stubGlobal('Deno', { serve: callback => { handler = callback; }, env: { get: () => 'dummy-local-only' } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network'); }));
  enrollment = { id: 'enr', lead_id: 'lead', status: 'active', current_step: 2, enrolled_by: null,
    next_send_at: '2026-10-20T12:00:00Z', sequence: { steps }, lead: { id: 'lead', org_id: 'org', email: 'local@example.invalid' } };
  log = { id: 'parked', org_id: 'org', lead_id: 'lead', sequence_enrollment_id: 'enr', to_email: 'local@example.invalid',
    status: 'draft', autopilot_run_leads: [{ id: 'prior-run-lead' }] };
  writes = []; lookupError = false;
  createClient.mockReturnValue(database());
  await import('../../supabase/functions/check-sequences/index');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function tick() {
  const pending = handler(new Request('http://localhost/check-sequences', { method: 'POST', headers: { 'x-cron-secret': 'dummy-local-only' } }));
  await vi.runAllTimersAsync();
  return (await pending).json();
}
it.each(['draft', 'failed'])('daily cron leaves a lead with an unsent parked %s alone', async status => {
  log.status = status;
  const result = await tick();
  expect(result.drafted).toBe(0);
  expect(writes).toEqual([]);
  expect(enrollment.current_step).toBe(2);
});
it('a failed parked-draft lookup defers the enrollment without changing it', async () => {
  lookupError = true;
  const result = await tick();
  expect(result.drafted).toBe(0);
  expect(writes).toEqual([]);
});
it('Review and send advances exactly once after daily cron deferred the parked step', async () => {
  await tick();
  expect(enrollment.current_step).toBe(2);
  log.status = 'sent';
  // The server post-send path defers linked drafts to NeedsInputReview; it must not advance as well.
  expect(decidePostSend({ templateId: 'template', template: { id: 'template', template_type: 'custom', is_default: false },
    enrollment: { ...enrollment, sequence_id: 'seq' }, sequences: [{ id: 'seq', name: 'Follow up', steps }], defaultTemplateIdByType: {},
    logLinkedToEnrollment: true, logEnrollmentId: 'enr', currentNextActionDate: null, todayLocal: '2026-10-26',
    now: new Date(), subject: 'Hello', recipientLabel: 'Jane' }).action).toBe('link_only');
  const action = enrolmentActionAfterSend({ logStatus: log.status, sequenceId: 'seq', logEnrollmentId: 'enr', existing: enrollment });
  expect(action).toBe('advance');
  Object.assign(enrollment, advanceEnrollment(enrollment, steps, new Date()));
  expect(enrollment.current_step).toBe(3);
});
