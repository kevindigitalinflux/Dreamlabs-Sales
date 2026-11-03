import { expect, it } from 'vitest';
import { brandNameCandidates, registrySearchNames } from '../../supabase/functions/_shared/nameVariants';
import { pickCompany, scoreCompanyCandidates } from '../../supabase/functions/_shared/registrySearch';
const name = 'Fold7 - Global Creative Advertising Agency London HQ';
const none = {city:null,postcode:null,address:null};
const item = (company_number:string, title:string, locality='London') => ({company_number,title,company_status:'active',address:{locality,postal_code:locality==='London'?'EC1N 8TS':'M1 1AA'},address_snippet:locality});
const items = [item('04001759','FOLD 7 LIMITED'),item('01111111','FOLD DESIGN LIMITED'),item('02222222','FOLD CREATIVE LIMITED')];
it('reproduces Fold7 descriptor rejection and picks with London or postcode', () => {
 for(const location of [{...none,city:'London'},{...none,postcode:'EC1N 8TS'}]) {
  expect(pickCompany(scoreCompanyCandidates(items,name,location),name,location).chosen?.company_number).toBe('04001759');
 }
});
it('keeps ambiguous active brands and mismatched locations as choices', () => {
 const two=[...items,item('03333333','FOLD 7 HOMES LIMITED')];
 expect(pickCompany(scoreCompanyCandidates(two,name,none),name,none).chosen).toBeNull();
 const loc={...none,city:'Leeds'};
 expect(pickCompany(scoreCompanyCandidates(items,name,loc),name,loc).chosen).toBeNull();
});
it('prioritises brands within five searches and four candidates', () => {
 expect(brandNameCandidates(name)).toEqual(['Fold7','Fold 7',name]);
 expect(registrySearchNames(name).slice(0,2)).toEqual(['fold7','fold 7']);
 expect(registrySearchNames(name).length).toBeLessThanOrEqual(5);
});
it('handles separators, long tails and generic first segments conservatively', () => {
 for(const separator of [' - ',' – ',' — ',' | ',': ']) expect(brandNameCandidates(`Acme${separator}Official Site`)[0]).toBe('Acme');
 expect(brandNameCandidates('Agency | Bright Fox')).toContain('Bright Fox');
 expect(brandNameCandidates('Bright Fox Global Creative Advertising Agency London HQ')[0]).toBe('Bright Fox');
 expect(brandNameCandidates('Love Living')).toEqual(['Love Living']);
 expect(brandNameCandidates('Fold 7')[1]).toBe('Fold7');
 for(const value of ['Agency','Group','IT','', 'Co']) expect(brandNameCandidates(value)).toEqual([]);
 expect(brandNameCandidates('Sparkle Cleaning')[0]).toBe('Sparkle Cleaning');
});
