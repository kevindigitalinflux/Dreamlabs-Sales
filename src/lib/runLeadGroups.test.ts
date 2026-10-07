import { describe, expect, it } from 'vitest';
import { applyDraftResolution, countOpenNeedsInput, needsInputResolution, shouldEnrolAfterSend, countRunLeads, formatWindowDate, RUN_LEAD_GROUP_ORDER, groupKeyFor, groupRunLeads, runFinishNote, runStatusLabel } from './runLeadGroups';

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
    expect(groupRunLeads([]).map((g) => [g.key, g.rows.length])).toEqual(RUN_LEAD_GROUP_ORDER.map((k) => [k, 0]));
    expect(countRunLeads([])).toEqual({ sent: 0, needs_input: 0, skipped: 0, not_reached: 0, failed: 0, queued: 0 });
  });

  it('formats known calendar dates with the right weekday (pure arithmetic, no time zone)', () => {
    expect(formatWindowDate('2026-10-08')).toBe('Thu 8 Oct 2026');
    expect(formatWindowDate('2026-03-29')).toBe('Sun 29 Mar 2026');
    expect(formatWindowDate('2024-02-29')).toBe('Thu 29 Feb 2024');
    expect(formatWindowDate('2026-12-31')).toBe('Thu 31 Dec 2026');
    expect(formatWindowDate('2027-01-01')).toBe('Fri 1 Jan 2027');
    expect(formatWindowDate('2000-02-29')).toBe('Tue 29 Feb 2000');
  });

  it('returns invalid dates unchanged', () => {
    for (const bad of ['2026-13-45', '2026-02-29', '2026-04-31', '2026-00-10', '2026-10-00', 'soon', '2026-1-1', '']) {
      expect(formatWindowDate(bad)).toBe(bad);
    }
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

describe('needs-input resolution', () => {
  const ni = (id: string, email_log_id: string | null, status = 'needs_input') => ({ id, status, reason: 'Unfilled placeholder', email_log_id, updated_at: '2026-10-08T10:00:00Z' });
  const logs = new Map([['l-draft', 'draft'], ['l-sent', 'sent'], ['l-failed', 'failed'], ['l-other', 'queued']]);

  it('classifies by the draft log status', () => {
    expect(needsInputResolution({ email_log_id: null }, logs)).toBe('no_draft');
    expect(needsInputResolution({ email_log_id: 'l-draft' }, logs)).toBe('open');
    expect(needsInputResolution({ email_log_id: 'l-failed' }, logs)).toBe('open');
    expect(needsInputResolution({ email_log_id: 'l-sent' }, logs)).toBe('sent');
    expect(needsInputResolution({ email_log_id: 'l-gone' }, logs)).toBe('discarded');
    expect(needsInputResolution({ email_log_id: 'l-other' }, logs)).toBe('discarded');
  });

  it('derives sent and discarded display state and leaves other rows alone', () => {
    const out = applyDraftResolution([ni('a', 'l-sent'), ni('b', 'l-gone'), ni('c', 'l-draft'), ni('d', null), ni('e', null, 'skipped')], logs);
    expect(out.map((r) => [r.id, r.status, r.reason, r.resolution])).toEqual([
      ['a', 'sent', 'Sent by you after review', 'sent'],
      ['b', 'needs_input', 'Draft was discarded', 'discarded'],
      ['c', 'needs_input', 'Unfilled placeholder', 'open'],
      ['d', 'needs_input', 'Unfilled placeholder', 'no_draft'],
      ['e', 'skipped', 'Unfilled placeholder', 'open'],
    ]);
    expect(countRunLeads(out)).toEqual({ sent: 1, needs_input: 3, skipped: 1, not_reached: 0, failed: 0, queued: 0 });
  });

  it('offers no action while the lookup is checking or failed, and never counts those as sent', () => {
    const rows = [ni('a', 'l-sent'), ni('b', 'l-gone'), ni('d', null)];
    const checking = applyDraftResolution(rows, new Map(), 'checking');
    expect(checking.map((r) => [r.id, r.status, r.reason, r.resolution])).toEqual([
      ['a', 'needs_input', 'Unfilled placeholder', 'checking'],
      ['b', 'needs_input', 'Unfilled placeholder', 'checking'],
      ['d', 'needs_input', 'Unfilled placeholder', 'no_draft'],
    ]);
    const failed = applyDraftResolution(rows, new Map([['l-sent', 'sent']]), 'failed');
    expect(failed.map((r) => r.resolution)).toEqual(['lookup_failed', 'lookup_failed', 'no_draft']);
    expect(countRunLeads(failed)).toEqual({ sent: 0, needs_input: 3, skipped: 0, not_reached: 0, failed: 0, queued: 0 });
  });

  it('counts only needs-input rows whose draft is still open', () => {
    const rows = [ni('a', 'l-sent'), ni('b', 'l-gone'), ni('c', 'l-draft'), ni('d', null), ni('e', 'l-failed'), ni('f', 'l-draft', 'sent')];
    expect(countOpenNeedsInput(rows, logs)).toBe(2);
    expect(countOpenNeedsInput([], logs)).toBe(0);
  });

  it('enrols only after a sent draft, with a sequence and no active enrolment', () => {
    expect(shouldEnrolAfterSend({ logStatus: 'sent', sequenceId: 's1', hasActiveEnrollment: false })).toBe(true);
    expect(shouldEnrolAfterSend({ logStatus: 'sent', sequenceId: null, hasActiveEnrollment: false })).toBe(false);
    expect(shouldEnrolAfterSend({ logStatus: 'sent', sequenceId: 's1', hasActiveEnrollment: true })).toBe(false);
    expect(shouldEnrolAfterSend({ logStatus: 'draft', sequenceId: 's1', hasActiveEnrollment: false })).toBe(false);
    expect(shouldEnrolAfterSend({ logStatus: undefined, sequenceId: 's1', hasActiveEnrollment: false })).toBe(false);
  });
});
