import type {SupabaseClient} from '@supabase/supabase-js';
import type {DraftLog} from '../hooks/useDrafts';
import {readEmailSendResponse} from './emailVerification';
/** A changed recipient, message or attachment list needs another human review. */
export function reviewedDraftMatches(before:DraftLog,after:DraftLog):boolean {
 return before.to_email===after.to_email&&before.subject===after.subject&&before.body===after.body
  &&before.decision_maker_candidate_id===after.decision_maker_candidate_id&&JSON.stringify(before.attachments??[])===JSON.stringify(after.attachments??[]);
}
/** Shared single-row rejection. A sent or concurrently removed draft must not count as discarded. */
export async function discardReviewDraft(client:Pick<SupabaseClient,'from'>,id:string):Promise<string|null> {
 const {data,error}=await client.from('email_logs').delete().eq('id',id).in('status',['draft','failed']).select('id').maybeSingle();
 return error?'Could not discard this draft. Try again.':!data?'This draft changed or was removed. Refresh before trying again.':null;
}
/** Existing release payload and server send boundary, one reviewed draft at a time. */
export async function releaseReviewDraft(client:Pick<SupabaseClient,'functions'>,draft:DraftLog,reputationAcknowledged=false) {
 const {data,error}=await client.functions.invoke('send-email',{body:{to_email:draft.to_email,subject:draft.subject,body:draft.body,
  lead_id:draft.lead?.id,log_id:draft.id,decision_maker_candidate_id:draft.decision_maker_candidate_id,bulk_release:true,reputation_acknowledged:reputationAcknowledged}});
 const view=await readEmailSendResponse(data,error);
 return {data,view,error:view.ok?null:view.error??'Send failed. Review this draft and try again.'};
}
