import {readableInvokeError} from './invokeError';
export interface VerificationView {status:'valid'|'invalid'|'unverifiable';label:string;hardBounce?:boolean;overridden?:boolean;overridable?:boolean}
export interface EmailSendView {ok:boolean;blocked:boolean;error?:string;verification?:VerificationView}
/** Display only evidence belonging to this exact organisation and address. */
export function emailEvidenceView(orgId:string,address:string,rows:{org_id:string;address:string;outcome:string;seen_at:string}[],now=Date.now()):VerificationView {
  const own=rows.filter(r=>r.org_id===orgId&&r.address.toLowerCase()===address.trim().toLowerCase());
  if(own.some(r=>r.outcome==='bounced_hard'))return {status:'invalid',label:'This address bounced before.',hardBounce:true};
  if(own.some(r=>r.outcome==='replied'))return {status:'valid',label:'This address has replied before.'};
  const recent=own.filter(r=>Date.parse(r.seen_at)>=now-14*86400000&&Date.parse(r.seen_at)<=now).sort((a,b)=>Date.parse(b.seen_at)-Date.parse(a.seen_at))[0];
  return recent?.outcome==='checked_invalid'?{status:'invalid',label:'Our checker says this address does not exist'}
    :recent?.outcome==='checked_valid'?{status:'valid',label:'Confirmed'}:{status:'unverifiable',label:'Not confirmed'};
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
  return `Sent ${sent}; blocked ${blocked}; not confirmed ${unconfirmed}; failed ${results.length-sent-blocked}`;
}
