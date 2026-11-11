import type {TierResult} from './recipientTier.ts';
interface SentLog {org_id:string;to_email:string;status:string;sent_at:string|null;hard_bounced_at?:string|null}
interface Outcome {org_id:string;address:string;outcome:string}
/** Read-time evidence only. A late hard bounce revokes earlier delivered evidence. */
export function sentOkAddresses(orgId:string,logs:SentLog[],outcomes:Outcome[],now=Date.now()):string[] {
 const bounced=new Set(outcomes.filter(row=>row.org_id===orgId&&row.outcome==='bounced_hard').map(row=>row.address.trim().toLowerCase()));
 return [...new Set(logs.filter(row=>row.org_id===orgId&&row.status==='sent'&&!row.hard_bounced_at&&Number.isFinite(Date.parse(row.sent_at??''))&&Date.parse(row.sent_at!)<=now-72*3600000)
  .map(row=>row.to_email.trim().toLowerCase()).filter(address=>!bounced.has(address)))];
}
/** Spread into the same successful log mutation as status and sent_at, never into a later update. */
export function tierSnapshot(result:TierResult,sentOk:boolean,sentAt:string) {
 return {recipient_tier_at_send:result.tier==='never'?'T3':result.tier,recipient_tier_basis:result.basis,
  recipient_tier_version:1,recipient_was_sent_ok:result.tier==='T1'&&sentOk,recipient_tier_recorded_at:sentAt};
}
