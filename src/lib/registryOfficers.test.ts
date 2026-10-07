import { describe, expect, it } from 'vitest';
import { mapCompaniesHouseOfficers, officerTitle, splitOfficerName } from '../../supabase/functions/_shared/registryOfficers';

describe('splitOfficerName', () => {
  it('handles "SURNAME, Forename Middle"', () => {
    expect(splitOfficerName('SMITH, John Paul')).toEqual({ first_name: 'John', last_name: 'Smith' });
  });
  it('handles plain "Forename Surname"', () => {
    expect(splitOfficerName('Aoife Murphy')).toEqual({ first_name: 'Aoife', last_name: 'Murphy' });
  });
  it('handles a single token', () => {
    expect(splitOfficerName('Madonna')).toEqual({ first_name: 'Madonna', last_name: null });
  });
});

describe('officerTitle', () => {
  it('maps roles to readable titles', () => {
    expect(officerTitle('director')).toBe('Director');
    expect(officerTitle('secretary')).toBe('Company Secretary');
    expect(officerTitle('llp-member')).toBe('Llp Member');
    expect(officerTitle(undefined)).toBeNull();
  });
});

describe('mapCompaniesHouseOfficers', () => {
  it('drops resigned and corporate officers, directors first, capped', () => {
    const out = mapCompaniesHouseOfficers([
      { name: 'ACME SECRETARIES LIMITED', officer_role: 'corporate-secretary' },
      { name: 'JONES, Mary', officer_role: 'secretary' },
      { name: 'SMITH, John', officer_role: 'director' },
      { name: 'OLD, Bob', officer_role: 'director', resigned_on: '2020-01-01' },
    ]);
    expect(out.map((o) => o.first_name)).toEqual(['John', 'Mary']);
    expect(out[0]).toEqual({ first_name: 'John', last_name: 'Smith', title: 'Director' });
  });
  it('returns an empty array for no officers', () => {
    expect(mapCompaniesHouseOfficers([])).toEqual([]);
  });
});
