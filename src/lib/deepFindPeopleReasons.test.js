import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({}));
vi.mock('../../supabase/functions/_shared/knownPersonWideRun', () => ({ runWideLookup: vi.fn() }));
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { runWideLookup } from '../../supabase/functions/_shared/knownPersonWideRun';
const person = { first: 'Jane', last: 'Smith', title: null, source: 'owner', contactId: null };
const context = (overrides = {}) => ({ people: [person], domains: ['example.com'], left: () => 14_000,
  keys: {}, contacts: () => [], lead: {}, spend: {}, ...overrides });

it('explains a skipped lookup for every known person, including people beyond the five-person run cap', async () => {
  const out = await lookUpPeople(context({ people: Array.from({ length: 6 }, (_, i) => ({ ...person, first: `Jane${i}` })) }));
  expect(out.results).toHaveLength(6);
  expect(out.results[0].reason).toBe('Not enough time left in this run, try Deep find again.');
  expect(out.results[5].reason).toBe('Only five people are looked up in one run, try Deep find again.');
});
it('explains absent confirmed domains', async () => {
  const out = await lookUpPeople(context({ domains: [], left: () => 60_000 }));
  expect(out.results[0].reason).toBe('No company domain is confirmed.');
});
it('replaces raw timeout detail with a fixed retry reason and says which steps ran', async () => {
  vi.mocked(runWideLookup).mockResolvedValue({ steps: [
    { id: 'website', status: 'not_found' }, { id: 'web', status: 'error', reason: 'timeout', label: 'Web search' },
  ], suggestions: [] });
  const out = await lookUpPeople(context({ left: () => 60_000 }));
  expect(out.results[0].reason).toBe('Read the company website. Tried a web search. Not enough time left in this run, try Deep find again.');
  expect(out.problems).toEqual([]);
});
