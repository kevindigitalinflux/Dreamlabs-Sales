import { describe, expect, it } from 'vitest';
import {
  MAX_ERROR_LENGTH,
  STUCK_SEND_REASON,
  canStartLead,
  decideRunState,
  shouldWaitBetweenLeads,
  skipReasonFor,
  stuckRowAction,
  truncateError,
  type RunStateInput,
} from '../../supabase/functions/_shared/selectedAutopilotRules';

const bounds = { startUtc: new Date('2026-10-07T09:00:00.000Z'), endUtc: new Date('2026-10-07T17:00:00.000Z') };
const base = (o: Partial<RunStateInput> = {}): RunStateInput => ({
  now: new Date('2026-10-07T12:00:00.000Z'), bounds, runStartedAt: new Date('2026-10-07T08:00:00.000Z'),
  sentTotal: 0, sendCap: null, spentCents: 0, spendCap: null, queuedCount: 5, workingCount: 0, ...o,
});

describe('skipReasonFor', () => {
  it('maps every ineligible reason to plain English', () => {
    expect(skipReasonFor('opted_out')).toBe('Lead has opted out of emails');
    expect(skipReasonFor('blocked')).toBe('Lead is on the blocklist');
    expect(skipReasonFor('closed')).toBe('Lead is already won or lost');
    expect(skipReasonFor('paused')).toBe('Lead is in a paused sequence');
    expect(skipReasonFor('not_due')).toBe('Already in a sequence and not due today');
    expect(skipReasonFor('recently_contacted')).toBe('Contacted recently and not due');
  });
  it('unknown code gets a generic reason', () => expect(skipReasonFor('mystery')).toBe('Lead is not eligible right now'));
});

describe('decideRunState', () => {
  it('processes inside the window', () => expect(decideRunState(base())).toBe('process'));
  it('waits before the window opens', () => {
    expect(decideRunState(base({ now: new Date('2026-10-07T08:59:59.000Z') }))).toBe('wait');
  });
  it('completes after the window closes', () => {
    expect(decideRunState(base({ now: new Date('2026-10-07T17:00:00.001Z') }))).toBe('complete_window_closed');
  });
  it('exactly at start processes, exactly at end is closed (end exclusive)', () => {
    expect(decideRunState(base({ now: bounds.startUtc }))).toBe('process');
    expect(decideRunState(base({ now: bounds.endUtc }))).toBe('complete_window_closed');
  });
  it('window closed wins over caps', () => {
    expect(decideRunState(base({ now: new Date('2026-10-07T18:00:00.000Z'), sendCap: 1, sentTotal: 1 }))).toBe('complete_window_closed');
  });
  it('send cap reached (equal or above)', () => {
    expect(decideRunState(base({ sendCap: 3, sentTotal: 3 }))).toBe('complete_send_cap');
    expect(decideRunState(base({ sendCap: 3, sentTotal: 4 }))).toBe('complete_send_cap');
  });
  it('send cap of 0 completes immediately', () => expect(decideRunState(base({ sendCap: 0 }))).toBe('complete_send_cap'));
  it('send cap not reached yet', () => expect(decideRunState(base({ sendCap: 3, sentTotal: 2 }))).toBe('process'));
  it('spend cap reached', () => expect(decideRunState(base({ spendCap: 100, spentCents: 100 }))).toBe('complete_spend_cap'));
  it('null caps are unlimited', () => expect(decideRunState(base({ sentTotal: 999, spentCents: 99999 }))).toBe('process'));
  it('no leads left completes', () => expect(decideRunState(base({ queuedCount: 0, workingCount: 0 }))).toBe('complete_no_leads'));
  it('no leads but run younger than 60s waits (creation race)', () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    expect(decideRunState(base({ queuedCount: 0, workingCount: 0, runStartedAt: new Date(now.getTime() - 30000) }))).toBe('wait');
    expect(decideRunState(base({ queuedCount: 0, workingCount: 0, runStartedAt: new Date(now.getTime() - 60001) }))).toBe('complete_no_leads');
  });
  it('working rows keep the run open', () => expect(decideRunState(base({ queuedCount: 0, workingCount: 1 }))).toBe('process'));
});

describe('truncateError', () => {
  it('uses the message of an Error and truncates to 300', () => {
    expect(truncateError(new Error('x'.repeat(500))).length).toBe(MAX_ERROR_LENGTH);
  });
  it('handles strings and unknowns without stack', () => {
    expect(truncateError('boom')).toBe('boom');
    expect(truncateError(undefined)).toBe('Unexpected error');
    expect(truncateError(new Error('bad')).includes('at ')).toBe(false);
  });
});

describe('time budget', () => {
  const p = { elapsedMs: 10000, budgetMs: 130000, gapMs: 20000, reserveMs: 90000 };
  it('canStartLead needs the reserve to fit', () => {
    expect(canStartLead({ elapsedMs: 40000, budgetMs: 130000, reserveMs: 90000 })).toBe(true);
    expect(canStartLead({ elapsedMs: 40001, budgetMs: 130000, reserveMs: 90000 })).toBe(false);
  });
  it('waits for the gap only if the next lead still fits after it', () => {
    expect(shouldWaitBetweenLeads(p)).toBe(true);
    expect(shouldWaitBetweenLeads({ ...p, elapsedMs: 20000 })).toBe(true); // 20 + 20 + 90 == 130 boundary
    expect(shouldWaitBetweenLeads({ ...p, elapsedMs: 20001 })).toBe(false);
  });
});

describe('stuckRowAction', () => {
  const now = new Date('2026-10-07T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it('leaves recent working rows alone', () => expect(stuckRowAction({ claimed_at: ago(5 * 60000), send_started_at: null }, now)).toBe('ignore'));
  it('requeues old rows that never started sending', () => expect(stuckRowAction({ claimed_at: ago(11 * 60000), send_started_at: null }, now)).toBe('requeue'));
  it('fails old rows that started sending, never requeues them', () => {
    expect(stuckRowAction({ claimed_at: ago(11 * 60000), send_started_at: ago(10 * 60000) }, now)).toBe('fail');
    expect(STUCK_SEND_REASON).toBe('Interrupted during send. Check Email logs before retrying.');
  });
  it('rows with no claimed_at are requeued', () => expect(stuckRowAction({ claimed_at: null, send_started_at: null }, now)).toBe('requeue'));
});
