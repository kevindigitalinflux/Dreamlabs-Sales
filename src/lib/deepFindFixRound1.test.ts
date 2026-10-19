import { expect, it } from 'vitest';
import { isReviewPhone, isOwnerRole, suggestionKey, visibleSuggestions } from '../../supabase/functions/_shared/deepFindSuggestions';

it.each(['020 7946 0958', '07700 900123', '+44 20 7946 0958', '+44 (0)20 7946 0958', '087 123 4567', '01 234 5678', '0207 946 0958', '01234 567890', '+353 1 234 5678', '087 160 7207', '+353 87 123 4567', '+1 212 555 0198'])('accepts plausible phone %s', value => {
  expect(isReviewPhone(value)).toBe(true);
});
it.each(['2010-2024', '2023-10-19', 'Company No. 12345678', '123456789012345', '12345678', '00000000000', '+11111111111', '09999999999', '+44 9999999999', '020123', '087123456789012', 'abc02079460958', '05-10-2019', '01.02.2023', '01/02/2023', '1/2/23'])('rejects non-phone %s', value => {
  expect(isReviewPhone(value)).toBe(false);
});
it.each(['Product Owner', 'Scrum Owner', 'Process Owner', 'Account Owner', 'Principal Consultant', 'Principal Engineer', 'Principal Designer', 'Principal Architect', 'Principal Developer', 'Principal Analyst'])('rejects non-ownership role %s', value => {
  expect(isOwnerRole(value)).toBe(false);
});
it.each(['Founder', 'Co-founder', 'CEO', 'Managing Director', 'Proprietor', 'Owner', 'Owner of the business'])('retains ownership role %s', value => {
  expect(isOwnerRole(value)).toBe(true);
});
it('uses the same canonical dismissal keys for review, automatic writes and Undo', () => {
  expect(suggestionKey({ name: '', field: 'website', value: 'https://WWW.Acme.com/path/' })).toBe('website:acme.com');
  expect(suggestionKey({ name: '', field: 'phone', value: '+44 20 7946 0958' })).toBe('phone:442079460958');
  expect(suggestionKey({ name: '', field: 'owner_name', value: ' Jane  Smith ' })).toBe('owner:jane smith');
  expect(suggestionKey({ name: 'Jane Smith', field: 'title', value: 'Founder' })).toBe('title:jane smith');
  expect(suggestionKey({ name: 'Jane Smith', field: 'linkedin_url', value: 'https://www.linkedin.com/in/Jane/' })).toBe('linkedin:https://www.linkedin.com/in/jane');
});
it('prioritises person emails and owners before company suggestions', () => {
  const company = Array.from({ length: 30 }, (_, i) => ({ name: 'Company contact', field: 'email', value: `info${i}@acme.com` }));
  const person = { name: 'Jane Smith', field: 'email', value: 'jane@acme.com' };
  const owner = { name: 'John Jones', field: 'owner_name', value: 'John Jones' };
  expect(visibleSuggestions([...company, person, owner], {}, []).slice(0, 25)).toEqual([person, owner, ...company.slice(0, 23)]);
});

it('keeps named attribution when the same address appeared earlier as a company suggestion', () => {
  const company = { name: 'Company contact', field: 'email', value: 'jane@acme.com' };
  const person = { ...company, name: 'Jane Smith' };
  expect(visibleSuggestions([company, person], {}, [])).toEqual([person]);
});

it('preserves old formatted phone and website dismissal meanings', () => {
  expect(visibleSuggestions([{ name: 'Company contact', field: 'phone', value: '+44 20 7946 0958' }], { dismissed_suggestions: ['phone:+44 (20) 7946-0958'] }, [])).toEqual([]);
  expect(visibleSuggestions([{ name: 'Company contact', field: 'website', value: 'https://acme.com/new' }], { dismissed_suggestions: ['website:https://www.acme.com/old'] }, [])).toEqual([]);
});
