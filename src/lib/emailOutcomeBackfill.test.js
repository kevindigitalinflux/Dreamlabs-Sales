import { expect, it, vi } from 'vitest';
import { backfillBounceOutcomes } from '../../supabase/functions/_shared/emailOutcomeBackfill';
import { replyDatabase } from './replyTestDatabase';

function fixture(count=2) {
 const db=replyDatabase({email_logs:[{id:'sent',sent_by:'sender',org_id:'org',lead_id:'lead',status:'sent',message_id:'<sent@example.com>',to_email:'missing@example.com',sent_at:'2026-11-03T00:00:00Z'}],
 leads:[{id:'lead',org_id:'org',email:'missing@example.com'}],org_members:[{user_id:'sender',org_id:'org'}],decision_maker_candidates:[]});
 const recorded=new Set();db.service.rpc=vi.fn(async(_name,args)=>{recorded.add(`${args.p_org_id}:${args.p_address}:${args.p_outcome}`);return {error:null};});
 const release=vi.fn();const inbox={uidValidity:'42',highestUid:count,connect:vi.fn(),lock:async()=>({release}),logout:vi.fn(),
 searchSince:vi.fn(async()=>Array.from({length:count},(_,i)=>i+1)),fetch:vi.fn(async function*(range){for(const uid of range.split(',').map(Number))yield {uid,source:new Uint8Array([uid]),internalDate:new Date('2026-11-04')};})};
 const parse=vi.fn(async()=>({inReplyTo:'<sent@example.com>',from:{address:'mailer-daemon@example.com'},headers:[],attachments:[],text:'Final-Recipient: rfc822; missing@example.com\nStatus: 5.1.1'}));
 return {db,inbox,parse,recorded,release};
}
it('backfills outcomes twice without duplicate evidence, reply alerts, notes or watermark changes',async()=>{
 const f=fixture();const now=new Date('2026-11-05');
 for(let i=0;i<2;i++)expect(await backfillBounceOutcomes(f.db.service,'sender',f.inbox,f.parse,Date.now()+60000,now)).toMatchObject({messages_read:2,bounces_found:2,recipients_extracted:2,matched:2,unmatched:0,complete:true});
 expect(f.recorded.size).toBe(1);expect(f.db.writes).toEqual([]);expect(f.release).toHaveBeenCalledTimes(2);
 expect(f.db.service.rpc.mock.calls[0][1]).toMatchObject({p_source_message_id:'imap:sender:42:2',p_seen_at:'2026-11-04T00:00:00.000Z'});
});
it('caps reads at 200 messages and returns a cursor for older messages',async()=>{
 const f=fixture(205);const out=await backfillBounceOutcomes(f.db.service,'sender',f.inbox,f.parse,Date.now()+60000,new Date('2026-11-05'));
 expect(out).toMatchObject({messages_read:200,capped:true,complete:false,next_before_uid:6});
 expect(f.parse).toHaveBeenCalledTimes(200);
});
it('does not learn old, automatic, soft, or unparseable mail and closes on failure',async()=>{
 const f=fixture();f.parse.mockResolvedValue({from:{address:'human@example.com'},headers:[{key:'auto-submitted',value:'auto-replied'}],attachments:[],text:'away'});
 expect((await backfillBounceOutcomes(f.db.service,'sender',f.inbox,f.parse,Date.now()+60000,new Date('2026-11-05'))).bounces_found).toBe(0);
 f.parse.mockRejectedValue(new Error('private body'));
 await expect(backfillBounceOutcomes(f.db.service,'sender',f.inbox,f.parse,Date.now()+60000,new Date('2026-11-05'))).rejects.toThrow('Bounce backfill could not finish');
 expect(f.inbox.logout).toHaveBeenCalledTimes(2);
});
it('reports bounded count-only reasons and distinct status codes per DSN',async()=>{
 const f=fixture(7);const header=address=>[{key:'X-Failed-Recipients',value:address}];
 const mail=(text,headers=header('missing@example.com'),inReplyTo='<sent@example.com>')=>({from:{address:'mailer-daemon@example.com'},headers,attachments:[],text,inReplyTo});
 const messages=[
  mail('550 5.2.1 inactive; repeated 5.2.1'),
  mail('550 5.1.1 user unknown',header('never-sent@example.com')),
  mail('552 5.2.2 mailbox full'),
  mail('Delivery failed without a status'),
  mail('550 5.1.3 invalid address',[]),
  mail('550 5.1.6 mailbox gone',header('missing@example.com'),'<unknown@example.com>'),
  mail('550 5.1.2 bad domain'),
 ];
 f.parse.mockImplementation(async source=>messages[source[0]-1]);
 const out=await backfillBounceOutcomes(f.db.service,'sender',f.inbox,f.parse,Date.now()+60000,new Date('2026-11-05'));
 expect(out).toMatchObject({messages_read:7,bounces_found:7,recipients_extracted:4,matched:2,unmatched:2,
  by_reason:{hard:5,soft_status:1,no_recipient_found:1,no_status_found:1,recipient_not_in_sent_log:1,message_id_not_found:1},
  status_codes:{'5.2.1':1,'5.1.1':1,'5.2.2':1,'5.1.3':1,'5.1.6':1,'5.1.2':1}});
 expect(JSON.stringify(out)).not.toContain('@');expect(JSON.stringify(out)).not.toContain('inactive');
});
it('counts missing stored IDs even when safe unthreaded matching succeeds',async()=>{
 const f=fixture(1);f.db.tables.email_logs[0].message_id=null;
 const out=await backfillBounceOutcomes(f.db.service,'sender',f.inbox,f.parse,Date.now()+60000,new Date('2026-11-05'));
 expect(out).toMatchObject({matched:1,by_reason:{hard:1,message_id_not_found:1}});
});
