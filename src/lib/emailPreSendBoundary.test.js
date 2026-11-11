import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../../supabase/functions/_shared/smtp',()=>({sendMail:vi.fn(async()=>({messageId:'<sent@example.com>'}))}));
vi.mock('../../supabase/functions/_shared/emailPreSend',()=>({checkEmailBeforeSend:vi.fn(async()=>({status:'valid',label:'Confirmed'}))}));
import {checkEmailBeforeSend} from '../../supabase/functions/_shared/emailPreSend';
import {sendLeadEmail} from '../../supabase/functions/_shared/sendLeadEmail';
import {sendMail} from '../../supabase/functions/_shared/smtp';
import {replyDatabase} from './replyTestDatabase';
const input={senderId:'sender',leadId:'lead',orgId:'org',leadStage:'new_lead',mailbox:{settings:{},pass:'local-placeholder'},to:'person@example.com',subject:'Hello',body:'Reviewed copy'};
beforeEach(()=>vi.clearAllMocks());
it('blocks invalid addresses at the common SMTP boundary with a plain reason',async()=>{
 checkEmailBeforeSend.mockResolvedValueOnce({status:'invalid',label:'Our checker says this address does not exist'});
 expect(await sendLeadEmail(replyDatabase().service,input)).toMatchObject({ok:false,status:409,error:'Our checker says this address does not exist'});
 expect(sendMail).not.toHaveBeenCalled();
});
it.each(['valid','unverifiable'])('allows %s with explicit verification metadata',async status=>{
 checkEmailBeforeSend.mockResolvedValueOnce({status,label:status==='valid'?'Confirmed':'Not confirmed'});
 expect(await sendLeadEmail(replyDatabase().service,input)).toMatchObject({ok:true,verification:{status}});
 expect(sendMail).toHaveBeenCalledTimes(1);
});
it('writes 074 snapshot in the same successful draft update',async()=>{
 const db=replyDatabase({email_logs:[{id:'draft',org_id:'org',sent_by:'sender',status:'draft'}]});
 // The fixture's filter supports the sender ownership disjunction used by the common sender.
 const from=db.service.from;db.service.from=table=>{const q=from(table);q.or=()=>q;return q;};
 checkEmailBeforeSend.mockResolvedValueOnce({status:'valid',label:'Confirmed',tier:{tier:'T1',basis:'checker_valid',reason:'Confirmed'}});
 await sendLeadEmail(db.service,{...input,logId:'draft',draft:{org_id:'org',attachments:[]}});
 const updates=db.writes.filter(row=>row.table==='email_logs');
 expect(updates).toHaveLength(1);
 expect(updates[0].patch).toMatchObject({status:'sent',recipient_tier_at_send:'T1',recipient_tier_basis:'checker_valid',recipient_tier_version:1});
 expect(updates[0].patch.recipient_tier_recorded_at).toBe(updates[0].patch.sent_at);
});
it('requires an explicit row override and never overrides a learned hard bounce',async()=>{
 checkEmailBeforeSend.mockResolvedValueOnce({status:'invalid',label:'Our checker says this address does not exist'});
 expect(await sendLeadEmail(replyDatabase().service,{...input,overrideInvalid:true})).toMatchObject({ok:true,verification:{overridden:true}});
 checkEmailBeforeSend.mockResolvedValueOnce({status:'invalid',label:'This address bounced before.',hardBounce:true});
 expect(await sendLeadEmail(replyDatabase().service,{...input,overrideInvalid:true})).toMatchObject({ok:false,status:409});
 expect(sendMail).toHaveBeenCalledTimes(1);
});
