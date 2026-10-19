import { expect, it, vi } from 'vitest';
import { applyDeepFindBlank } from '../../supabase/functions/_shared/deepFindApply';

function database(beforeWrite = () => {}, error = null) {
  const row = { id: 'contact', lead_id: 'lead', email: null, dismissed_at: null, include_in_sequences: true };
  const writes = [], filters = [];
  let patch;
  const q = { update: (p) => { patch = p; writes.push(p); return q; }, eq: (k,v) => { filters.push([k,v]); return q; },
    is: (k,v) => { filters.push([k,v]); return q; }, select: async () => {
      beforeWrite(row);
      const match = filters.every(([k,v]) => row[k] === v);
      return { data: match && !error ? [{ id: row.id }] : [], error };
    } };
  return { row, writes, filters, service: { from: vi.fn(() => q) } };
}
const scope = { leadId: 'lead', orgId: 'org' };
it.each([null, '', '  '])('preserves the exact blank %j in Undo and disables contact follow-ups', async (blank) => {
  const db = database(); db.row.email = blank;
  const changes = [], checkpoint = vi.fn(async () => {});
  expect(await applyDeepFindBlank(db.service, scope, 'decision_maker_candidates', db.row, 'email', 'jane@acme.com', changes, checkpoint)).toBe(true);
  expect(changes).toEqual([{ table: 'decision_maker_candidates', id: 'contact', field: 'email', before: blank, after: 'jane@acme.com' }]);
  expect(db.filters).toEqual([['id','contact'], ['lead_id','lead'], ['dismissed_at',null], ['email',blank]]);
  expect(db.writes[0].include_in_sequences).toBe(false);
  expect(checkpoint).toHaveBeenCalledOnce();
});
it('keeps a concurrent fill and records no automatic change on a CAS miss', async () => {
  const db = database((r) => { r.email = 'human@acme.com'; });
  const changes = [];
  expect(await applyDeepFindBlank(db.service, scope, 'decision_maker_candidates', { ...db.row }, 'email', 'jane@acme.com', changes, async () => {})).toBe(false);
  expect(db.row.email).toBe('human@acme.com'); expect(changes).toEqual([]);
});
it('starts no write after authorization loss and refuses nonblank/dismissed/unsupported fields', async () => {
  const db = database(), checkpoint = async () => { throw new Error('Access lost'); };
  await expect(applyDeepFindBlank(db.service, scope, 'decision_maker_candidates', db.row, 'email', 'jane@acme.com', [], checkpoint)).rejects.toThrow('Access lost');
  expect(db.writes).toEqual([]);
  for (const row of [{ ...db.row, email: 'saved' }, { ...db.row, dismissed_at: 'date' }]) {
    expect(await applyDeepFindBlank(db.service, scope, 'decision_maker_candidates', row, 'email', 'jane@acme.com', [], checkpoint)).toBe(false);
  }
  expect(await applyDeepFindBlank(db.service, scope, 'decision_maker_candidates', db.row, 'include_in_sequences', 'true', [], checkpoint)).toBe(false);
});
