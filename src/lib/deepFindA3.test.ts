import { afterEach, expect, it, vi } from 'vitest';
import { GuessBudget, GuessChecks } from '../../supabase/functions/_shared/personEmailFinding';
import { parseCreateRequest } from '../../supabase/functions/_shared/deepFindRules';

afterEach(() => vi.useRealTimers());
it('accepts only boolean start_fresh and defaults to false', () => {
  const lead_ids = ['3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'];
  expect(parseCreateRequest({ lead_ids })).toMatchObject({ startFresh: false });
  expect(parseCreateRequest({ lead_ids, start_fresh: true })).toMatchObject({ startFresh: true });
  for (const start_fresh of [null, 1, 'true', [], {}]) expect(parseCreateRequest({ lead_ids, start_fresh })).toMatchObject({ ok: false });
});
it('reserves concurrent attempts before results and stops both guess paths on blocked domains', () => {
  const checks = new GuessChecks();
  for (let i = 0; i < 5; i++) expect(checks.claim(`${i}@ukrm.com`)).toBe(true);
  expect(checks.claim('six@ukrm.com')).toBe(false);
  expect(checks.claim('0@ukrm.com')).toBe(false);
  checks.record('0@ukrm.com', 'unverifiable', 'unknown');
  expect(checks.canCheck('another@ukrm.com', true)).toBe(false);
  expect(checks.claim('one@other.com')).toBe(true);
  expect(checks.claim('two@other.com')).toBe(false);
});
it.each(['unknown', 'checker_error', 'other_reason', ''])('allows another address after one unverifiable %s', reason => {
  const checks = new GuessChecks();
  checks.record('first@ukrm.com', 'unverifiable', reason);
  expect(checks.blocked.has('ukrm.com')).toBe(false);
  expect(checks.claim('FIRST@UKRM.COM')).toBe(false);
  expect(checks.claim('next@ukrm.com')).toBe(true);
});
it('blocks after two distinct unverifiable addresses, counting cached results only once', () => {
  const checks = new GuessChecks();
  checks.record('first@ukrm.com', 'unverifiable', 'unknown');
  checks.record('FIRST@UKRM.COM', 'unverifiable', 'checker_error');
  checks.record('first@other.com', 'unverifiable', 'unknown');
  expect(checks.claim('next@ukrm.com')).toBe(true);
  checks.record('next@ukrm.com', 'unverifiable', 'checker_error');
  expect(checks.blocked.has('ukrm.com')).toBe(true);
  expect(checks.claim('third@ukrm.com')).toBe(false);
  expect(checks.claim('next@other.com')).toBe(true);
  expect(checks.timedOut.has('ukrm.com')).toBe(false);
});
it('blocks immediately when SMTP cannot connect', () => {
  const checks = new GuessChecks();
  checks.record('first@ukrm.com', 'unverifiable', 'provider_blocks_checks');
  expect(checks.blocked.has('ukrm.com')).toBe(true);
  expect(checks.claim('next@ukrm.com')).toBe(false);
  expect(checks.claim('next@other.com')).toBe(true);
});
it('keeps five-per-domain and six-per-lead caps after duplicate unverifiable results', () => {
  const checks = new GuessChecks();
  checks.record('first@ukrm.com', 'unverifiable', 'unknown');
  checks.record('FIRST@UKRM.COM', 'unverifiable', 'unknown');
  for (let i = 0; i < 4; i++) expect(checks.claim(`${i}@ukrm.com`)).toBe(true);
  expect(checks.claim('six@ukrm.com')).toBe(false);
  expect(checks.claim('one@other.com')).toBe(true);
  expect(checks.claim('two@other.com')).toBe(false);
});
it('keeps invalid results eligible for the next candidate', () => {
  const checks = new GuessChecks();
  checks.record('first@ukrm.com', 'invalid', 'mailbox_missing');
  expect(checks.canCheck('next@ukrm.com')).toBe(true);
});
it('shares a 36 second wall-clock budget and skips a second shortened check', async () => {
  vi.useFakeTimers();
  const budget = new GuessBudget(() => 70_000, () => true);
  let active = 0, peak = 0;
  const jobs = Array.from({ length: 9 }, () => async (timeout: number) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, timeout));
    active--;
  });
  const pending = budget.run(jobs);
  await vi.advanceTimersByTimeAsync(36_000);
  await pending;
  expect(peak).toBe(3);
  expect(budget.exhausted).toBe(true);
  let called = false;
  await budget.run([async () => { called = true; }]);
  expect(called).toBe(false);
  await new GuessBudget(() => 40_000, () => true).run([async () => { called = true; }]);
  expect(called).toBe(false);
});

it('allows 33 seconds while retaining at least 25 seconds for people', () => {
  expect(new GuessBudget(() => 80_000, () => true).timeout()).toBe(33_000);
  expect(new GuessBudget(() => 45_000, () => true).timeout()).toBe(0);
});
it('blocks immediately after one timeout on each affected domain', () => {
  const checks = new GuessChecks();
  checks.record('first@one.com', null, 'timeout');
  checks.record('first@one.com', null, 'timeout');
  checks.record('first@two.com', null, 'timeout');
  expect(checks.canCheck('next@one.com')).toBe(false);
  checks.record('second@one.com', null, 'timeout');
  expect(checks.canCheck('next@one.com')).toBe(false);
  expect(checks.canCheck('next@two.com')).toBe(false);
  expect(checks.canCheck('next@other.com')).toBe(true);
});

it('ends a 33 second batch with 27 seconds left for people', async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const budget = new GuessBudget(() => 60_000 - (Date.now() - start), () => true);
  let calls = 0;
  const pending = budget.run(Array.from({ length: 9 }, () => async (timeout) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, timeout));
  }));
  await vi.advanceTimersByTimeAsync(33_000);
  await pending;
  expect(calls).toBe(3);
  expect(budget.timeout()).toBe(0);
  expect(Date.now() - start).toBe(33_000);
});
