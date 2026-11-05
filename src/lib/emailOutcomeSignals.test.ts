import {expect,it} from 'vitest';
import {domainBounceWarnings} from '../../supabase/functions/_shared/emailOutcomeSignals';
const now=new Date('2026-11-05T12:00:00Z');
const row=(address:string,org_id='org',seen_at='2026-11-04T00:00:00Z',outcome='bounced_hard')=>({org_id,address,domain:address.split('@')[1]!,seen_at,outcome});
it('warns after three distinct hard-bounced addresses within fourteen days',()=>{
 expect([...domainBounceWarnings('org',[row('a@example.com'),row('A@example.com'),row('b@example.com')],now)]).toEqual([]);
 expect([...domainBounceWarnings('org',[row('a@example.com'),row('b@example.com'),row('c@example.com')],now)]).toEqual(['example.com']);
});
it('does not combine organisations, old outcomes, temporary checks or different domains',()=>{
 expect([...domainBounceWarnings('org',[row('a@example.com'),row('b@example.com'),row('c@example.com','other'),row('d@example.com','org','2026-10-01'),row('e@example.com','org',undefined,'checked_invalid'),row('f@elsewhere.com')],now)]).toEqual([]);
});
