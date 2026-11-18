import {expect,it} from 'vitest';
import {roleGeminiBudgetMs} from '../../supabase/functions/_shared/deepFindTimeBudget';
it.each([[120000,25000],[25000,20000],[20000,15000],[19999,null]])('budgets role Gemini with %i ms left', (left,expected)=>expect(roleGeminiBudgetMs(left)).toBe(expected));
