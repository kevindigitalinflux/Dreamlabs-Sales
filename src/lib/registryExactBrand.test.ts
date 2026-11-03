import { expect, it } from 'vitest';
import { pickCompany, scoreCompanyCandidates } from '../../supabase/functions/_shared/registrySearch';
import { matchRegistryEvidence } from '../../supabase/functions/_shared/registryEvidence';
const loc={postcode:'EC1N 8TS',city:'London',address:null};
const item=(title:string,postcode='EC1N 8TS')=>({company_number:'04001759',title,company_status:'active',address:{postal_code:postcode,locality:'London'},address_snippet:'London'});
it.each([['Smith - Plumbing Services London HQ','SMITH ROOFING LIMITED'],['Bright - Fox Cleaning','BRIGHT SPARK LIMITED'],['Acme - Official Site','ACME ROOFING LIMITED']])('rejects subset derived brand %s', (name,company)=>{
 for(const postcode of ['EC1N 8TS','EC1N 2AA']) {
 const scored=scoreCompanyCandidates([item(company,postcode)],name,loc);
 expect(pickCompany(scored,name,loc)).toMatchObject({chosen:null,reason:'ambiguous'});
 expect(matchRegistryEvidence(scored,name,loc,{pages:[],people:[],officers:{}}).chosen).toBeNull();
 expect(scored).toHaveLength(1);
 }
});
it.each([['Acme - Official Site','ACME LIMITED'],['Fold7 - Global Creative Advertising Agency London HQ','FOLD 7 LIMITED'],['Fold 7','FOLD7 LIMITED']])('keeps exact and digit matches %s',(name,company)=>{
 const scored=scoreCompanyCandidates([item(company)],name,loc);
 expect(pickCompany(scored,name,loc).chosen).not.toBeNull();
 expect(matchRegistryEvidence(scored,name,loc,{pages:[],people:[],officers:{}}).chosen).not.toBeNull();
});
