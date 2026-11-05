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
