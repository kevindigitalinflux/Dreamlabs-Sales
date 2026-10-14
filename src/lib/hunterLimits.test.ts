import { describe, expect, it } from 'vitest';
import {
  classifyHunter429, hunterAccountEmpty, hunterAccountLine, parseHunterAccount, retryWaitMs, DEFAULT_RETRY_WAIT_MS,
} from '../../supabase/functions/_shared/hunterLimits';

describe('classifyHunter429', () => {
  it('tells used-up monthly searches apart from a rate limit', () => {
    expect(classifyHunter429({ errors: [{ id: 'usage_limit_reached', code: 429 }] })).toBe('usage_exhausted');
    expect(classifyHunter429({ errors: [{ id: 'too_many_requests', code: 429 }] })).toBe('rate_limited');
    expect(classifyHunter429({ errors: [{ id: 'x', details: 'You have reached your monthly quota' }] })).toBe('usage_exhausted');
    expect(classifyHunter429('{"errors":[{"id":"usage_limit_reached"}]}')).toBe('usage_exhausted');
    expect(classifyHunter429(null)).toBe('rate_limited');
    expect(classifyHunter429({ errors: 'nope' })).toBe('rate_limited');
  });
});

describe('retryWaitMs', () => {
  it('honours a short Retry-After and refuses a long one', () => {
    expect(retryWaitMs('2')).toBe(2000);
    expect(retryWaitMs('30')).toBeNull();
    expect(retryWaitMs(null)).toBe(DEFAULT_RETRY_WAIT_MS);
    expect(retryWaitMs('Wed, 21 Oct 2015 07:28:01 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(1000);
    expect(retryWaitMs('soon')).toBe(DEFAULT_RETRY_WAIT_MS);
  });
});

describe('Hunter account', () => {
  it('reads searches and credits defensively', () => {
    const a = parseHunterAccount({ data: { reset_date: '2026-10-18', requests: { searches: { used: 20, available: 25 }, credits: { used: 3, available: 50 } } } });
    expect(a).toEqual({ searchesUsed: 20, searchesAvailable: 25, searchesLeft: 5, creditsLeft: 47, resetDate: '2026-10-18' });
    expect(parseHunterAccount({ data: { requests: { searches: { used: 1, available: 25 } } } })?.resetDate).toBeNull();
    expect(parseHunterAccount({ data: { reset_date: 'soon', requests: { searches: { used: 1, available: 25 } } } })?.resetDate).toBeNull();
    expect(parseHunterAccount({ data: { reset_date: '2026-10-18<script>', requests: { searches: { used: 1, available: 25 } } } })?.resetDate).toBeNull();
    expect(hunterAccountLine(a)).toBe('Hunter: 5 searches left this month.');
    expect(hunterAccountEmpty(a)).toBe(false);
    const empty = parseHunterAccount({ data: { requests: { searches: { used: 25, available: 25 } } } });
    expect(hunterAccountEmpty(empty)).toBe(true);
    expect(hunterAccountLine(empty)).toBe('Hunter: 0 searches left this month.');
    expect(parseHunterAccount({ data: { requests: { searches: { used: 'x' } } } })).toBeNull();
    expect(parseHunterAccount('nope')).toBeNull();
    expect(hunterAccountLine(null)).toBeNull();
  });
});

describe('limit lines', () => {
  it('collapses Hunter used-up and slow-down answers into one line each, but not Gemini ones', async () => {
    const { problemLines } = await import('../../supabase/functions/_shared/deepFindProblems');
    expect(problemLines([
      { step: 'hunter_company', target: 'loveliving', failure: 'usage_exhausted' },
      { step: 'hunter_list', target: 'lovelivingmanagement.com', failure: 'usage_exhausted' },
      { step: 'person', target: 'David Sipple, Hunter email finder (loveliving.uk)', failure: 'usage_exhausted' },
      { step: 'hunter_finder', target: 'love living', failure: 'rate_limited' },
      { step: 'person', target: 'David Sipple, Web search', failure: 'rate_limited' },
    ])).toEqual([
      'Hunter says this account\'s searches for the month are used up, so Hunter steps were skipped.',
      'Hunter asked us to slow down, so some Hunter steps were skipped. Try again in a few minutes.',
      'Looking up David Sipple, Web search: Gemini refused the request (error 429, too many requests, try again later).',
    ]);
  });
  it('words the allowance for the confirm dialog', async () => {
    const { hunterAllowanceText } = await import('./deepFind');
    expect(hunterAllowanceText({ configured: true, available: true, usedUp: false, searchesLeft: 7, creditsLeft: null, resetDate: null })).toBe('Hunter: 7 searches left this month.');
    expect(hunterAllowanceText({ configured: true, available: true, usedUp: true, searchesLeft: 0, creditsLeft: null, resetDate: null })).toMatch(/used up/);
    expect(hunterAllowanceText({ configured: false, available: false, usedUp: false, searchesLeft: null, creditsLeft: null, resetDate: null })).toMatch(/No Hunter key/);
    expect(hunterAllowanceText(null)).toBeNull();
  });
});
