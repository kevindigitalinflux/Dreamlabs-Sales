import { expect, it } from 'vitest';
import { leadDeadline, FINAL_SAVE_RESERVE_MS, LEAD_RESERVE_MS, WALL_BUDGET_MS } from '../../supabase/functions/_shared/deepFindTimeBudget';
import { GuessBudget } from '../../supabase/functions/_shared/personEmailFinding';
import { vi } from 'vitest';

it('gives an early lead 120 seconds and reserves ten seconds for invocation saves',()=>{
 expect(leadDeadline(0)).toBe(120000);
 expect(leadDeadline(2000,130000)).toBe(120000);
 expect(leadDeadline(29000,130000)).toBe(120000);
 expect(WALL_BUDGET_MS).toBe(130000);
 expect(FINAL_SAVE_RESERVE_MS).toBe(10000);
 expect(LEAD_RESERVE_MS).toBe(100000);
});
it('admits only two full 33-second serial responses while retaining the people reserve',()=>{
 let now=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 try {
  const budget=new GuessBudget(()=>120000-now,()=>true);
  expect(budget.timeLeft()).toBe(95000);
  expect(budget.timeout()).toBe(33000);now+=33000;
  expect(budget.timeout()).toBe(33000);now+=33000;
  expect(budget.timeout()).toBe(0);
  expect(budget.timeLeft()).toBe(29000);
 } finally {clock.mockRestore();}
});
