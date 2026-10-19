import { describe, expect, it } from 'vitest';
import { appointmentCompanies, companyNameMatches, officerAppointmentPaths } from '../../supabase/functions/_shared/registryOfficerSearch';
import { registrySearchNames } from '../../supabase/functions/_shared/nameVariants';
it('rejects matching initials and different first names', () => {
  const items = ['J Smith', 'John Smith', 'Jane Smith', 'SMITH, Jane Ann'].map((title, i) => ({ title, links: { self: `/officers/id${i}/appointments` } }));
  expect(officerAppointmentPaths({ items }, { first: 'Jane', last: 'Smith' })).toEqual(['/officers/id2/appointments', '/officers/id3/appointments']);
});

describe('officer search', () => {
  const search = { items: [
    { title: 'Max WHATLEY', links: { self: '/officers/AbC123/appointments' } },
    { title: 'WHATLEY, Maxwell John', links: { self: '/officers/x9/appointments' } },
    { title: 'Sam WHATLEY', links: { self: '/officers/zz/appointments' } },
    { title: 'Max WHATLEY', links: { self: 'https://evil.example/x' } },
    'junk',
  ] };
  it('keeps officers with the same surname and first name, and only safe paths', () => {
    expect(officerAppointmentPaths(search, { first: 'Max', last: 'Whatley' })).toEqual(['/officers/AbC123/appointments']);
    expect(officerAppointmentPaths({ items: 'x' }, { first: 'Max', last: 'Whatley' })).toEqual([]);
  });
  it('keeps appointments at companies matching the lead name, current first', () => {
    const appts = { items: [
      { appointed_to: { company_number: '01111111', company_name: 'SOMETHING ELSE LTD', company_status: 'active' }, officer_role: 'director' },
      { appointed_to: { company_number: '12345678', company_name: 'LOVELIVING LIMITED', company_status: 'dissolved' }, officer_role: 'director', resigned_on: '2020-01-01' },
      { appointed_to: { company_number: '87654321', company_name: 'LOVE LIVING MANAGEMENT LTD', company_status: 'active' }, officer_role: 'director' },
      { appointed_to: { company_number: 'bad' , company_name: 'LOVE LIVING' } },
    ] };
    expect(appointmentCompanies(appts, ['Love Living'], { first: 'Max', last: 'Whatley' })).toEqual([
      { company_number: '87654321', name: 'LOVE LIVING MANAGEMENT LTD', status: 'active', why: 'Max Whatley is a director there' },
      { company_number: '12345678', name: 'LOVELIVING LIMITED', status: 'dissolved', why: 'Max Whatley was a director there' },
    ]);
  });
  it('matches company names by variants', () => {
    expect(companyNameMatches('LOVELIVING LIMITED', ['Love Living'])).toBe(true);
    expect(companyNameMatches('LIVING LOVE BRANDS LTD', ['Love Living'])).toBe(true);
    expect(companyNameMatches('LOVE HOMES LTD', ['Love Living'])).toBe(false);
  });
  it('searches Companies House with london and management forms too', () => {
    expect(registrySearchNames('Love Living')).toEqual(['love living', 'loveliving', 'love living london', 'love living management']);
  });
});

describe('results view reads up to 5 candidates with their reason', () => {
  it('keeps why when present', async () => {
    const { readDeepFindDetails } = await import('./deepFindView');
    const list = Array.from({ length: 6 }, (_, i) => ({ company_number: `0000000${i}`, name: `C${i}`, why: i === 0 ? 'Max Whatley is a director there' : undefined }));
    const d = readDeepFindDetails({ company_candidates: list });
    expect(d.companyCandidates).toHaveLength(5);
    expect(d.companyCandidates[0]).toMatchObject({ why: 'Max Whatley is a director there' });
    expect(d.companyCandidates[1]).not.toHaveProperty('why');
  });
});
