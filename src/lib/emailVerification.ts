import {readableInvokeError} from './invokeError';
import {emailDomainTypo,emailSyntaxValid,isRoleAddress,ROLE_ADDRESS_LABEL} from '../../supabase/functions/_shared/emailPrecheckRules';
export interface VerificationView {status:'valid'|'invalid'|'unverifiable';label:string;hardBounce?:boolean;overridden?:boolean;overridable?:boolean}
export interface EmailSendView {ok:boolean;blocked:boolean;error?:string;verification?:VerificationView}
/** Display only evidence belonging to this exact organisation and address. */
export function emailEvidenceView(orgId:string,address:string,rows:{org_id:string;address:string;outcome:string;seen_at:string}[],now=Date.now()):VerificationView {
  if(!emailSyntaxValid(address))return {status:'invalid',label:'This email address has invalid syntax',overridable:false};
  const own=rows.filter(r=>r.org_id===orgId&&r.address.toLowerCase()===address.trim().toLowerCase());
  if(own.some(r=>r.outcome==='bounced_hard'))return {status:'invalid',label:'This address bounced before.',hardBounce:true};
  if(own.some(r=>r.outcome==='replied'))return {status:'valid',label:'This address has replied before.'};
  const recent=own.filter(r=>Date.parse(r.seen_at)>=now-14*86400000&&Date.parse(r.seen_at)<=now).sort((a,b)=>Date.parse(b.seen_at)-Date.parse(a.seen_at))[0];
  const result:VerificationView=recent?.outcome==='checked_invalid'?{status:'invalid',label:'Our checker says this address does not exist'}
    :recent?.outcome==='checked_valid'?{status:'valid',label:'Confirmed'}:{status:'unverifiable',label:isRoleAddress(address)?ROLE_ADDRESS_LABEL:'Not confirmed'};
  const typo=emailDomainTypo(address);return typo?{...result,label:`${result.label}. Possible domain typo: did you mean ${typo}? Address was not changed.`}:result;
}
/** Read non-2xx verification details without consuming the error Response used elsewhere. */
export async function readEmailSendResponse(data:unknown,error:unknown):Promise<EmailSendView> {
  let payload=data as {ok?:boolean;error?:string;verification?:VerificationView}|null;
  const context=(error as {context?:unknown}|null)?.context;
  if(context instanceof Response){try{payload=await context.clone().json();}catch{console.error('email release: response details unavailable');}}
  const candidate=payload?.verification;
  const verification=candidate&&['valid','invalid','unverifiable'].includes(candidate.status)&&typeof candidate.label==='string'?candidate:undefined;
  const ok=payload?.ok===true&&!error;
  return {ok,blocked:!ok&&verification?.status==='invalid',verification,error:payload?.error??(error?await readableInvokeError(error):undefined)};
}
/** Counts unconfirmed sends separately from blocked rows and actual send failures. */
export function emailReleaseSummary(results:EmailSendView[]):string {
  const sent=results.filter(r=>r.ok).length;const blocked=results.filter(r=>r.blocked).length;
  const unconfirmed=results.filter(r=>r.ok&&r.verification?.status!=='valid').length;
  const disclosures=[...new Set(results.flatMap(r=>r.ok&&r.verification?.label.startsWith('Not checked:')?[r.verification.label]:[]))];
  return `Sent ${sent}; blocked ${blocked}; not confirmed ${unconfirmed}; failed ${results.length-sent-blocked}${disclosures.length?`; ${disclosures.join('; ')}`:''}`;
}
