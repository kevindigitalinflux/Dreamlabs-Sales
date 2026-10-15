import { expect, it } from 'vitest';
import { mapLookupJob, type LookupJobInput } from './lookup';
const job: LookupJobInput = { id: 'job', org_id: 'org', created_by: 'creator', kind: 'enrich', status: 'active', lead_count: 3, created_at: '2026-10-15', finished_at: null };
const viewer = { userId: 'creator', isAdmin: false };
it('names leads, links to results and shows progress', () => {
  expect(mapLookupJob(job, [{ status: 'done', review: 'none' }], ['Love Living', 'Alpha'], viewer)).toMatchObject({
    title: 'Fill in details: Alpha, Love Living +1', state: 'running', progress: { done: 1, total: 3 }, href: '/jobs/lookup/job', canStop: true, canDelete: false,
  });
});
it.each(['active', 'completed', 'cancelled'] as const)('pending proposals win over %s', (status) => {
  expect(mapLookupJob({ ...job, status }, [{ status: 'done', review: 'pending' }, { status: 'done', review: 'applied' }], [], viewer))
    .toMatchObject({ state: 'needs_you', needsYou: 1, canDelete: status !== 'active' });
});
it('ignores review flags for decision-maker jobs and names the action', () => {
  expect(mapLookupJob({ ...job, kind: 'decision_makers', status: 'completed' }, [{ status: 'done', review: 'pending' }], ['Love Living'], viewer))
    .toMatchObject({ state: 'done', needsYou: 0, title: 'Find decision makers: Love Living' });
});
it.each(['completed', 'cancelled'] as const)('uses visible rows for ended %s progress after cascade or RLS filtering', (status) => {
  const rows = [{ status: 'done' as const, review: 'none' as const }, { status: 'skipped' as const, review: 'none' as const }];
  const item = mapLookupJob({ ...job, status }, rows, [], viewer);
  expect(item.progress).toEqual({ done: 2, total: 2 });
  expect(item.detail).toContain('2 of 2');
  expect(mapLookupJob({ ...job, status }, [], [], viewer).progress).toEqual({ done: 0, total: 0 });
});
it('distinguishes failed, done and stopped outcomes', () => {
  expect(mapLookupJob({ ...job, status: 'completed' }, [{ status: 'failed', review: 'none' }], [], viewer).state).toBe('failed');
  expect(mapLookupJob({ ...job, status: 'completed' }, [{ status: 'done', review: 'dismissed' }], [], viewer).state).toBe('done');
  expect(mapLookupJob({ ...job, status: 'cancelled' }, [], [], viewer).state).toBe('stopped');
  expect(mapLookupJob({ ...job, status: 'completed' }, [], [], viewer).state).toBe('done');
});
it('only allows the creator or an admin to delete ended jobs and stop active jobs', () => {
  const ended = { ...job, status: 'completed' as const };
  expect(mapLookupJob(ended, [], [], { userId: 'other', isAdmin: false }).canDelete).toBe(false);
  expect(mapLookupJob(ended, [], [], { userId: 'admin', isAdmin: true }).canDelete).toBe(true);
  expect(mapLookupJob(job, [], [], { userId: 'admin', isAdmin: true }).canDelete).toBe(false);
  expect(mapLookupJob(job, [], [], { userId: 'other', isAdmin: false }).canStop).toBe(false);
  expect(mapLookupJob(ended, [], [], viewer).deleteWarning).toBe('Proposals you have not reviewed are removed too. Details already applied to leads stay.');
});
