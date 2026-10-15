import { describe, expect, it } from 'vitest';
import type { JobItem } from './model';
import { decidePopups, popupKey } from './popups';
import { seenKey } from './view';

const now = new Date('2026-10-16T12:00:00Z');
const job = (state: JobItem['state'], id = 'lookup:one'): JobItem => ({
  id, sourceId: id, kind: 'lookup', title: 'Fill in details: Love Living', detail: '1 lead to review',
  state, progress: null, needsYou: state === 'needs_you' ? 1 : 0, startedAt: now.toISOString(),
  finishedAt: state === 'done' || state === 'failed' ? now.toISOString() : null,
  href: '/jobs/lookup/one', canStop: false, canDelete: false, deleteWarning: null, deleteBlockedReason: null,
});
const decide = (previous: JobItem[] | null, next: JobItem[], options = {}) =>
  decidePopups({ previous, next, seen: new Set<string>(), hidden: true, enabled: true, permission: 'granted', now, ...options });

describe('desktop job popups', () => {
  it('is silent on first load', () => expect(decide(null, [job('done'), job('needs_you')])).toEqual([]));
  it.each(['needs_you', 'done', 'failed'] as const)('notifies a transition to %s with plain text', (state) => {
    const result = decide([job('running')], [job(state)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ body: '1 lead to review', href: '/jobs/lookup/one', tag: `lookup:one:${state}` });
  });
  it('notifies a newly arriving job after the baseline', () => expect(decide([], [job('needs_you')])).toHaveLength(1));
  it('ignores unchanged state and running progress', () => {
    expect(decide([job('needs_you')], [job('needs_you')])).toEqual([]);
    expect(decide([job('running')], [job('running')])).toEqual([]);
  });
  it('is silent when the needs-you count changes within one stretch', () => {
    const first = job('needs_you');
    const later = { ...first, needsYou: 2 };
    const seen = new Set(decide([job('running')], [first]).flatMap((p) => p.keys));
    expect(decide([first], [later], { seen })).toEqual([]);
    expect(decide([later], [first], { seen })).toEqual([]);
  });
  it('notifies once again on re-entry with the same needs-you count', () => {
    const first = job('needs_you');
    const initial = decide([job('running')], [first]);
    const seen = new Set(initial.flatMap((p) => p.keys));
    expect(decide([first], [job('running')], { seen })).toEqual([]);
    const reentry = decide([job('running')], [first], { seen });
    expect(reentry).toHaveLength(1);
    expect(reentry[0].keys.some((key) => seen.has(key))).toBe(false);
    reentry[0].keys.forEach((key) => seen.add(key));
    expect(decide([first], [first], { seen })).toEqual([]);
    expect(decide(null, [first], { seen })).toEqual([]);
  });
  it.each(['done', 'failed'] as const)('suppresses seen or previously delivered %s jobs', (state) => {
    expect(decide([], [job(state)], { seen: new Set([seenKey(job(state))]) })).toEqual([]);
    expect(decide([], [job(state)], { seen: new Set([popupKey(job(state))]) })).toEqual([]);
  });
  it.each([{ enabled: false }, { hidden: false }, { permission: 'denied' }, { permission: 'default' }])('suppresses when %j', (options) => {
    expect(decide([], [job('done')], options)).toEqual([]);
  });
  it('caps at three and adds one summary carrying all remaining event keys', () => {
    const result = decide([], Array.from({ length: 8 }, (_, i) => job('needs_you', `lookup:${i}`)));
    expect(result).toHaveLength(4);
    expect(result[3]).toMatchObject({ title: '+5 more jobs', href: '/jobs' });
    expect(result.flatMap((r) => r.keys)).toHaveLength(8);
  });
  it('ignores campaigns, stopped jobs and old finished items', () => {
    expect(decide([], [{ ...job('done'), kind: 'campaign' }, job('stopped'), { ...job('done'), finishedAt: '2026-01-01' }])).toEqual([]);
  });
});
