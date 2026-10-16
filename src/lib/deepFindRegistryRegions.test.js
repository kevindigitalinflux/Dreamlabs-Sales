import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchCompanyProfile: vi.fn(), fetchOfficerAppointments: vi.fn(), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn() }));
import { fetchCompanyProfile, searchCompaniesByName } from '../../supabase/functions/_shared/companiesHouse';
import { resolveRegistry, registryStep } from '../../supabase/functions/_shared/deepFindRegistry';

it.each(['IE', 'US', 'OTHER'])('skips registry work for %s without a saved number', async (country) => {
  vi.clearAllMocks();
  const service = { from: vi.fn() };
  const result = await resolveRegistry(service, { id: 'lead', country, raw_lead_id: 'raw' }, 'fake');
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
it.each([undefined, null, 'GB', 'IE', 'US', 'OTHER'])('saved company wins over country and rejection for %s', async (country) => {
  vi.mocked(fetchCompanyProfile).mockResolvedValue({ name: 'Example' });
  expect(await resolveRegistry({}, { id: 'lead', country, registry_candidates_rejected: true, company_number: '12345678' }, 'fake')).toMatchObject({ how: 'saved', number: '12345678' });
});
