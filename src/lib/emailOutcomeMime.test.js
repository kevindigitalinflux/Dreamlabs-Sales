import {expect,it,vi} from 'vitest';
import {parseReplyMime} from '../../supabase/functions/_shared/replyImap';
import {hardBounceRecipients} from '../../supabase/functions/_shared/emailOutcomeRules';
import {learnBounceOutcomes} from '../../supabase/functions/_shared/emailOutcomeLearning';
import {replyDatabase} from './replyTestDatabase';
import {bounceMimeFixture} from './bounceMimeFixture';

export function bounceDatabase() {
 const db=replyDatabase({email_logs:[{id:'sent',sent_by:'sender',org_id:'org',lead_id:'lead',status:'sent',
  message_id:'<sent-id-1@example.com>',to_email:'person@example.com',sent_at:'2026-11-04T00:00:00Z'}],
 leads:[{id:'lead',org_id:'org',email:'person@example.com'}],decision_maker_candidates:[],org_members:[{user_id:'sender',org_id:'org'}]});
 db.service.rpc=vi.fn(async()=>({data:true,error:null}));return db;
}
it.each([false,true])('learns nested MIME bounce with structured status %s',async structured=>{
 const parsed=await parseReplyMime(bounceMimeFixture({structured,status:structured?'5.1.1':'5.2.1'}));
 expect(hardBounceRecipients(parsed)).toEqual(['person@example.com']);
 const db=bounceDatabase();
 expect(await learnBounceOutcomes(db.service,'sender',parsed,new Date('2026-11-05'))).toMatchObject({recipients:1,matched:1,unmatched:0});
 expect(db.service.rpc).toHaveBeenCalledWith('record_email_outcome',expect.objectContaining({p_address:'person@example.com',p_lead_id:'lead'}));
});
it.each([
 {failedHeader:true,returned:false,sentence:false},
 {failedHeader:false,returned:true,sentence:false},
 {failedHeader:false,returned:false,sentence:true},
 {deliveryStatus:'malformed status part'},
 {deliveryStatus:'Final-Recipient: rfc822; person@example.com'},
 {deliveryStatus:'Final-Recipient: malformed\r\nStatus: 5.2.1'},
])('learns each independent fallback source %j',async options=>{
 const parsed=await parseReplyMime(bounceMimeFixture(options));
 expect(hardBounceRecipients(parsed)).toEqual(['person@example.com']);
 const db=bounceDatabase();
 expect((await learnBounceOutcomes(db.service,'sender',parsed,new Date('2026-11-05'))).matched).toBe(1);
});
it('keeps returned header IDs and To, excluding original body and top-level To',async()=>{
 const parsed=await parseReplyMime(bounceMimeFixture({failedHeader:false,sentence:false}));
 expect(parsed.originalMessageIds).toEqual(['<sent-id-1@example.com>']);
 const db=bounceDatabase();delete parsed.inReplyTo;delete parsed.references;
 expect((await learnBounceOutcomes(db.service,'sender',parsed,new Date('2026-11-05'))).matched).toBe(1);
 expect(hardBounceRecipients({...parsed,returnedRecipientHeaders:[],headers:[...parsed.headers,{key:'To',value:'person@example.com'}]})).toEqual([]);
});
it('prefers failed header recipients over conflicting returned headers and sentence',async()=>{
 const parsed=await parseReplyMime(bounceMimeFixture());
 parsed.returnedRecipientHeaders=['other@example.com'];parsed.text="550 5.2.1 Your message wasn't delivered to another@example.com because it is inactive.";
 expect(hardBounceRecipients(parsed)).toEqual(['person@example.com']);
});
it('rejects a forged recipient even when its thread ID matches',async()=>{
 const parsed=await parseReplyMime(bounceMimeFixture({recipient:'never-sent@example.com'}));
 const db=bounceDatabase();
 expect(await learnBounceOutcomes(db.service,'sender',parsed,new Date('2026-11-05'))).toMatchObject({recipients:1,matched:0,unmatched:1});
 expect(db.service.rpc).not.toHaveBeenCalled();
});
it.each(['sent-id-1@example.com','<SENT-ID-1@EXAMPLE.COM>','  <sent-id-1@example.com>  ',null])('matches normalised or missing stored ID %s',async storedId=>{
 const parsed=await parseReplyMime(bounceMimeFixture());const db=bounceDatabase();db.tables.email_logs[0].message_id=storedId;
 expect((await learnBounceOutcomes(db.service,'sender',parsed,new Date('2026-11-05'))).matched).toBe(1);
});
it('does not use missing IDs to choose between different leads',async()=>{
 const parsed=await parseReplyMime(bounceMimeFixture());const db=bounceDatabase();db.tables.email_logs[0].message_id=null;
 db.tables.email_logs.push({...db.tables.email_logs[0],id:'other',lead_id:'other'});
 expect((await learnBounceOutcomes(db.service,'sender',parsed,new Date('2026-11-05'))).matched).toBe(0);
});
it('handles failed recipients independently and never borrows a hard status for a soft recipient',async()=>{
 const parsed=await parseReplyMime(bounceMimeFixture({recipient:'person@example.com, never-sent@example.com'}));const db=bounceDatabase();
 expect(await learnBounceOutcomes(db.service,'sender',parsed,new Date('2026-11-05'))).toMatchObject({recipients:2,matched:1,unmatched:1});
 expect(db.service.rpc).toHaveBeenCalledTimes(1);
 parsed.deliveryStatus=['Final-Recipient: rfc822; person@example.com\nStatus: 5.2.1\n\nFinal-Recipient: rfc822; never-sent@example.com\nStatus: 5.2.2'];
 expect(hardBounceRecipients(parsed)).toEqual(['person@example.com']);
});
