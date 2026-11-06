import type {ResolvedRunLeadRow} from '../components/autopilot/RunLeadGroups';
import type {EmailLog} from '../types';
/** A parked email can only be released by its own sender after the status lookup succeeds. */
export function parkedDraftEligible(row:ResolvedRunLeadRow,log:(EmailLog&{org_id?:string})|undefined,userId:string,orgId:string):boolean {
 return row.status==='needs_input'&&row.resolution==='open'&&!!log&&row.email_log_id===log.id&&row.lead_id===log.lead_id
  &&log.org_id===orgId&&log.sent_by===userId&&['draft','failed'].includes(log.status);
}
/** Single and selected actions share send/discard and the exact reviewed-send follow-up. */
export async function actOnParkedDraft(row:Pick<ResolvedRunLeadRow,'sequence_id'>,log:EmailLog,action:'release'|'discard',
 release:(log:EmailLog)=>Promise<{error:string|null}>,discard:(id:string)=>Promise<string|null>,
 finish:(sequenceId:string|null)=>Promise<{error:string|null;sent:boolean}>) {
 if(action==='discard')return discard(log.id);
 const result=await release(log);if(result.error)return result.error;
 const follow=await finish(row.sequence_id);
 return follow.error?`Email sent; ${follow.error}`:!follow.sent?'Could not confirm this send. Refresh before trying again.':null;
}
