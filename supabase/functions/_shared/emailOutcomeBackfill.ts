import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ParsedReply, ReplyInbox } from './replyPolling.ts';
import { automaticMail } from './replyRules.ts';
import { learnBounceOutcomes } from './emailOutcomeLearning.ts';

/** One explicit, capped INBOX backfill; no alerts, drafts, messages, or normal polling watermark writes. */
export async function backfillBounceOutcomes(service:SupabaseClient,userId:string,inbox:ReplyInbox,
  parse:(source:Uint8Array)=>Promise<ParsedReply>,deadline:number,now=new Date(),beforeUid?:number) {
  const out={messages_read:0,bounces_found:0,recipients_extracted:0,matched:0,unmatched:0,capped:false,complete:false,next_before_uid:null as number|null};
  const since=new Date(now.getTime()-30*86400000);
  let lock:{release():void}|undefined;
  const timer=setTimeout(()=>inbox.abort?.(),Math.max(1,deadline-Date.now()-1000));
  try {
    await inbox.connect();lock=await inbox.lock();
    if(!inbox.searchSince)throw new Error('Backfill search unavailable');
    const uids=[...new Set(await inbox.searchSince(since,beforeUid))].filter(uid=>Number.isSafeInteger(uid)&&uid>0&&(!beforeUid||uid<beforeUid)).sort((a,b)=>b-a);
    const admitted=uids.slice(0,200);out.capped=uids.length>admitted.length;
    // Fetch one UID at a time so a time-limited action never buffers all 200 message bodies.
    for(const uid of admitted) {
      if(Date.now()>=deadline-5000){out.capped=true;break;}
      for await(const message of inbox.fetch(String(uid))) {
        if(message.uid!==uid)continue;
        const received=message.internalDate?new Date(message.internalDate):null;
        if(!message.source||!received||!Number.isFinite(received.getTime()))throw new Error('Backfill source or receipt time unavailable');
        out.messages_read++;
        if(received<since||received>now){out.next_before_uid=uid;break;}
        const mail=await parse(message.source);
        if(automaticMail(mail.headers.map(h=>[h.key,h.value]),mail.subject??'',mail.from?.address??'')==='bounce') {
          out.bounces_found++;
          const learned=await learnBounceOutcomes(service,userId,{...mail,sourceId:inbox.uidValidity?`imap:${userId}:${inbox.uidValidity}:${uid}`:undefined},received);
          out.recipients_extracted+=learned.recipients;out.matched+=learned.matched;out.unmatched+=learned.unmatched;
        }
        out.next_before_uid=uid;
        break;
      }
    }
    out.complete=!out.capped;
    if(out.complete)out.next_before_uid=null;
    return out;
  } catch {
    console.error('bounce backfill: message scan failed');
    throw new Error('Bounce backfill could not finish');
  } finally {
    lock?.release();
    try{await inbox.logout();}catch{console.error('bounce backfill: mailbox close failed');}
    clearTimeout(timer);
  }
}
