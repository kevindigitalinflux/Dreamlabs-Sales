import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchCompanyProfile: vi.fn(), fetchOfficerAppointments: vi.fn(), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn() }));
import { fetchCompanyProfile, searchCompaniesByName } from '../../supabase/functions/_shared/companiesHouse';
import { resolveRegistry, registryStep } from '../../supabase/functions/_shared/deepFindRegistry';

it.each(['IE', 'US', 'OTHER'])('skips all registry work for %s even with a saved number', async (country) => {
  vi.clearAllMocks();
  const service = { from: vi.fn() };
  const result = await resolveRegistry(service, { id: 'lead', country, company_number: '12345678', raw_lead_id: 'raw' }, 'fake');
  expect(result).toMatchObject({ how: 'not_uk', number: null, candidates: [] });
  expect(registryStep(result)).toBe('Companies House skipped: this is not a UK company.');
  expect(service.from).not.toHaveBeenCalled();
  expect(fetchCompanyProfile).not.toHaveBeenCalled();
  expect(searchCompaniesByName).not.toHaveBeenCalled();
});
it('remembers a rejected UK choice without re-searching', async () => {
  const service = { from: vi.fn() };
  expect(await resolveRegistry(service, { id: 'lead', registry_candidates_rejected: true }, 'fake')).toMatchObject({ how: 'rejected', candidates: [] });
  expect(service.from).not.toHaveBeenCalled();
});
it.each([undefined, null, 'GB'])('preserves the saved-company path for %s', async (country) => {
  vi.mocked(fetchCompanyProfile).mockResolvedValue({ name: 'Example' });
  expect(await resolveRegistry({}, { id: 'lead', country, company_number: '12345678' }, 'fake')).toMatchObject({ how: 'saved', number: '12345678' });
});
