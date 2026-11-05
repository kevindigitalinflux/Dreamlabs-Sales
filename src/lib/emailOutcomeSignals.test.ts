import {expect,it} from 'vitest';
import {domainBounceWarnings,loadDomainBounceWarnings} from '../../supabase/functions/_shared/emailOutcomeSignals';
const now=new Date('2026-11-05T12:00:00Z');
const row=(address:string,org_id='org',seen_at='2026-11-04T00:00:00Z',outcome='bounced_hard')=>({org_id,address,domain:address.split('@')[1]!,seen_at,outcome});
it('warns after three distinct hard-bounced addresses within fourteen days',()=>{
 expect([...domainBounceWarnings('org',[row('a@example.com'),row('A@example.com'),row('b@example.com')],now)]).toEqual([]);
 expect([...domainBounceWarnings('org',[row('a@example.com'),row('b@example.com'),row('c@example.com')],now)]).toEqual(['example.com']);
});
it('does not combine organisations, old outcomes, temporary checks or different domains',()=>{
 expect([...domainBounceWarnings('org',[row('a@example.com'),row('b@example.com'),row('c@example.com','other'),row('d@example.com','org','2026-10-01'),row('e@example.com','org',undefined,'checked_invalid'),row('f@elsewhere.com')],now)]).toEqual([]);
});
it('requests only scoped aggregate domains in bounded batches, without downloading hidden lead addresses',async()=>{
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const reader={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:(args.p_domains as string[]).map(domain=>({domain})),error:null};}};
 const domains=Array.from({length:41},(_,i)=>`company${i}.example.com`);
 expect(await loadDomainBounceWarnings(reader,'org',domains)).toEqual(domains);
 expect(calls).toHaveLength(3);expect(calls.every(c=>c.name==='email_domain_bounce_warnings'&&c.args.p_org_id==='org'&&(c.args.p_domains as string[]).length<=20)).toBe(true);
});
it('declines a failed aggregate or a domain outside the requested scope',async()=>{
 await expect(loadDomainBounceWarnings({rpc:async()=>({data:null,error:{message:'private'}})},'org',['example.com'])).rejects.toThrow('Domain bounce history unavailable');
 await expect(loadDomainBounceWarnings({rpc:async()=>({data:[{domain:'other.com'}],error:null})},'org',['example.com'])).rejects.toThrow('Domain bounce history unavailable');
});
