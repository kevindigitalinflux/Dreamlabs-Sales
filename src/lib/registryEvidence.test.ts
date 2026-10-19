import { expect, it } from 'vitest';
import { matchRegistryEvidence } from '../../supabase/functions/_shared/registryEvidence';
const candidate = (number = '13550006', name = 'BK PROPERTY MANAGEMENT SERVICES LIMITED', status = 'active') => ({ company_number: number, name, status, address: 'Manchester', locality: 'Manchester', postcode: null, created: null, score: 90 });
const match = (candidates = [candidate()], extra = {}) => matchRegistryEvidence(candidates, 'BK Property Management Services', { postcode: null, city: 'London', address: null }, { pages: [], people: [], officers: {}, ...extra });
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
