export interface FallbackPlan {guessed:boolean;attempts:number;ranked:string[];bounced:string[];current:string}
/** The durable save must atomically recheck the lifetime limit and insert a normal review draft. */
export function nextFallback(input:FallbackPlan):string|null {
 if(!input.guessed||!Number.isInteger(input.attempts)||input.attempts<0||input.attempts>=2)return null;
 const current=input.current.trim().toLowerCase();const start=input.ranked.findIndex(address=>address.toLowerCase()===current);
 if(start<0)return null;
 const rejected=new Set(input.bounced.map(address=>address.trim().toLowerCase()));
 return input.ranked.slice(start+1).find(address=>!rejected.has(address.trim().toLowerCase()))??null;
}
/** No send, enrollment or local counter. A failed/missing durable reservation leaves no queued draft. */
export async function queueFallback(input:FallbackPlan,reputationAllowed:boolean,save:(address:string)=>Promise<boolean>):Promise<boolean> {
 if(!reputationAllowed)return false;const address=nextFallback(input);
 return address?await save(address):false;
}
