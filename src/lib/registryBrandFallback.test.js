import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchActiveOfficers: vi.fn(async () => []), fetchCompanyProfile: vi.fn(), fetchOfficerAppointments: vi.fn(), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn(async () => []) }));
import { fetchCompanyProfile } from '../../supabase/functions/_shared/companiesHouse';
import { resolveRegistry } from '../../supabase/functions/_shared/deepFindRegistry';
const lead = {id:'lead',business_name:'Fold7 - Global Creative Advertising Agency London HQ',postcode:'EC1N 8TS',city:'London'};
it('verifies a web-only number through the registry before using it', async () => {
 fetchCompanyProfile.mockResolvedValue({name:'FOLD 7 LIMITED',status:'active',postcode:'EC1N 8TS',locality:'London',address:'16-18 Kirby Street, London EC1N 8TS'});
 const applyNumber=vi.fn(async()=>true);
 const result=await resolveRegistry({},lead,'fake',[],{cached:[],webNumbers:['04001759'],applyNumber});
 expect(fetchCompanyProfile).toHaveBeenCalledWith('04001759','fake');
 expect(result.number).toBe('04001759'); expect(applyNumber).toHaveBeenCalledWith('04001759');
});
it.each([
 {name:'UNRELATED LIMITED',status:'active',postcode:'EC1N 8TS',locality:'London',address:'London'},
 {name:'FOLD 7 LIMITED',status:'dissolved',postcode:'EC1N 8TS',locality:'London',address:'London'},
 {name:'FOLD 7 LIMITED',status:'active',postcode:'M1 1AA',locality:'Manchester',address:'Manchester'},
 null,
])('rejects unverified, inactive, unrelated or wrong-location web profiles',async profile=>{
 fetchCompanyProfile.mockResolvedValue(profile);
 const applyNumber=vi.fn(async()=>true);
 const result=await resolveRegistry({},lead,'fake',[],{cached:[],webNumbers:['04001759'],applyNumber});
 expect(result.number).toBeNull(); expect(applyNumber).not.toHaveBeenCalled();
});
