import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../../supabase/functions/_shared/dnsLookup',()=>({cachedMailProvider:vi.fn(()=>null),lookupMx:vi.fn(async()=>'mx')}));
import {cachedMailProvider} from '../../supabase/functions/_shared/dnsLookup';
import {makeEmailPrechecker} from '../../supabase/functions/_shared/emailPreSend';
import {replyDatabase} from './replyTestDatabase';
import {USAGE_DEFAULTS} from '../../supabase/functions/_shared/usageRules';
const now=()=>Date.parse('2026-11-05T12:00:00Z');
const input={leadId:'lead',address:'person@example.com'};
afterEach(()=>cachedMailProvider.mockReturnValue(null));
function fixture(outcomes=[]) {
 const db=replyDatabase({email_outcomes:outcomes});db.service.rpc=vi.fn(async()=>({error:null}));
 const worker={verifyEmail:vi.fn(async()=>({ok:true,value:{status:'valid',reason:'deliverable'}})),scrapeSite:vi.fn(),lines:()=>[]};
 const mx=vi.fn(async()=>'mx');
 return {db,worker,mx,check:makeEmailPrechecker(db.service,'org',{worker,now,lookupMx:mx})};
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
it('blocks invalid syntax without a worker or DNS request',async()=>{
 const f=fixture();expect(await f.check({...input,address:'bad\r\nrecipient'})).toMatchObject({status:'invalid',overridable:false});
 expect(f.worker.verifyEmail).not.toHaveBeenCalled();expect(f.mx).not.toHaveBeenCalled();
});
it('blocks a domain known to have no MX without a worker call',async()=>{
 const f=fixture();f.mx.mockResolvedValue('none');
 expect(await f.check(input)).toMatchObject({status:'invalid',label:'This email domain has no mail server'});
 expect(f.worker.verifyEmail).not.toHaveBeenCalled();
});
it('flags common domain typos without changing or silently correcting the address',async()=>{
 const f=fixture();const address='person@gmial.com';
 expect(await f.check({...input,address})).toMatchObject({label:expect.stringContaining('gmail.com')});
 expect(f.worker.verifyEmail).toHaveBeenCalledWith(address,{timeoutMs:33000});
});
it('allows a quota-exhausted send with an explicit non-cached label and the approved quotas',async()=>{
 const f=fixture();f.worker.verifyEmail.mockResolvedValue({ok:false,failure:'limit_reached',line:'limit'});
 expect(await f.check(input)).toMatchObject({status:'unverifiable',label:'Not checked: daily check allowance reached'});
 expect(f.db.service.rpc).not.toHaveBeenCalled();
 expect(USAGE_DEFAULTS.worker_verify).toEqual({orgLimit:600,globalLimit:1200});
});
it('does not promote hosted role SMTP acceptance to confirmation, but preserves a real reply',async()=>{
 cachedMailProvider.mockReturnValue('hosted');
 const f=fixture();expect(await f.check({...input,address:'info@example.com'})).toMatchObject({status:'unverifiable',label:'Role address, not confirmed'});
 expect(f.db.service.rpc).toHaveBeenCalledWith('record_email_outcome',expect.objectContaining({p_outcome:'checked_unverifiable'}));
 const replied=fixture([{org_id:'org',address:'info@example.com',outcome:'replied',seen_at:'2026-11-04'}]);
 expect(await replied.check({...input,address:'info@example.com'})).toMatchObject({status:'valid',label:'This address has replied before.'});
});
