import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { analyseBounceMessage } from './emailOutcomeRules.ts';
import { messageIds } from './replyRules.ts';
import { planStepDrafts } from './sequenceRecipients.ts';
import type { Contact } from './contacts.ts';
import type { ParsedReply } from './replyPolling.ts';

/** Durable outcome, suppression and note effects share one service-only transaction (SQL proposed in the report). */
export async function recordEmailOutcome(service: SupabaseClient, input: {
  orgId:string; leadId:string; address:string; outcome:'bounced_hard'|'replied'|'checked_invalid'|'checked_valid'|'checked_unverifiable'; source:string; seenAt:Date; pauseSequences?:boolean;
}): Promise<void> {
  const {error}=await service.rpc('record_email_outcome',{
    p_org_id:input.orgId,p_lead_id:input.leadId,p_address:input.address.trim().toLowerCase(),p_outcome:input.outcome,
    p_source_message_id:input.source.slice(0,250),p_seen_at:input.seenAt.toISOString(),p_pause_sequences:input.pauseSequences??false,
  });
  if(error)throw new Error('Could not save email outcome');
}

/** Match DSNs only to genuine sent mail in this mailbox, then verify the lead's organisation before learning. */
export async function learnBounceOutcomes(service:SupabaseClient,userId:string,mail:ParsedReply,seenAt:Date) {
  const analysis=analyseBounceMessage(mail);
  const recipients=analysis.recipients;
  const result={recipients:recipients.length,matched:0,unmatched:recipients.length,
    by_reason:{hard:Number(analysis.hard),soft_status:Number(!analysis.hard&&analysis.hasStatus),
      no_recipient_found:Number(!analysis.hasRecipient),no_status_found:Number(!analysis.hasStatus),
      recipient_not_in_sent_log:0,message_id_not_found:0},
    status_codes:Object.fromEntries(analysis.statusCodes.map(code=>[code,1])) as Record<string,number>};
  const source=messageIds(mail.messageId??'')[0]??mail.sourceId;
  if(!recipients.length||!source)return result;
  const normaliseId=(value:unknown)=>typeof value==='string'?value.trim().replace(/^<|>$/g,'').toLowerCase():'';
  const ids=[...new Set([...(mail.originalMessageIds??[]),...messageIds(mail.inReplyTo??''),...messageIds(mail.references??'')].map(normaliseId))];
  // Bounded lookback prevents a spoofed DSN from targeting arbitrary historical addresses.
  const {data:sent,error}=await service.from('email_logs').select('id,org_id,lead_id,to_email,message_id,sent_at,hard_bounced_at')
    .eq('sent_by',userId).eq('status','sent').gte('sent_at',new Date(seenAt.getTime()-30*86400000).toISOString())
    .order('sent_at',{ascending:false}).limit(1000);
  if(error)throw new Error('Could not match bounce recipients');
  let links=0;
  for(const address of recipients) {
    if(links>=20)break;
    const addressed=(sent??[]).filter(row=>String(row.to_email).trim().toLowerCase()===address);
    const threaded=addressed.filter(row=>ids.includes(normaliseId(row.message_id)));
    if(!addressed.length)result.by_reason.recipient_not_in_sent_log++;
    else if(ids.length&&!threaded.length)result.by_reason.message_id_not_found++;
    // Missing stored IDs may use the same conservative unthreaded rule; known conflicting IDs never do.
    const unthreaded=!ids.length||(!threaded.length&&addressed.length>0&&addressed.every(row=>!normaliseId(row.message_id)));
    const matches=[...new Map((unthreaded?addressed:threaded)
      .map(row=>[`${row.org_id}:${row.lead_id}`,row])).values()];
    if(unthreaded&&matches.length!==1)continue; // An unthreaded DSN must not choose between leads or organisations.
    let matched=false;
    for(const row of matches) {
      if(links>=20)break;
      if(!row.lead_id||!row.org_id)continue;
      const [{data:lead,error:leadError},{data:contacts,error:contactError},{data:membership,error:memberError}]=await Promise.all([
        service.from('leads').select('id,org_id,email,opted_out').eq('id',row.lead_id).eq('org_id',row.org_id).maybeSingle(),
        service.from('decision_maker_candidates').select('*').eq('lead_id',row.lead_id).is('dismissed_at',null),
        service.from('org_members').select('org_id').eq('org_id',row.org_id).eq('user_id',userId).maybeSingle(),
      ]);
      if(leadError||contactError||memberError)throw new Error('Could not check bounce ownership');
      if(!lead||!membership)continue;
      const plan=planStepDrafts({contacts:(contacts??[]) as Contact[],leadEmail:lead.email,optedOut:lead.opted_out===true,capRemaining:null});
      await recordEmailOutcome(service,{orgId:row.org_id,leadId:row.lead_id,address,outcome:'bounced_hard',source,seenAt,
        pauseSequences:plan.recipients.some(r=>r.email.trim().toLowerCase()===address)});
      // Suppression may be address-wide; attribution must identify exactly one real send.
      const exact=(unthreaded?addressed:threaded).filter(candidate=>candidate.org_id===row.org_id&&candidate.lead_id===row.lead_id);
      if(exact.length===1&&!exact[0].hard_bounced_at&&Date.parse(exact[0].sent_at)<=seenAt.getTime()){
        const stamped=await service.from('email_logs').update({hard_bounced_at:seenAt.toISOString()})
          .eq('id',exact[0].id).eq('org_id',row.org_id).eq('sent_by',userId).eq('status','sent').is('hard_bounced_at',null);
        if(stamped.error)throw Error('Could not stamp the matched hard bounce');
      }
      links++;
      matched=true;
    }
    if(matched){result.matched++;result.unmatched--;}
  }
  return result;
}
