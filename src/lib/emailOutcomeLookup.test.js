import {expect,it} from 'vitest';
import {makeEmailOutcomeLookup} from '../../supabase/functions/_shared/emailOutcomeLookup';
import {replyDatabase} from './replyTestDatabase';
const row=(outcome,address='person@example.com',org_id='org')=>({org_id,address,domain:'example.com',outcome,seen_at:'2026-11-04'});
it('honours exact org/address evidence, prioritising hard bounces over replies',async()=>{
 const db=replyDatabase({email_outcomes:[row('replied'),row('bounced_hard'),row('replied','other@example.com','elsewhere')]});
 const lookup=makeEmailOutcomeLookup(db.service,'org');
 expect(await lookup.status('Person@Example.com')).toEqual({status:'invalid',reason:'bounced_hard'});
 expect(await lookup.status('other@example.com')).toBeNull();
 expect(await lookup.status('untouched@example.com')).toBeNull();
});
it('shares concurrent exact-address reads and returns replied evidence without a worker call',async()=>{
 const db=replyDatabase({email_outcomes:[row('replied')]});const lookup=makeEmailOutcomeLookup(db.service,'org');
 expect(await Promise.all([lookup.status('person@example.com'),lookup.status('person@example.com')])).toEqual([{status:'valid',reason:'previously_replied'},{status:'valid',reason:'previously_replied'}]);
 expect(db.queries.filter(q=>q.table==='email_outcomes')).toHaveLength(1);
});
it('declines missing storage rather than treating known bounces as safe',async()=>{
 const db=replyDatabase();db.failures.add('email_outcomes:select');
 await expect(makeEmailOutcomeLookup(db.service,'org').status('person@example.com')).rejects.toThrow('Email outcome history is unavailable');
});
it('uses genuine replied format samples but never a subsequently hard-bounced address',async()=>{
 const db=replyDatabase({email_outcomes:[row('replied'),row('bounced_hard'),row('replied','alex.brown@example.com')]});
 expect(await makeEmailOutcomeLookup(db.service,'org').replySamples('example.com')).toEqual([{email:'alex.brown@example.com',first:null,last:null,published:true}]);
});
