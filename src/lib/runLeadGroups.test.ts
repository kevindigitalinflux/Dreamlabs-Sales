import { describe, expect, it } from 'vitest';
import { countRunLeads, groupKeyFor, groupRunLeads, runFinishNote, runStatusLabel } from './runLeadGroups';

const row = (id: string, status: string, updated_at = '2026-10-08T10:00:00Z', reason: string | null = null) => ({ id, status, updated_at, reason });

describe('runLeadGroups', () => {
  it('groups rows by status in display order, folding working into queued', () => {
    const groups = groupRunLeads([row('a', 'queued'), row('b', 'sent'), row('c', 'working'), row('d', 'needs_input'), row('e', 'failed')]);
    expect(groups.map((g) => g.key)).toEqual(['sent', 'needs_input', 'skipped', 'not_reached', 'failed', 'queued']);
    expect(groups.find((g) => g.key === 'queued')?.rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(groups.find((g) => g.key === 'sent')?.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('counts every group, zero when empty', () => {
    expect(countRunLeads([row('a', 'sent'), row('b', 'sent'), row('c', 'working')])).toEqual({ sent: 2, needs_input: 0, skipped: 0, not_reached: 0, failed: 0, queued: 1 });
  });

  it('handles an empty list', () => {
    expect(groupRunLeads([]).every((g) => g.rows.length === 0)).toBe(true);
    expect(countRunLeads([]).sent).toBe(0);
  });

  it('puts an unknown status in the still-queued group, never sent', () => {
    expect(groupKeyFor('mystery')).toBe('queued');
    expect(groupRunLeads([row('a', 'mystery')]).find((g) => g.key === 'queued')?.rows).toHaveLength(1);
  });

  it('orders by updated_at ascending and keeps ties stable', () => {
    const rows = [row('late', 'sent', '2026-10-08T12:00:00Z'), row('t1', 'sent', '2026-10-08T09:00:00Z'), row('t2', 'sent', '2026-10-08T09:00:00Z'), row('early', 'sent', '2026-10-08T08:00:00Z')];
    expect(groupRunLeads(rows)[0].rows.map((r) => r.id)).toEqual(['early', 't1', 't2', 'late']);
  });

  it('labels run statuses', () => {
    expect(runStatusLabel('active')).toBe('Running');
    expect(runStatusLabel('completed')).toBe('Finished');
    expect(runStatusLabel('cancelled')).toBe('Stopped');
    expect(runStatusLabel('x')).toBe('Unknown');
  });

  it('explains caps and the finish time, and stays quiet otherwise', () => {
    expect(runFinishNote({ status: 'completed', cancel_reason: 'Daily send cap reached' }, [])).toBe('Send cap reached');
    expect(runFinishNote({ status: 'completed', cancel_reason: 'Spend cap reached' }, [])).toBe('Spend cap reached');
    expect(runFinishNote({ status: 'completed', cancel_reason: null }, [{ status: 'not_reached', reason: 'Finish time reached before this lead was reached' }])).toBe('Finish time reached');
    expect(runFinishNote({ status: 'completed', cancel_reason: null }, [{ status: 'sent', reason: null }])).toBeNull();
    expect(runFinishNote({ status: 'active', cancel_reason: null }, [])).toBeNull();
    expect(runFinishNote({ status: 'cancelled', cancel_reason: 'stopped by user' }, [])).toBeNull();
  });
});
