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
