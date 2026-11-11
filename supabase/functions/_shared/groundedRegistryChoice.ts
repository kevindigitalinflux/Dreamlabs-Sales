import {companyMatchesLead,hasLocation,locationAgrees,type CompanyCandidate,type LeadLocation} from './registrySearch.ts';
/** AI proof cannot introduce a candidate absent from the Companies House search or break a plausible tie. */
export function groundedRegistryChoice(search:CompanyCandidate[],name:string,loc:LeadLocation,numbers:string[]):CompanyCandidate|null {
 const plausible=search.filter(c=>c.status==='active'&&companyMatchesLead(c.name,name)&&(!hasLocation(loc)||locationAgrees(c,loc)));
 return plausible.length===1&&numbers.includes(plausible[0].company_number)?plausible[0]:null;
}
