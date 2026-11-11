import {recipientTier,type RecipientEvidence,type TierPattern} from './recipientTier.ts';
import {emailSyntaxValid,roleAddressNeedsReview} from './emailPrecheckRules.ts';
import {inferDomainPattern,patternGuess,type PatternSample,type NamedPerson} from './domainPattern.ts';
import {displayPersonKey} from './personIdentity.ts';
import {isGenericMailbox} from './knownPersonWide.ts';
type Facts=Partial<Omit<RecipientEvidence,'forAddress'|'syntaxValid'|'roleNeedsReview'>>&{provider?:string;catchAll?:boolean};
/** Adapt the existing syntax and hosted-role rules; absent provenance never means published. */
export function prepareRecipientEvidence(address:string,facts:Facts):RecipientEvidence {
 const {provider,catchAll,...evidence}=facts;
 return {...evidence,forAddress:address,syntaxValid:emailSyntaxValid(address),hasMailServer:facts.hasMailServer??null,
  generated:facts.generated??false,roleNeedsReview:roleAddressNeedsReview(address,provider??'unknown',catchAll===true)};
}
/** Existing outcome records are evidence only inside the exact org/address scope. Checker recency stays with its reader. */
export function outcomeTierEvidence(orgId:string,address:string,rows:readonly {org_id:string;address:string;outcome:string}[]) {
 const own=rows.filter(row=>row.org_id===orgId&&row.address.trim().toLowerCase()===address.trim().toLowerCase());
 return {replied:own.some(row=>row.outcome==='replied'),bouncedHard:own.some(row=>row.outcome==='bounced_hard')};
}
export interface TierPatternSample extends PatternSample {evidence:RecipientEvidence}
/** Reuse existing format inference; only T1 samples may establish distinct-person support for another guess. */
export function supportedTierPattern(address:string,person:NamedPerson,samples:TierPatternSample[],people:NamedPerson[]):TierPattern|null {
 if(samples.length>40||people.length>20)return null;
 const domain=address.trim().toLowerCase().split('@')[1];if(!domain)return null;
 const strong=samples.filter(sample=>!isGenericMailbox(sample.email.trim().toLowerCase())&&recipientTier(sample.email,sample.evidence).tier==='T1');
 const pattern=inferDomainPattern(domain,strong,people);
 if(!pattern||patternGuess(pattern,person,domain)?.toLowerCase()!==address.trim().toLowerCase())return null;
 const t1Support=strong.slice(0,40).flatMap(sample=>{
  const names=sample.first&&sample.last?[{first:sample.first,last:sample.last}]:people;
  const matches=new Set(names.filter(name=>patternGuess(pattern,name,domain)?.toLowerCase()===sample.email.trim().toLowerCase())
   .map(name=>displayPersonKey(name.first+' '+name.last)).filter(Boolean));
  return matches.size===1?[{address:sample.email,personKey:[...matches][0]}]:[];
 });
 return {domain,candidateMatches:true,t1Support};
}
