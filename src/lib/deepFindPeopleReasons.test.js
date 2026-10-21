import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({}));
vi.mock('../../supabase/functions/_shared/knownPersonWideRun', () => ({ runWideLookup: vi.fn() }));
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { runWideLookup } from '../../supabase/functions/_shared/knownPersonWideRun';
const person = { first: 'Jane', last: 'Smith', title: null, source: 'owner', contactId: null };
const context = (overrides = {}) => ({ people: [person], domains: ['example.com'], left: () => 14_000,
  keys: {}, contacts: () => [], lead: {}, spend: {}, ...overrides });

it('keeps rejected saved addresses out of wide-lookup format evidence without altering contacts', async () => {
  const contacts = [{ id: 'c', first_name: 'Jane', last_name: 'Smith', email: 'jane.smith@example.com' }];
  vi.mocked(runWideLookup).mockResolvedValue({ steps: [], suggestions: [] });
  await lookUpPeople(context({ left: () => 60_000, contacts: () => contacts, emailFormatEvidence: () => false }));
  expect(runWideLookup.mock.lastCall[0].knownAddresses).toEqual([]);
  expect(contacts[0].email).toBe('jane.smith@example.com');
});

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
it.each([null, 'one'])('keeps ambiguous wide-lookup results reviewable with contactId %s', async contactId => {
  const contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith' }, { id: 'two', first_name: 'Jane Alice', last_name: 'Smith' }];
  vi.mocked(runWideLookup).mockImplementation(async (_input, deps) => {
    deps.absorb({ email: 'jane@example.com', linkedin_url: 'https://www.linkedin.com/in/jane-smith' }, 'hunter_finder');
    return { steps: [], suggestions: [] };
  });
  const saveContact = vi.fn();
  const from = vi.fn(() => ({ upsert: () => ({ select: async () => ({ data: [], error: null }) }) }));
  const out = await lookUpPeople(context({ people: [{ ...person, contactId }], contacts: () => contacts,
    left: () => 60_000, saveContact, service: { from }, run: {} }));
  expect(saveContact).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(out.suggestions).toContainEqual(expect.objectContaining({ field: 'email', value: 'jane@example.com' }));
  expect(out.suggestions).toContainEqual(expect.objectContaining({ field: 'linkedin_url', value: 'https://www.linkedin.com/in/jane-smith' }));
});
it('replaces raw timeout detail with a fixed retry reason and says which steps ran', async () => {
  vi.mocked(runWideLookup).mockResolvedValue({ steps: [
    { id: 'website', status: 'not_found' }, { id: 'web', status: 'error', reason: 'timeout', label: 'Web search' },
  ], suggestions: [] });
  const out = await lookUpPeople(context({ left: () => 60_000 }));
  expect(out.results[0].reason).toBe('Read the company website. Tried a web search. Not enough time left in this run, try Deep find again.');
  expect(out.problems).toEqual([]);
});
