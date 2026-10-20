import { expect, it } from 'vitest';
import { commonEmailCandidates, GuessChecks, optionalPeopleBudget, personEmailLine } from '../../supabase/functions/_shared/personEmailFinding';
import { scrapeTimeoutFor } from '../../supabase/functions/_shared/workerRules';
import { firecrawlTimeoutFor } from '../../supabase/functions/_shared/firecrawlRules';

it('orders five ASCII candidates, takes the first given name and joins surname punctuation', () => {
  expect(commonEmailCandidates('Éva Marie', "O’Brien-Smith", 'Example.com')).toEqual([
    'eva.obriensmith@example.com', 'eva@example.com', 'eobriensmith@example.com',
    'evaobriensmith@example.com', 'eva_obriensmith@example.com',
  ]);
  expect(commonEmailCandidates('J', 'Li', 'example.com')[2]).toBe('jli@example.com');
  expect(commonEmailCandidates('李', 'Smith', 'example.com')).toEqual([]);
  expect(commonEmailCandidates('Jane', '', 'example.com')).toEqual([]);
  expect(commonEmailCandidates('Jane', 'Smith', 'bad/domain')).toEqual([]);
});
it('counts existing-format checks, deduplicates and caps each domain at five and the lead at six', () => {
  const state = new GuessChecks();
  for (let i = 0; i < 5; i++) { expect(state.canCheck(`${i}@example.com`)).toBe(true); state.record(`${i}@example.com`, 'invalid', 'mailbox_missing'); }
  expect(state.canCheck('next@example.com')).toBe(false);
  expect(state.canCheck('0@EXAMPLE.com')).toBe(false);
  state.record('one@other.com', 'invalid', 'mailbox_missing');
  expect(state.canCheck('two@other.com')).toBe(false);
});
it('stops a catch-all domain for all people when any result says catch-all', () => {
  const state = new GuessChecks();
  state.record('jane@example.com', 'risky', 'catch_all');
  expect(state.catchAll.has('example.com')).toBe(true);
  expect(state.canCheck('john@example.com')).toBe(false);
  const later = new GuessChecks();
  later.record('jane@example.com', 'invalid', 'mailbox_missing');
  later.record('john@example.com', 'risky', 'catch_all');
  expect(later.catchAll.has('example.com')).toBe(true);
  expect(later.canCheck('next@example.com')).toBe(false);
  expect(later.canCheck('next@example.com', true)).toBe(false);
});
it('stops a person on valid, and stops all guesses when the worker cannot answer', () => {
  const state = new GuessChecks();
  state.record('jane@example.com', 'valid', 'deliverable');
  expect(state.shouldStopPerson('valid')).toBe(true);
  expect(state.shouldStopPerson('risky')).toBe(false);
  state.stopWorker();
  expect(state.canCheck('john@other.com')).toBe(false);
});
it('reserves 25 seconds only when people need an email', () => {
  expect(optionalPeopleBudget(65_000, true)).toBe(40_000);
  expect(optionalPeopleBudget(20_000, true)).toBe(0);
  expect(optionalPeopleBudget(65_000, false)).toBe(65_000);
  expect(scrapeTimeoutFor(optionalPeopleBudget(66_999, true))).toBeNull();
  expect(scrapeTimeoutFor(optionalPeopleBudget(67_000, true))).toBe(10_000);
  expect(firecrawlTimeoutFor(optionalPeopleBudget(61_999, true))).toBeNull();
  expect(firecrawlTimeoutFor(optionalPeopleBudget(62_000, true))).toBe(5_000);
});
it('explains attempts, catch-all, missing worker and time using fixed sentences', () => {
  expect(personEmailLine('Jane Smith', ['Tried 3 common formats on example.com (none confirmed).', 'Hunter is used up this month.']))
    .toBe('Jane Smith: no email found. Tried 3 common formats on example.com (none confirmed). Hunter is used up this month.');
  expect(personEmailLine('<Jane>\nSmith', [])).toBe('Jane Smith: no email found. No confirmed address was returned.');
});
