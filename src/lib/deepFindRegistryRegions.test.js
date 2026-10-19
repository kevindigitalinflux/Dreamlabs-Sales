import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchActiveOfficers: vi.fn(async () => []), fetchCompanyProfile: vi.fn(), fetchOfficerAppointments: vi.fn(), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn(async () => []) }));
vi.mock('../../supabase/functions/_shared/registryProofPeople', () => ({ fetchActivePscNames: vi.fn(async () => []) }));
import { fetchActivePscNames } from '../../supabase/functions/_shared/registryProofPeople';
import { fetchActiveOfficers, fetchCompanyProfile, searchCompaniesByName } from '../../supabase/functions/_shared/companiesHouse';
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
it('bounds evidence officer/PSC lookups to three candidates and reuses them for later evidence passes', async () => {
  vi.clearAllMocks();
  searchCompaniesByName.mockResolvedValue(Array.from({ length: 6 }, (_,i) => ({ company_number: '1355000' + i, title: 'ACME LIMITED', company_status: 'active' })));
  fetchActiveOfficers.mockResolvedValue([{ first_name: 'Jane', last_name: 'Smith', title: 'Director' }]);
  const lead = { id: 'lead', business_name: 'Acme', city: 'London' };
  const people = [{ first: 'Jane', last: 'Smith' }];
  const result = await resolveRegistry({}, lead, 'fake', people);
  expect(result.how).toBe('ambiguous');
  expect(result.allCandidates).toHaveLength(6);
  expect(fetchActiveOfficers).toHaveBeenCalledTimes(3);
  expect(fetchActivePscNames).toHaveBeenCalledTimes(3);
  const later = await resolveRegistry({}, lead, 'fake', people, { cached: result.allCandidates, cachedPeople: result.proofPeople, priorEvidence: result.evidence, webNumbers: [] });
  expect(later.how).toBe('ambiguous');
  expect(later.evidence['13550000'].E4).toBe(true);
  expect(fetchActiveOfficers).toHaveBeenCalledTimes(3);
});
