import {expect,it,vi} from 'vitest';
vi.mock('../../supabase/functions/_shared/dnsLookup',()=>({lookupMx:vi.fn(async()=>'mx'),cachedMailProvider:()=> 'unknown'}));
import {loadRecipientContext} from '../../supabase/functions/_shared/recipientContext';
import {replyDatabase} from './replyTestDatabase';
it('classifies own saved company email, generated provenance and hard bounces using current scoped facts',async()=>{
 const db=replyDatabase({leads:[{id:'lead',org_id:'org',email:'person@example.com'}],decision_maker_candidates:[],email_outcomes:[],deep_find_leads:[]});
 const ctx=await loadRecipientContext(db.service,'org','lead');expect((await ctx.assess('person@example.com')).result.tier).toBe('T1');
 db.tables.email_outcomes.push({org_id:'org',address:'person@example.com',outcome:'bounced_hard'});
 expect((await (await loadRecipientContext(db.service,'org','lead')).assess('person@example.com')).result.tier).toBe('never');
});
it('fails closed if current evidence cannot be read',async()=>{
 const db=replyDatabase();db.failures.add('email_outcomes:select');await expect(loadRecipientContext(db.service,'org','lead')).rejects.toThrow();
});
