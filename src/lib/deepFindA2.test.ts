import { expect, it } from 'vitest';
import { websiteSuspicion } from '../../supabase/functions/_shared/domainDiscovery';
import { matchRegistryEvidence } from '../../supabase/functions/_shared/registryEvidence';
import { findSamePerson, peopleToLookUp } from '../../supabase/functions/_shared/deepFindRules';
import { visibleSuggestions, planSuggestionAdd } from '../../supabase/functions/_shared/deepFindSuggestions';

const names = ['UK Residential Management Limited'];
const lead = { phone: '020 8577 0450', postcode: 'TW3 3TT', email: 'info@ukrmanagement.com', website: 'https://ukrmanagement.com' };
it.each(['UKRM Home', 'UKR Mgmt'])('accepts bounded company abbreviations: %s', title => {
  expect(websiteSuspicion([`<title>${title}</title>`], names, 'GB').suspect).toBe(false);
});
it.each(['Call +44 (0)20 8577 0450', 'TW33TT', 'Email info@ukrmanagement.com'])('requires saved contact evidence on site: %s', text => {
  const result = websiteSuspicion([`<title>Welcome Home</title>${text}`], names, 'GB', lead);
  expect(result.suspect).toBe(false);
  expect(result.reasons.join(' ')).toContain('confirmed by');
});
it('does not accept generic numbers, a mismatched phone, or postcode substrings', () => {
  for (const text of ['Call 020 8577 0451', 'Company number 02085770450', 'XTW33TTX', 'info@ukrmanagement.com.evil.org']) {
    expect(websiteSuspicion([`<title>Other Business</title>${text}`], names, 'GB', { ...lead, website: undefined }).suspect).toBe(true);
  }
});
it('retains foreign-phone and directory suspicions despite contact matches', () => {
  expect(websiteSuspicion(['<title>UKRM</title>TW3 3TT Call +1 (305) 555-0100'], names, 'GB', lead).suspect).toBe(true);
  expect(websiteSuspicion(['<title>UKRM</title>TW3 3TT'], names, 'GB', { ...lead, website: 'https://yell.com/ukrm' }).suspect).toBe(true);
});
it.each(['TW3 3TT', 'TW33TT'])('auto-picks UKRM postcode %s without city-only blockers', postcode => {
  const candidates = ['UK RESIDENTIAL MANAGEMENT LTD', 'AFCG RESIDENTIAL MANAGEMENT LIMITED', 'ALBION RIVERSIDE RESIDENTIAL MANAGEMENT LIMITED', 'ABBEY LANE RESIDENTIAL MANAGEMENT LIMITED', 'ABBOTTSFORD RESIDENTIAL MANAGEMENT COMPANY LIMITED'].map((name, i) => ({ name, company_number: i ? `0923800${i}` : '09238000', status: 'active', postcode: i ? 'SW1A 1AA' : 'TW3 3TT', address: i ? 'Other Street London' : 'Unit 1, Bellview Court, 179-183 Hanworth Rd, Hounslow', locality: i ? 'London' : 'Hounslow', created: null, score: 90 - i }));
  const result = matchRegistryEvidence(candidates, names[0], { postcode, city: 'London', address: candidates[0].address }, { pages: [], people: [], officers: {} });
  expect(result.chosen?.company_number).toBe('09238000');
  expect(result.evidence['09238001'].E2).toBe(false);
  const competing = matchRegistryEvidence(candidates, names[0], { postcode, city: 'London', address: null }, { pages: ['Company No. 09238001'], people: [], officers: {} });
  expect(competing.chosen).toBeNull();
});
it('deduplicates display and creation by full first and last names, retaining the fullest name', () => {
  const contacts = [{ id: '1', first_name: 'Karthik', last_name: 'Venkatapuram' }];
  expect(findSamePerson(contacts, 'Dr Karthik Reddy', 'Venkatapuram')?.id).toBe('1');
  expect(findSamePerson(contacts, 'K', 'Venkatapuram')).toBeNull();
  expect(findSamePerson(contacts, 'Kevin', 'Venkatapuram')).toBeNull();
  expect(findSamePerson([...contacts, { id: '2', first_name: 'Karthik Reddy', last_name: 'Venkatapuram' }], 'Karthik', 'Venkatapuram')?.id).toBe('2');
  const people = peopleToLookUp({}, contacts, [{ first_name: 'Karthik Reddy', last_name: 'Venkatapuram', title: 'Director' }]);
  expect(people).toHaveLength(1);
  expect(people[0].first).toBe('Karthik Reddy');
  expect(people[0].contactId).toBe('1');
  const suggestion = { name: 'Karthik Reddy Venkatapuram', field: 'email', value: 'karthik@example.com' };
  expect(planSuggestionAdd(suggestion, {}, contacts).kind).toBe('contact_update');
  expect(visibleSuggestions([{ name: 'Karthik Venkatapuram' }, { name: 'Karthik Reddy Venkatapuram' }], {}, [])).toEqual([{ name: 'Karthik Reddy Venkatapuram' }]);
  expect(visibleSuggestions([{ name: 'Karthik Reddy Venkatapuram' }], { dismissed_suggestions: ['person:karthik venkatapuram'] }, [])).toEqual([]);
});
