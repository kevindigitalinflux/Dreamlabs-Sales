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
it.each(['provider_blocks_checks', 'unknown', 'checker_error', 'other_reason', ''])('stops guesses after unverifiable %s', reason => {
  const checks = new GuessChecks();
  checks.record('first@ukrm.com', 'unverifiable', reason);
  expect(checks.canCheck('next@ukrm.com')).toBe(false);
});
it('keeps invalid results eligible for the next candidate', () => {
  const checks = new GuessChecks();
  checks.record('first@ukrm.com', 'invalid', 'mailbox_missing');
  expect(checks.canCheck('next@ukrm.com')).toBe(true);
});
it('shares a 20 second wall-clock budget across batches and preserves the people reserve plus floor', async () => {
  vi.useFakeTimers();
  const budget = new GuessBudget(() => 70_000, () => true);
  let active = 0, peak = 0;
  const jobs = Array.from({ length: 9 }, () => async (timeout: number) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, timeout));
    active--;
  });
  const pending = budget.run(jobs);
  await vi.advanceTimersByTimeAsync(20_000);
  await pending;
  expect(peak).toBe(3);
  expect(budget.exhausted).toBe(true);
  let called = false;
  await budget.run([async () => { called = true; }]);
  expect(called).toBe(false);
  await new GuessBudget(() => 40_000, () => true).run([async () => { called = true; }]);
  expect(called).toBe(false);
});
