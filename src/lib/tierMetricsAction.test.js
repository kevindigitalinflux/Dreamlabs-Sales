import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('npm:@supabase/supabase-js@2',()=>({createClient:vi.fn()}));
vi.mock('../../supabase/functions/_shared/smtp',()=>({sendMail:vi.fn()}));
import {createClient} from 'npm:@supabase/supabase-js@2';
import {replyDatabase} from './replyTestDatabase';
let handler,db,signedIn;
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();signedIn=true;
 vi.stubGlobal('Deno',{env:{get:()=> 'local-placeholder'},serve:fn=>{handler=fn;}});
 db=replyDatabase({org_members:[{org_id:'org',user_id:'user'}]});
 createClient.mockImplementation((_url,_key,options)=>options?{auth:{getUser:async()=>({data:{user:signedIn?{id:'user'}:null}})}}:db.service);
});
afterEach(()=>vi.unstubAllGlobals());
async function request(org='org'){await import('../../supabase/functions/email-settings/index');return handler(new Request('http://localhost/function',{method:'POST',headers:{Authorization:'Bearer local-placeholder','Content-Type':'application/json'},body:JSON.stringify({action:'tier_metrics',org_id:org})}));}
it('requires authentication and exact org membership before reading metrics',async()=>{
 signedIn=false;expect((await request()).status).toBe(401);signedIn=true;
 expect((await request('other')).status).toBe(404);expect(db.queries.some(query=>query.table==='email_logs')).toBe(false);
});
it('returns aggregate counts without addresses and fails closed on evidence errors',async()=>{
 const response=await request();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({unclassified:0,t2Allowed:true});
 db.failures.add('email_logs:select');expect((await request()).status).toBe(503);
});
