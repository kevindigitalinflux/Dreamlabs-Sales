import { expect, it } from 'vitest';
import { matchRegistryEvidence } from '../../supabase/functions/_shared/registryEvidence';
const candidate = (number = '13550006', name = 'BK PROPERTY MANAGEMENT SERVICES LIMITED', status = 'active') => ({ company_number: number, name, status, address: 'Manchester', locality: 'Manchester', postcode: null, created: null, score: 90 });
const match = (candidates = [candidate()], extra = {}) => matchRegistryEvidence(candidates, 'BK Property Management Services', { postcode: null, city: 'London', address: null }, { pages: [], people: [], officers: {}, ...extra });
it.each(['We acquired SMITH BUILDERS (LEEDS) LIMITED in 2019.', 'Powered by SMITH BUILDERS (LEEDS) LIMITED', 'Our partner SMITH BUILDERS (LEEDS) LIMITED'])('ordinary mentions do not prove E3: %s', text => {
  expect(match([candidate('13550006', 'SMITH BUILDERS (LEEDS) LIMITED')], { pages: [text] }).evidence['13550006'].E3).toBe(false);
});
it.each(['Registered in England and Wales', 'Company no.', 'Company number', 'Registered office', 'Reg. no.'])('accepts separate legal wording: %s', wording => {
  expect(match(undefined, { pages: [`BK PROPERTY MANAGEMENT SERVICES LIMITED. ${wording}`] }).evidence['13550006'].E3).toBe(true);
});
it.each(['00123456', 'SC123456', 'NI012345', 'OC123456'])('accepts No. prefix and exact number %s', number => {
  expect(match([candidate(number)], { pages: [`No. ${number}`] }).chosen?.company_number).toBe(number);
  expect(match([candidate(number)], { pages: [`9${number}9`] }).evidence[number].E3).toBe(false);
});
it.each(['number', 'person'])('asks when another active legal entity carries %s proof', kind => {
  const exact = candidate(); exact.locality = 'London';
  const extra = kind === 'number' ? { pages: ['Company No. 13550007'] } : { people: ['Jane Smith'], officers: { '13550007': ['Jane Smith'] } };
  expect(match([exact, candidate('13550007', 'OTHER TRADING ENTITY LIMITED')], extra).chosen).toBeNull();
});
it('asks when two candidates share the same director', () => {
  expect(match([candidate(), candidate('13550007')], { people: ['Jane Smith'], officers: { '13550006': ['Jane Smith'], '13550007': ['Jane Smith'] } }).chosen).toBeNull();
});
it.each(['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Sir', 'Dame', 'Lord', 'Lady'])('matches titled PSC %s using first and last name', title => {
  expect(match(undefined, { people: ['Jane Smith'], officers: { '13550006': [`${title} Jane Smith`] } }).chosen).not.toBeNull();
});
it('picks BK despite registered address disagreement when own footer shows its number', () => {
  expect(match(undefined, { pages: ['Registered company number 13550006'] }).chosen?.company_number).toBe('13550006');
});
it('asks when two active candidates tie; never picks inactive or slug alone', () => {
  expect(match([candidate(), candidate('13550007')], { pages: ['13550006 13550007'] }).chosen).toBeNull();
  expect(match([candidate('13550006', undefined, 'dissolved')], { pages: ['13550006'] }).chosen).toBeNull();
  expect(match(undefined, { website: 'https://bkpropertymanagementservices.com' }).chosen).toBeNull();
});
it('accepts exact active officer proof, rejects partial names', () => {
  expect(match(undefined, { people: ['Jane Smith'], officers: { '13550006': ['Jane Smith'] } }).chosen).not.toBeNull();
  expect(match(undefined, { people: ['Jane Smith'], officers: { '13550006': ['J Smith'] } }).chosen).toBeNull();
});
it('web corroboration alone does not pick; no pages retains known-location ambiguity', () => {
  expect(match(undefined, { webNumbers: ['13550006'] }).chosen).toBeNull();
  expect(match().chosen).toBeNull();
});
it('requires exact registered-name boundaries and full person names', () => {
  expect(match([candidate('13550006', 'ACME LIMITED')], { pages: ['NOTACME LIMITED registered'], people: ['J Smith'], officers: { '13550006': ['J Smith'] } }).chosen).toBeNull();
});
it('picks one all-words match with two independent signals and asks when another ties', () => {
  const candidates = [candidate('13550006', 'BK PROPERTY MANAGEMENT SERVICES GROUP LIMITED'), candidate('13550007', 'BK PROPERTY MANAGEMENT SERVICES HOMES LIMITED')];
  candidates[0].locality = 'London';
  expect(match(candidates, { pages: ['13550006'] }).chosen?.company_number).toBe('13550006');
  candidates[1].locality = 'London';
  expect(match(candidates, { pages: ['13550006 13550007'] }).chosen).toBeNull();
});

it('finds footer legal wording when an earlier name mention has no legal context', () => {
  expect(match(undefined, { pages: ['<title>BK PROPERTY MANAGEMENT SERVICES LIMITED</title>' + ' ordinary content '.repeat(20) + '<footer>BK PROPERTY MANAGEMENT SERVICES LIMITED. Registered in England and Wales.</footer>'] }).evidence['13550006'].E3).toBe(true);
});
