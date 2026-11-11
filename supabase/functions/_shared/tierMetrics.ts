import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {readComplete} from './readComplete.ts';
export interface TierSend {org_id:string;status:string;sent_at:string|null;recipient_tier_at_send?:string|null;recipient_tier_version?:number|null;recipient_was_sent_ok?:boolean|null;hard_bounced_at?:string|null}
export const T2_PAUSED='Supported guesses are paused: T2 hard bounces exceed 8% across at least 30 T2 sends in the last 30 days. Strong addresses remain available.';
/** Actual immutable send-time tiers only. sent_ok is a T1 subset, not a fourth exclusive tier. */
export function tierMetrics(orgId:string,rows:TierSend[],now=Date.now()) {
 const groups={T1:{sends:0,bounces:0,rate:0},T2:{sends:0,bounces:0,rate:0},T3:{sends:0,bounces:0,rate:0},sent_ok:{sends:0,bounces:0,rate:0}};
 let unclassified=0;
 for(const row of rows){
  if(row.org_id!==orgId||row.status!=='sent'||Date.parse(row.sent_at??'')<now-30*86400000||!(Date.parse(row.sent_at??'')<=now))continue;
  const tier=row.recipient_tier_at_send;if(row.recipient_tier_version!==1||!tier||!['T1','T2','T3'].includes(tier)){unclassified++;continue;}
  const keys:(keyof typeof groups)[]=[tier as 'T1'|'T2'|'T3'];if(tier==='T1'&&row.recipient_was_sent_ok===true)keys.push('sent_ok');
  for(const key of keys){groups[key].sends++;if(row.hard_bounced_at)groups[key].bounces++;}
 }
 for(const group of Object.values(groups))group.rate=group.sends?group.bounces/group.sends:0;
 return {groups,unclassified,t2Allowed:!(groups.T2.sends>=30&&groups.T2.rate>0.08)};
}
export async function loadTierMetrics(service:SupabaseClient,orgId:string,now=Date.now()) {
 const rows=await readComplete(()=>service.from('email_logs').select('id,org_id,status,sent_at,recipient_tier_at_send,recipient_tier_version,recipient_was_sent_ok,hard_bounced_at',{count:'exact'})
  .eq('org_id',orgId).eq('status','sent').gte('sent_at',new Date(now-30*86400000).toISOString()));
 return tierMetrics(orgId,rows.data as TierSend[],now);
}
