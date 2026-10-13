import { describe, expect, it } from 'vitest';
import {
  cleanCompanyNumber, companyNameTokens, locationAgrees, parseCompanySearchItems, pickCompany, scoreCompanyCandidates,
} from '../../supabase/functions/_shared/registrySearch';
import { parseLeadPersonName, peopleToLookUp } from '../../supabase/functions/_shared/deepFindRules';

const item = (n: string, title: string, status: string, postcode: string | null, locality: string | null) => ({
  company_number: n, title, company_status: status, address_snippet: `1 High St, ${locality ?? ''}, ${postcode ?? ''}`,
  address: { postal_code: postcode, locality }, date_of_creation: '2015-01-01',
});
const NONE = { postcode: null, city: null, address: null };

describe('company numbers and names', () => {
  it('accepts only Companies House number shapes', () => {
    expect(cleanCompanyNumber(' sc123456 ')).toBe('SC123456');
    expect(cleanCompanyNumber('01234567')).toBe('01234567');
    expect(cleanCompanyNumber('1234567')).toBe(null);
    expect(cleanCompanyNumber('01234567; drop')).toBe(null);
  });
  it('ignores legal forms and "&"', () => {
    expect(companyNameTokens('LOVE & LIVING MANAGEMENT LIMITED')).toEqual(['love', 'living', 'management']);
    expect(companyNameTokens(null)).toEqual([]);
  });
  it('parses search items defensively', () => {
    expect(parseCompanySearchItems([item('01234567', 'X LTD', 'active', 'E8 3PL', 'London'), { company_number: 'bad' }, 'x'])).toHaveLength(1);
    expect(parseCompanySearchItems('nope')).toEqual([]);
  });
});

describe('pickCompany (Review Focus 1 and 2)', () => {
  const items = [
    item('01111111', 'LOVE LIVING MANAGEMENT LIMITED', 'active', 'E8 3PL', 'London'),
    item('02222222', 'LOVE LIVING LTD', 'active', 'M1 1AA', 'Manchester'),
    item('03333333', 'LOVE LIVING HOMES LTD', 'dissolved', 'E8 1AA', 'London'),
  ];
  it('picks the company whose address agrees with the lead (Hackney)', () => {
    const loc = { postcode: null, city: 'Hackney', address: null };
    const withHackney = [{ ...items[0]!, address_snippet: '10 Mare St, Hackney, London, E8 3PL' }, items[1], items[2]];
    const p = pickCompany(scoreCompanyCandidates(withHackney, 'Love Living', loc), 'Love Living', loc);
    expect(p).toMatchObject({ reason: 'auto_location', chosen: { company_number: '01111111' } });
  });
  it('asks the user for a common name with no location', () => {
    const p = pickCompany(scoreCompanyCandidates(items, 'Love Living', NONE), 'Love Living', NONE);
    expect(p.chosen).toBe(null);
    expect(p.reason).toBe('ambiguous');
    expect(p.candidates).toHaveLength(3);
  });
  it('never picks a dissolved company or a match in a different town', () => {
    const dissolved = [item('03333333', 'LOVE LIVING HOMES LTD', 'dissolved', 'E8 1AA', 'London')];
    expect(pickCompany(scoreCompanyCandidates(dissolved, 'Love Living Homes', NONE), 'Love Living Homes', NONE).chosen).toBe(null);
    const leeds = { postcode: 'LS1 1AA', city: 'Leeds', address: null };
    const one = [item('02222222', 'LOVE LIVING LTD', 'active', 'M1 1AA', 'Manchester')];
    expect(pickCompany(scoreCompanyCandidates(one, 'Love Living', leeds), 'Love Living', leeds).chosen).toBe(null);
  });
  it('auto-picks a single exact, active name when the lead has no location', () => {
    const one = [item('04444444', 'PRIMROSE BAKERY LTD', 'active', 'NW1 1AA', 'London')];
    expect(pickCompany(scoreCompanyCandidates(one, 'Primrose Bakery', NONE), 'Primrose Bakery', NONE).reason).toBe('auto_unique');
    const two = [...one, item('05555555', 'PRIMROSE BAKERY HOLDINGS LTD', 'active', 'NW1 1AA', 'London')];
    expect(pickCompany(scoreCompanyCandidates(two, 'Primrose Bakery', NONE), 'Primrose Bakery', NONE).reason).toBe('ambiguous');
  });
  it('matches a location by postcode or outward code', () => {
    expect(locationAgrees({ postcode: 'E8 3PL', locality: null, address: null }, { postcode: 'e83pl', city: null, address: null })).toBe(true);
    expect(locationAgrees({ postcode: 'E8 1ZZ', locality: null, address: null }, { postcode: 'E8 3PL', city: null, address: null })).toBe(true);
    expect(locationAgrees({ postcode: 'M1 1AA', locality: 'Manchester', address: null }, { postcode: 'E8 3PL', city: 'Hackney', address: null })).toBe(false);
  });
});

describe('people to look up', () => {
  it('reads names written on the lead', () => {
    expect(parseLeadPersonName('David John SIPPLE')).toEqual({ first: 'David', last: 'Sipple', title: null });
    expect(parseLeadPersonName('Deborah Garner (HR)')).toEqual({ first: 'Deborah', last: 'Garner', title: 'HR' });
    expect(parseLeadPersonName('John Sipple (director)')).toEqual({ first: 'John', last: 'Sipple', title: 'Director' });
    expect(parseLeadPersonName('WHATLEY, Max')).toEqual({ first: 'Max', last: 'Whatley', title: null });
    expect(parseLeadPersonName('Reception')).toBe(null);
    expect(parseLeadPersonName(5)).toBe(null);
  });
  it('combines contacts without email, officers and owner names without repeats', () => {
    const people = peopleToLookUp(
      { owner_name: 'David John SIPPLE', additional_owners: ['Deborah Garner (HR)', 'John Sipple (director)'] },
      [
        { id: 'c1', kind: 'person', first_name: 'Max', last_name: 'Whatley', email: null },
        { id: 'c2', kind: 'person', first_name: 'Deborah', last_name: 'Garner', email: 'deb@loveliving.uk' },
        { id: 'c3', kind: 'general', first_name: null, last_name: null, email: null },
      ],
      [{ first_name: 'Max', last_name: 'Whatley', title: 'Director' }, { first_name: 'Ann', last_name: 'Lee', title: 'Secretary' }],
    );
    expect(people.map((p) => `${p.source}:${p.first} ${p.last}`)).toEqual([
      'contact:Max Whatley', 'officer:Ann Lee', 'owner:David Sipple', 'owner:John Sipple',
    ]);
    expect(people[0]!.contactId).toBe('c1');
  });
});
