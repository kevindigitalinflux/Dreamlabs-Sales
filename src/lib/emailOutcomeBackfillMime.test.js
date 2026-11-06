import {expect,it,vi} from 'vitest';
import {backfillBounceOutcomes} from '../../supabase/functions/_shared/emailOutcomeBackfill';
import {parseReplyMime} from '../../supabase/functions/_shared/replyImap';
import {replyDatabase} from './replyTestDatabase';
import {bounceMimeFixture} from './bounceMimeFixture';

it('runs a bounded 18-DSN MIME backfill locally twice, with thirteen hard outcomes and count-only misses',async()=>{
 const sources=Array.from({length:13},(_,i)=>bounceMimeFixture({recipient:`person${i}@example.com`,status:i<9?'5.2.1':i<12?'5.1.1':'5.1.2',
  failedHeader:i%3===0,returned:i%3===1,sentence:i%3===2}));
 sources.push(bounceMimeFixture({status:'5.2.2'}),bounceMimeFixture({failedHeader:false,returned:false,sentence:false}),
  bounceMimeFixture({recipient:'never-sent@example.com'}),
  new TextEncoder().encode(new TextDecoder().decode(bounceMimeFixture({recipient:'person0@example.com'})).replaceAll('sent-id-1@example.com','unknown@example.com')),
  bounceMimeFixture({status:null}));
 const sent=Array.from({length:13},(_,i)=>({id:`sent${i}`,sent_by:'sender',org_id:'org',lead_id:`lead${i}`,status:'sent',
  message_id:'<sent-id-1@example.com>',to_email:`person${i}@example.com`,sent_at:'2026-11-04T00:00:00Z'}));
 const db=replyDatabase({email_logs:sent,leads:sent.map(row=>({id:row.lead_id,org_id:'org',email:row.to_email})),
  decision_maker_candidates:[],org_members:[{user_id:'sender',org_id:'org'}]});
 const evidence=new Set();db.service.rpc=vi.fn(async(_name,args)=>{
  evidence.add(`${args.p_org_id}:${args.p_address}:${args.p_outcome}`);return {error:null};
 });
 const inbox={uidValidity:'fixture-only',connect:vi.fn(),lock:async()=>({release:vi.fn()}),logout:vi.fn(),
  searchSince:async()=>sources.map((_,i)=>i+1),fetch:async function*(uid){yield {uid:Number(uid),source:sources[Number(uid)-1],internalDate:new Date('2026-11-05')};}};
 for(let pass=0;pass<2;pass++) {
  const out=await backfillBounceOutcomes(db.service,'sender',inbox,parseReplyMime,Date.now()+60000,new Date('2026-11-06'));
  expect(out).toEqual({messages_read:18,bounces_found:18,recipients_extracted:15,matched:13,unmatched:2,capped:false,complete:true,next_before_uid:null,
   by_reason:{hard:16,soft_status:1,no_recipient_found:1,no_status_found:1,recipient_not_in_sent_log:1,message_id_not_found:1},
   status_codes:{'5.2.1':12,'5.1.1':3,'5.1.2':1,'5.2.2':1}});
  expect(JSON.stringify(out)).not.toContain('@');
 }
 expect(evidence.size).toBe(13);expect(db.writes).toEqual([]);expect(db.service.rpc).toHaveBeenCalledTimes(26);
});
