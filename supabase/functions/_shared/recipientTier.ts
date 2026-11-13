export type RecipientTier='T1'|'T2'|'T3'|'never';
export interface TierPattern {
 domain:string;candidateMatches:boolean;
 /** Only already-T1 addresses with a uniquely established, canonical person identity. */
 t1Support:readonly {address:string;personKey:string}[];
}
/** Trusted server-prepared facts, scoped to one exact address. Never accept these flags from a browser payload. */
export interface RecipientEvidence {
 forAddress:string;syntaxValid:boolean;hasMailServer:boolean|null;generated:boolean;roleNeedsReview:boolean;
 checker?:'valid'|'invalid'|'unverifiable';bouncedHard?:boolean;optedOut?:boolean;blocklisted?:boolean;
 replied?:boolean;sentOk?:boolean;publishedByCompany?:boolean;placesEmail?:boolean;savedNonGuessed?:boolean;
 msExists?:'exists'|'not_found';roleConfirmed?:boolean;
 pattern?:TierPattern|null;
 /** The future measured-confidence gate can downgrade guesses without weakening hard-negative precedence. */
 supportedGuessAllowed?:boolean;
}
export type TierBasis='bad_syntax'|'opted_out'|'blocklisted'|'bounced_hard'|'checker_invalid'|'no_mail_server'
 |'evidence_mismatch'|'replied'|'sent_ok'|'role_review'|'checker_valid'|'company_site'|'places'
 |'saved_non_guessed'|'supported_pattern'|'pattern_paused'|'weak_evidence'|'ms_exists'|'ms_not_found'|'saved_unproven'|'role_confirmed';
export interface TierResult {tier:RecipientTier;basis:TierBasis;reason:string}
const clean=(address:string)=>address.trim().toLowerCase();
/** Pure and import-free. Classification grants no permission to send or enroll anyone. */
export function recipientTier(address:string,evidence:RecipientEvidence):TierResult {
 const result=(tier:RecipientTier,basis:TierBasis,reason:string):TierResult=>({tier,basis,reason});
 if(/[\r\n]/.test(address))return result('never','bad_syntax','This email address has invalid syntax.');
 if(clean(evidence.forAddress)!==clean(address))return result('T3','evidence_mismatch','Evidence belongs to another address. Review this address.');
 if(evidence.syntaxValid!==true)return result('never','bad_syntax','This email address has invalid syntax.');
 if(evidence.optedOut)return result('never','opted_out','This recipient has opted out.');
 if(evidence.blocklisted)return result('never','blocklisted','This recipient is blocked.');
 if(evidence.bouncedHard)return result('never','bounced_hard','This address hard-bounced before.');
 if(evidence.checker==='invalid')return result('never','checker_invalid','The checker says this address does not exist.');
 if(evidence.hasMailServer===false)return result('never','no_mail_server','This domain has no mail server.');
 if(evidence.replied)return result('T1','replied','This address has replied before.');
 if(evidence.sentOk)return result('T1','sent_ok','A previous send had no hard bounce within 72 hours.');
 // Kevin's 2026-11-12 ruling: only exact risky/role_account proof lifts a hosted role mailbox; history still comes first.
 if(evidence.roleNeedsReview&&evidence.roleConfirmed)return result('T1','role_confirmed','The mail server confirms this shared inbox.');
 if(evidence.roleNeedsReview)return result('T3','role_review','This role address needs review on hosted or catch-all mail.');
 if(evidence.msExists==='exists')return result('T1','ms_exists','Microsoft confirms this mailbox exists.');
 if(evidence.checker==='valid')return result('T1','checker_valid','The checker confirmed this address.');
 if(evidence.publishedByCompany)return result('T1','company_site','Published on the company’s own site.');
 if(evidence.placesEmail)return result('T1','places','Published in the company’s Places listing.');
 if(evidence.msExists==='not_found')return result('T3','ms_not_found','Microsoft could not confirm this mailbox. Review it.');
 // A checker-valid saved address already returned T1 above; saving alone is no proof.
 if(evidence.savedNonGuessed&&!evidence.generated)return result('T3','saved_unproven','Saved address that no check has confirmed. Review it.');
 const pattern=evidence.pattern;
 const domain=clean(address).split('@')[1];
 if(evidence.generated&&evidence.hasMailServer===true&&pattern?.candidateMatches===true&&clean(pattern.domain)===domain) {
  // One address cannot stand for two people; aliases for one person still count only once.
  const owners=new Map<string,Set<string>>();
  for(const sample of pattern.t1Support.slice(0,40)) {
   const email=clean(sample.address);const person=sample.personKey.trim().toLowerCase();
   if(!person||email===clean(address)||email.split('@')[1]!==domain)continue;
   const names=owners.get(email)??new Set<string>();names.add(person);owners.set(email,names);
  }
  const people=new Set([...owners.values()].flatMap(names=>names.size===1?[...names]:[]));
  if(people.size>=2) {
   if(evidence.supportedGuessAllowed===false)return result('T3','pattern_paused','Supported guesses are paused by the measured-confidence guard.');
   return result('T2','supported_pattern',`Matches the format of ${people.size} strong addresses for different people on this domain.`);
  }
 }
 return result('T3','weak_evidence','Not enough independent evidence. Review this address.');
}
