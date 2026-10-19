import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawLead } from '../types';
import { scrapeDeepFindLeadId } from './scrapeDeepFind';

it('requires human approval before resolving a scraper result for Deep find', async () => {
  const from = vi.fn();
  await expect(scrapeDeepFindLeadId({ from } as unknown as SupabaseClient, { status: 'pending' } as RawLead, 'org')).rejects.toThrow('Approve');
  expect(from).not.toHaveBeenCalled();
});
it('resolves merged source IDs through the session with the organisation boundary', async () => {
  const calls: unknown[] = [];
  const q = { select: () => q, eq: (...args: unknown[]) => { calls.push(args); return q; }, in: (...args: unknown[]) => { calls.push(args); return q; }, limit: async () => ({ data: [{ id: 'lead' }], error: null }) };
  const db = { from: vi.fn(() => q) } as unknown as SupabaseClient;
  expect(await scrapeDeepFindLeadId(db, { id: 'one', rawIds: ['one', 'two'], status: 'approved' } as unknown as RawLead, 'org')).toBe('lead');
  expect(calls).toEqual([['org_id', 'org'], ['raw_lead_id', ['one', 'two']]]);
});
