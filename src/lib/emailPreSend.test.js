import {expect,it,vi} from 'vitest';
import {makeEmailPrechecker} from '../../supabase/functions/_shared/emailPreSend';
import {replyDatabase} from './replyTestDatabase';
const now=()=>Date.parse('2026-11-05T12:00:00Z');
const input={leadId:'lead',address:'person@example.com'};
function fixture(outcomes=[]) {
 const db=replyDatabase({email_outcomes:outcomes});db.service.rpc=vi.fn(async()=>({error:null}));
 const worker={verifyEmail:vi.fn(async()=>({ok:true,value:{status:'valid',reason:'deliverable'}})),scrapeSite:vi.fn(),lines:()=>[]};
 return {db,worker,check:makeEmailPrechecker(db.service,'org',{worker,now})};
}
it.each(['valid','invalid','unverifiable'])('checks and caches %s per org/address without sending',async status=>{
 const f=fixture();f.worker.verifyEmail.mockResolvedValue({ok:true,value:{status,reason:status==='unverifiable'?'unknown':'clear'}});
 expect(await f.check(input)).toMatchObject({status});expect(await f.check(input)).toMatchObject({status});
 expect(f.worker.verifyEmail).toHaveBeenCalledTimes(1);
 expect(f.db.service.rpc).toHaveBeenCalledWith('record_email_outcome',expect.objectContaining({p_org_id:'org',p_address:input.address,p_outcome:`checked_${status}`}));
});
it('reuses a recent stored result but never cross-org or older than fourteen days',async()=>{
 const f=fixture([{org_id:'org',address:input.address,outcome:'checked_invalid',seen_at:'2026-11-04'}]);
 expect(await f.check(input)).toMatchObject({status:'invalid'});expect(f.worker.verifyEmail).not.toHaveBeenCalled();
 const g=fixture([{org_id:'other',address:input.address,outcome:'checked_invalid',seen_at:'2026-11-04'},{org_id:'org',address:input.address,outcome:'checked_invalid',seen_at:'2026-10-01'}]);
 expect(await g.check(input)).toMatchObject({status:'valid'});expect(g.worker.verifyEmail).toHaveBeenCalledTimes(1);
});
it('a fresh hard bounce outranks a warm valid check',async()=>{
 const f=fixture();await f.check(input);
 f.db.tables.email_outcomes.push({org_id:'org',address:input.address,outcome:'bounced_hard',seen_at:'2026-11-05'});
 expect(await f.check(input)).toMatchObject({status:'invalid',hardBounce:true,label:'This address bounced before.'});
});
it('labels unavailable checker results without pretending they are cached checks',async()=>{
 const f=fixture();f.worker.verifyEmail.mockResolvedValue({ok:false,failure:'unreachable',line:'private worker text'});
 expect(await f.check(input)).toMatchObject({status:'unverifiable',label:'Not confirmed'});
 expect(f.db.service.rpc).not.toHaveBeenCalled();
});
