import { describe, expect, it } from 'vitest';
import {
  chipText, formatRenewalDate, formatResetLine, formatResetsIn, londonDay, nextLondonMidnight, parseLimitInput,
  parseReserve, parseSnapshot, refusalLine, remaining, stateLine, tightestAllowance, usageState, USAGE_DEFAULTS,
  USAGE_RESOURCES, type UsageRow,
} from '../../supabase/functions/_shared/usageRules';

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  resource: 'worker_verify', used: 0, limit: 150, globalUsed: 0, globalLimit: 300, resetsAt: '2026-10-15T23:00:00Z', ...over,
});

describe('defaults', () => {
  it('match the agreed caps', () => {
    expect(USAGE_DEFAULTS).toEqual({
      worker_scrape: { orgLimit: 100, globalLimit: 400 },
      worker_verify: { orgLimit: 150, globalLimit: 300 },
      worker_fetch: { orgLimit: 300, globalLimit: 1000 },
    });
    expect(USAGE_RESOURCES).toEqual(['worker_scrape', 'worker_verify', 'worker_fetch']);
  });
});

describe('London day maths', () => {
  it('uses the London date, not UTC', () => {
    expect(londonDay(new Date('2026-10-14T12:00:00Z'))).toBe('2026-10-14');
    expect(londonDay(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02'); // 00:30 BST on the 2nd
    expect(londonDay(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25'); // 00:30 BST on the 25th
  });
  it('finds the next London midnight in summer and winter', () => {
    expect(nextLondonMidnight(new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-07-01T23:00:00.000Z');
    expect(nextLondonMidnight(new Date('2026-12-01T12:00:00Z')).toISOString()).toBe('2026-12-02T00:00:00.000Z');
  });
  it('handles the 25-hour day when the clocks go back (2026-10-25)', () => {
    expect(nextLondonMidnight(new Date('2026-10-24T12:00:00Z')).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(nextLondonMidnight(new Date('2026-10-24T23:30:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(nextLondonMidnight(new Date('2026-10-25T12:00:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
  it('handles the 23-hour day when the clocks go forward (2027-03-28)', () => {
    expect(nextLondonMidnight(new Date('2027-03-27T12:00:00Z')).toISOString()).toBe('2027-03-28T00:00:00.000Z');
    expect(nextLondonMidnight(new Date('2027-03-28T12:00:00Z')).toISOString()).toBe('2027-03-28T23:00:00.000Z');
  });
});

describe('reset wording', () => {
  const at = (s: string) => new Date(s);
  it('formats the time left', () => {
    expect(formatResetsIn(at('2026-10-14T17:48:00Z'), at('2026-10-14T23:00:00Z'))).toBe('in 5h 12m');
    expect(formatResetsIn(at('2026-10-14T22:00:00Z'), at('2026-10-14T23:00:00Z'))).toBe('in 1h');
    expect(formatResetsIn(at('2026-10-14T22:30:00Z'), at('2026-10-14T23:00:00Z'))).toBe('in 30m');
    expect(formatResetsIn(at('2026-10-14T22:59:50Z'), at('2026-10-14T23:00:00Z'))).toBe('in less than a minute');
    expect(formatResetsIn(at('2026-10-14T23:00:01Z'), at('2026-10-14T23:00:00Z'))).toBe('in less than a minute');
  });
  it('builds the full line', () => {
    expect(formatResetLine(at('2026-10-14T17:48:00Z'), at('2026-10-14T23:00:00Z'))).toBe('Resets at 00:00 UK time (in 5h 12m)');
  });
  it('formats a provider renewal date, or nothing', () => {
    expect(formatRenewalDate('2026-10-18')).toBe('18 Oct');
    expect(formatRenewalDate('2026-10-18T00:00:00Z')).toBe('18 Oct');
    expect(formatRenewalDate('not a date')).toBeNull();
    expect(formatRenewalDate(null)).toBeNull();
    expect(formatRenewalDate(undefined)).toBeNull();
  });
});

describe('remaining and state', () => {
  it('uses the tighter of the organisation and shared allowance', () => {
    expect(remaining(row({ used: 40 }))).toBe(110);
    expect(remaining(row({ used: 40, globalUsed: 280 }))).toBe(20);
    expect(remaining(row({ used: 200 }))).toBe(0);
  });
  it('is ok below 80%, warning from 80%, full at the cap', () => {
    expect(usageState(row({ used: 119 }))).toBe('ok');
    expect(usageState(row({ used: 120 }))).toBe('warning');
    expect(usageState(row({ used: 149 }))).toBe('warning');
    expect(usageState(row({ used: 150 }))).toBe('full');
    expect(usageState(row({ used: 151 }))).toBe('full');
  });
  it('warns when the shared pool is 80% used and is shared_full when it is empty', () => {
    expect(usageState(row({ used: 0, globalUsed: 240 }))).toBe('warning');
    expect(usageState(row({ used: 10, globalUsed: 300 }))).toBe('shared_full');
    expect(usageState(row({ used: 10, globalUsed: 305 }))).toBe('shared_full');
  });
  it('treats a limit of 0 as full, and the organisation limit as winning over a full pool', () => {
    expect(usageState(row({ limit: 0 }))).toBe('full');
    expect(usageState(row({ used: 150, globalUsed: 300 }))).toBe('full');
  });
  it('an organisation limit above the shared cap is capped by the shared pool', () => {
    const r = row({ limit: 5000, used: 10, globalUsed: 300 });
    expect(remaining(r)).toBe(0);
    expect(usageState(r)).toBe('shared_full');
  });
});

describe('tightestAllowance and wording', () => {
  it('picks the most severe, then the lowest remaining fraction', () => {
    const rows = [
      row({ resource: 'worker_scrape', limit: 100, globalLimit: 400, used: 10 }),
      row({ resource: 'worker_verify', used: 140 }),
      row({ resource: 'worker_fetch', limit: 300, globalLimit: 1000, used: 299 }),
    ];
    expect(tightestAllowance(rows)?.resource).toBe('worker_fetch'); // 1 left of 300 beats 10 left of 150
    expect(tightestAllowance([row({ used: 150 }), row({ resource: 'worker_fetch', limit: 300, globalLimit: 1000, used: 299 })])?.resource).toBe('worker_verify'); // full beats warning
    expect(tightestAllowance([])).toBeNull();
  });
  it('writes the chip and list text in words', () => {
    expect(chipText(row({ used: 110 }))).toBe('Email checks: 40 left');
    expect(chipText(row({ used: 150 }))).toBe('Email checks: limit reached');
    expect(chipText(row({ used: 10, globalUsed: 300 }))).toBe('Email checks: shared allowance used up');
    expect(stateLine(row({ used: 110 }))).toBe('110 of 150 used today');
    expect(stateLine(row({ used: 150 }))).toBe('Limit reached (150 a day)');
    expect(stateLine(row({ used: 10, globalUsed: 300 }))).toBe('Shared worker allowance used up today');
  });
  it('writes the refusal line a feature shows when it skips the worker', () => {
    expect(refusalLine('org_limit', 'worker_verify', 150)).toBe('Extra lookup skipped: your organisation has used its 150 email checks for today (resets at 00:00 UK time).');
    expect(refusalLine('shared_pool', 'worker_scrape')).toBe('Extra lookup skipped: the shared worker allowance for site scrapes is used up for today (resets at 00:00 UK time).');
    expect(refusalLine('error', 'worker_fetch')).toBe('Extra lookup skipped: the usage check could not be completed.');
    expect(refusalLine('bad_input', 'worker_fetch')).toBe('Extra lookup skipped: the usage check could not be completed.');
  });
});

describe('parseReserve (fail closed)', () => {
  it('accepts a well-formed success and refusal', () => {
    expect(parseReserve({ ok: true, day: '2026-10-14', used: 3, limit: 150, global_used: 9, global_limit: 300 })).toEqual({ ok: true, day: '2026-10-14', used: 3, limit: 150 });
    expect(parseReserve({ ok: false, reason: 'org_limit', limit: 150 })).toEqual({ ok: false, reason: 'org_limit', limit: 150 });
    expect(parseReserve({ ok: false, reason: 'shared_pool' })).toEqual({ ok: false, reason: 'shared_pool' });
  });
  it('turns anything else into an error refusal', () => {
    for (const junk of [null, undefined, 'ok', 7, [], {}, { ok: 'true' }, { ok: true }, { ok: true, day: 'yesterday', used: 1, limit: 2 }, { ok: true, day: '2026-10-14', used: -1, limit: 2 }, { ok: false, reason: 'weird' }]) {
      expect(parseReserve(junk)).toEqual({ ok: false, reason: 'error' });
    }
  });
});

describe('parseSnapshot', () => {
  const good = (resource: string, over: Record<string, unknown> = {}) => ({ resource, used: 1, limit: 100, global_used: 2, global_limit: 400, resets_at: '2026-10-14T23:00:00+00:00', ...over });
  it('maps rows and orders them by resource', () => {
    const out = parseSnapshot([good('worker_fetch'), good('worker_scrape'), good('worker_verify')]);
    expect(out.map((r) => r.resource)).toEqual(['worker_scrape', 'worker_verify', 'worker_fetch']);
    expect(out[0]).toEqual({ resource: 'worker_scrape', used: 1, limit: 100, globalUsed: 2, globalLimit: 400, resetsAt: '2026-10-14T23:00:00+00:00' });
  });
  it('drops malformed rows and returns [] for junk', () => {
    expect(parseSnapshot([good('worker_scrape'), good('nope'), good('worker_verify', { used: 'x' }), good('worker_fetch', { resets_at: 'soon' }), null, 5])).toHaveLength(1);
    for (const junk of [null, undefined, {}, 'x', 3]) expect(parseSnapshot(junk)).toEqual([]);
  });
});

describe('parseLimitInput', () => {
  it('accepts whole numbers 0 to 5000 only', () => {
    expect(parseLimitInput('150')).toBe(150);
    expect(parseLimitInput(' 0 ')).toBe(0);
    expect(parseLimitInput('5000')).toBe(5000);
    for (const bad of ['', '5001', '-1', '1.5', '12a', '1e3', 'abc', '99999']) expect(parseLimitInput(bad)).toBeNull();
  });
});
