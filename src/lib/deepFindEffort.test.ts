import { expect, it } from 'vitest';
import { effortTotals, effortPolicy, deepPhaseDecision, hunterShortfall, EFFORT_LEVELS, hunterAllowanceLeft, EFFORT_RUN_LIMITS } from '../../supabase/functions/_shared/deepFindEffort';

it.each([1, 25, 200])('scales effort totals for %i leads within run and daily limits', n => {
  expect(effortTotals('medium', n)).toEqual({ hunter: Math.min(n, 500), ai: Math.min(n * 2, 200), firecrawl: Math.min(n, 100), scrapes: Math.min(n, 100) });
  expect(effortTotals('extra_high', n).hunter).toBe(Math.min(n * 6, 500));
  expect(effortTotals('low', n)).toMatchObject({ hunter: 0, ai: 0, firecrawl: 0 });
});
it('keeps table values and legacy Custom', () => {
  expect(EFFORT_LEVELS.high).toMatchObject({ hunter: 3, ai: 4, firecrawl: 1 });
  expect(EFFORT_LEVELS.extra_high).toMatchObject({ hunter: 6, ai: 8, firecrawl: 2 });
  expect(effortPolicy({})).toBe('custom');
  expect(effortPolicy({ effort: 'low' })).toBe('low');
});
it('decides depth after free checks using all required facts', () => {
  const ready = { verifiedEmail: true, namedPerson: true, confirmedWebsite: true };
  expect(deepPhaseDecision('low', ready).run).toBe(false);
  expect(deepPhaseDecision('medium', ready).run).toBe(false);
  expect(deepPhaseDecision('medium', { ...ready, verifiedEmail: false }).run).toBe(true);
  expect(deepPhaseDecision('medium', { ...ready, namedPerson: false }).run).toBe(true);
  expect(deepPhaseDecision('medium', { ...ready, confirmedWebsite: false }).run).toBe(false);
  expect(deepPhaseDecision('high', { ...ready, confirmedWebsite: false }).run).toBe(true);
  expect(deepPhaseDecision('extra_high', ready).run).toBe(true);
  expect(deepPhaseDecision('custom', ready).run).toBe(true);
});
it('warns only when a known allowance is short', () => {
  expect(hunterShortfall(1, 25)).toContain('1 search');
  expect(hunterShortfall(25, 25)).toBeNull();
  expect(hunterShortfall(null, 25)).toBeNull();
});

it('uses one source for run credit limits', async () => {
  const { CAP_LIMITS } = await import('../../supabase/functions/_shared/deepFindRules');
  expect(EFFORT_RUN_LIMITS).toBe(CAP_LIMITS);
});
it('uses the same fallback allowance for totals and shortfall warnings', () => {
  expect(hunterAllowanceLeft({ searchesLeft: 4, creditsLeft: 20 })).toBe(4);
  expect(hunterAllowanceLeft({ searchesLeft: null, creditsLeft: 2 })).toBe(2);
  expect(hunterShortfall(hunterAllowanceLeft({ searchesLeft: null, creditsLeft: 2 }), 3)).toContain('2 searches');
  expect(hunterAllowanceLeft({ configured: false, searchesLeft: 8, creditsLeft: 8 })).toBe(0);
  expect(hunterAllowanceLeft({ usedUp: true, searchesLeft: 8, creditsLeft: 8 })).toBe(0);
  expect(hunterAllowanceLeft(null)).toBeNull();
});
