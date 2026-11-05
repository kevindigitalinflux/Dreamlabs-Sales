import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('npm:@supabase/supabase-js@2',()=>({createClient:vi.fn()}));
vi.mock('../../supabase/functions/_shared/smtp',()=>({sendMail:vi.fn()}));
vi.mock('../../supabase/functions/_shared/replyImap',()=>({makeReplyInbox:vi.fn(()=>({})),parseReplyMime:vi.fn()}));
vi.mock('../../supabase/functions/_shared/emailOutcomeBackfill',()=>({backfillBounceOutcomes:vi.fn(async()=>({messages_read:2,bounces_found:1,matched:1,unmatched:0,complete:true}))}));
import {createClient} from 'npm:@supabase/supabase-js@2';
import {makeReplyInbox} from '../../supabase/functions/_shared/replyImap';
import {backfillBounceOutcomes} from '../../supabase/functions/_shared/emailOutcomeBackfill';
import {replyDatabase} from './replyTestDatabase';
let handler,db,signedIn;
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();signedIn=true;
 db=replyDatabase({user_email_settings:[{user_id:'caller',is_verified:true,imap_host:'imap.example.invalid',imap_port:993,smtp_user:'caller@example.invalid'},
 {user_id:'other',is_verified:true,imap_host:'other.example.invalid',imap_port:993,smtp_user:'other@example.invalid'}]});
 db.service.auth={getUser:async()=>({data:{user:signedIn?{id:'caller'}:null}})};
 createClient.mockReturnValue(db.service);
 vi.stubGlobal('Deno',{serve:fn=>{handler=fn;},env:{get:()=>undefined}});
});
afterEach(()=>vi.unstubAllGlobals());
const request=body=>new Request('http://localhost/email-settings',{method:'POST',headers:{Authorization:'Bearer local-placeholder'},body:JSON.stringify(body)});
it('uses only the authenticated caller mailbox regardless of supplied user or org',async()=>{
 await import('../../supabase/functions/email-settings/index');
 expect((await handler(request({action:'backfill_bounces',user_id:'other',org_id:'other',before_uid:500}))).status).toBe(200);
 expect(makeReplyInbox.mock.calls[0].slice(0,3)).toEqual(['imap.example.invalid',993,'caller@example.invalid']);
 expect(backfillBounceOutcomes.mock.calls[0][1]).toBe('caller');
 expect(backfillBounceOutcomes.mock.calls[0][6]).toBe(500);
});
it.each(['signed_out','not_connected','bad_cursor'])('rejects %s without reading messages',async mode=>{
 signedIn=mode!=='signed_out';if(mode==='not_connected')db.tables.user_email_settings=[];
 await import('../../supabase/functions/email-settings/index');
 const result=await handler(request({action:'backfill_bounces',...(mode==='bad_cursor'?{before_uid:-1}:{})}));
 expect(result.status).toBe(mode==='signed_out'?401:400);expect(backfillBounceOutcomes).not.toHaveBeenCalled();
});
