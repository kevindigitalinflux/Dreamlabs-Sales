import { expect, it, vi } from 'vitest';
import { learnBounceOutcomes } from '../../supabase/functions/_shared/emailOutcomeLearning';
import { replyDatabase } from './replyTestDatabase';

const bounce={messageId:'<dsn@fixture.invalid>',inReplyTo:'<sent@fixture.invalid>',headers:[],text:'Final-Recipient: rfc822; person@example.com\nStatus: 5.1.1'};
function fixture() {
 const db=replyDatabase({email_logs:[{id:'sent',sent_by:'sender',org_id:'org',lead_id:'lead',status:'sent',message_id:'<sent@fixture.invalid>',to_email:'Person@Example.com',sent_at:'2026-11-04T00:00:00Z'}],
 leads:[{id:'lead',org_id:'org',email:'person@example.com'}],decision_maker_candidates:[],org_members:[{user_id:'sender',org_id:'org'}],sequence_enrollments:[]});
 db.service.rpc=vi.fn(async()=>({data:true,error:null}));return db;
}
it('links a hard bounce to this mailbox and org and requests atomic suppression and a note',async()=>{
 const db=fixture();expect(await learnBounceOutcomes(db.service,'sender',bounce,new Date('2026-11-05'))).toMatchObject({recipients:1,matched:1,unmatched:0});
 expect(db.service.rpc).toHaveBeenCalledWith('record_email_outcome',expect.objectContaining({p_org_id:'org',p_lead_id:'lead',p_address:'person@example.com',p_outcome:'bounced_hard',p_pause_sequences:true}));
});
it.each(['other-mailbox','other-org','wrong-thread'])('rejects a %s match',async mode=>{
 const db=fixture();
 if(mode==='other-mailbox')db.tables.email_logs[0].sent_by='other';
 if(mode==='other-org')db.tables.leads[0].org_id='other';
 const message=mode==='wrong-thread'?{...bounce,inReplyTo:'<unrelated@fixture.invalid>'}:bounce;
 expect((await learnBounceOutcomes(db.service,'sender',message,new Date('2026-11-05'))).matched).toBe(0);
 expect(db.service.rpc).not.toHaveBeenCalled();
});
it('does not pause a sequence whose current recipients exclude the bounced address',async()=>{
 const db=fixture();db.tables.leads[0].email='other@example.com';
 await learnBounceOutcomes(db.service,'sender',bounce,new Date('2026-11-05'));
 expect(db.service.rpc.mock.calls[0][1].p_pause_sequences).toBe(false);
});
it('propagates a durable-write failure so mailbox polling can retry this UID',async()=>{
 const db=fixture();db.service.rpc.mockResolvedValue({error:{message:'private'}});
 await expect(learnBounceOutcomes(db.service,'sender',bounce,new Date('2026-11-05'))).rejects.toThrow('Could not save email outcome');
});
