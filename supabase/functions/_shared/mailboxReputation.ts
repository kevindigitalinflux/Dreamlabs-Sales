import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {readComplete} from './readComplete.ts';
interface MailSend {sent_by:string;status:string;sent_at:string|null;hard_bounced_at?:string|null}
export function mailboxReputation(logs:MailSend[],sender:string,now=Date.now()) {
 const sends=logs.filter(row=>row.sent_by===sender&&row.status==='sent'&&Date.parse(row.sent_at??'')>=now-7*86400000&&Date.parse(row.sent_at??'')<=now);
 const bounces=sends.filter(row=>!!row.hard_bounced_at).length;
 return {sends:sends.length,bounces,rate:sends.length?bounces/sends.length:0,paused:sends.length>=20&&bounces/sends.length>=0.05};
}
export const REPUTATION_PAUSED='Bulk sending paused: this mailbox has at least 5% hard bounces across 20 or more sends in the last 7 days. Review addresses before knowingly resuming.';
export async function loadMailboxReputation(service:SupabaseClient,orgId:string,sender:string,now=Date.now()) {
 const rows=await readComplete(()=>service.from('email_logs').select('id,sent_by,status,sent_at,hard_bounced_at',{count:'exact'})
  .eq('org_id',orgId).eq('sent_by',sender).eq('status','sent').gte('sent_at',new Date(now-7*86400000).toISOString()));
 return mailboxReputation(rows.data as MailSend[],sender,now);
}
