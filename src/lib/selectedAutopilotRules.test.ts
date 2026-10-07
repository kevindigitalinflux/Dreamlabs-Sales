import { describe, expect, it } from 'vitest';
import {
  MAX_ERROR_LENGTH,
  decideRunState,
  shouldWaitBetweenLeads,
  skipReasonFor,
  truncateError,
  type RunStateInput,
} from '../../supabase/functions/_shared/selectedAutopilotRules';

const bounds = { startUtc: new Date('2026-10-07T09:00:00.000Z'), endUtc: new Date('2026-10-07T17:00:00.000Z') };
const base = (o: Partial<RunStateInput> = {}): RunStateInput => ({
  now: new Date('2026-10-07T12:00:00.000Z'), bounds, sentTotal: 0, sendCap: null, spentCents: 0, spendCap: null, queuedCount: 5, workingCount: 0, ...o,
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
});

describe('decideRunState', () => {
  it('processes inside the window', () => expect(decideRunState(base())).toBe('process'));
  it('waits before the window opens', () => {
    expect(decideRunState(base({ now: new Date('2026-10-07T08:59:59.000Z') }))).toBe('wait');
  });
  it('completes after the window closes', () => {
    expect(decideRunState(base({ now: new Date('2026-10-07T17:00:00.001Z') }))).toBe('complete_window_closed');
  });
  it('window closed wins over caps', () => {
    expect(decideRunState(base({ now: new Date('2026-10-07T18:00:00.000Z'), sendCap: 1, sentTotal: 1 }))).toBe('complete_window_closed');
  });
  it('send cap reached (equal or above)', () => {
    expect(decideRunState(base({ sendCap: 3, sentTotal: 3 }))).toBe('complete_send_cap');
    expect(decideRunState(base({ sendCap: 3, sentTotal: 4 }))).toBe('complete_send_cap');
  });
  it('send cap not reached yet', () => expect(decideRunState(base({ sendCap: 3, sentTotal: 2 }))).toBe('process'));
  it('spend cap reached', () => expect(decideRunState(base({ spendCap: 100, spentCents: 100 }))).toBe('complete_spend_cap'));
  it('null caps are unlimited', () => expect(decideRunState(base({ sentTotal: 999, spentCents: 99999 }))).toBe('process'));
  it('no leads left completes', () => expect(decideRunState(base({ queuedCount: 0, workingCount: 0 }))).toBe('complete_no_leads'));
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

describe('shouldWaitBetweenLeads', () => {
  const p = { remainingClaimed: 2, elapsedMs: 10000, budgetMs: 120000, gapMs: 20000 };
  it('waits when more rows remain and budget allows', () => expect(shouldWaitBetweenLeads(p)).toBe(true));
  it('does not wait with nothing remaining', () => expect(shouldWaitBetweenLeads({ ...p, remainingClaimed: 0 })).toBe(false));
  it('does not wait when the gap would overrun the budget', () => {
    expect(shouldWaitBetweenLeads({ ...p, elapsedMs: 105000 })).toBe(false);
  });
});
