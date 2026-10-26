import { expect, it } from 'vitest';
import { loadReleaseDrafts } from './releaseDrafts';

function db({ links = [{ email_log_id: 'parked' }, { email_log_id: 'interrupted' }], error = null } = {}) {
  const tables = [];
  return { tables, from(table) {
    tables.push(table);
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q,
      then: resolve => resolve(table === 'email_logs' ? { data: [
        { id: 'manual', status: 'draft' }, { id: 'ordinary-sequence', status: 'draft', sequence_enrollment_id: 'enr' },
        { id: 'parked', status: 'draft' }, { id: 'interrupted', status: 'failed' },
        { id: 'orphan', status: 'failed', error_message: 'Interrupted while sending; it may already have been delivered. Check your Sent folder before retrying.' },
      ], error: null } : { data: links, error }) };
    return q;
  } };
}
it('bulk release excludes parked and interrupted drafts while retaining ordinary sequence drafts', async () => {
  const result = await loadReleaseDrafts(db(), 'org');
  expect(result.drafts.map(d => d.id)).toEqual(['manual', 'ordinary-sequence']);
  expect(result.error).toBeNull();
});
it('fails closed if Autopilot draft links cannot be checked', async () => {
  const result = await loadReleaseDrafts(db({ error: { message: 'database error' } }), 'org');
  expect(result.drafts).toEqual([]);
  expect(result.error).toContain('Could not check');
});
it('no organisation returns no drafts without querying', async () => {
  const service = db();
  expect((await loadReleaseDrafts(service, null)).drafts).toEqual([]);
  expect(service.tables).toEqual([]);
});
