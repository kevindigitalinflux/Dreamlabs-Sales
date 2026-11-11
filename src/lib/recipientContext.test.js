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
it('downgrades T2 during measured risk, recovers automatically, and refreshes stored sample negatives',async()=>{
 const address='alex.brown@example.com',at=new Date(Date.now()-86400000).toISOString();
 const db=replyDatabase({leads:[{id:'lead',org_id:'org',email:address}],email_outcomes:[],decision_maker_candidates:[
  {id:'a',lead_id:'lead',first_name:'Mary',last_name:'Jones',email:'mary.jones@example.com',source:'manual'},
  {id:'b',lead_id:'lead',first_name:'John',last_name:'Smith',email:'john.smith@example.com',source:'manual'}],
 deep_find_leads:[{lead_id:'lead',org_id:'org',domains:{recipient_evidence:{[address]:{generated:true,forAddress:address,pattern:{domain:'example.com',candidateMatches:true,t1Support:[{address:'mary.jones@example.com',personKey:'mary jones'},{address:'john.smith@example.com',personKey:'john smith'}]}}}}}],
 email_logs:Array.from({length:30},(_,i)=>({id:String(i),org_id:'org',status:'sent',to_email:`old${i}@example.com`,sent_at:at,recipient_tier_at_send:'T2',recipient_tier_version:1,hard_bounced_at:i<3?at:null}))});
 expect((await (await loadRecipientContext(db.service,'org','lead')).assess(address)).result).toMatchObject({tier:'T3',basis:'pattern_paused'});
 db.tables.email_logs[0].hard_bounced_at=null;
 expect((await (await loadRecipientContext(db.service,'org','lead')).assess(address)).result.tier).toBe('T2');
 db.tables.email_outcomes.push({org_id:'org',address:'mary.jones@example.com',outcome:'bounced_hard'});
 expect((await (await loadRecipientContext(db.service,'org','lead')).assess(address)).result.tier).toBe('T3');
});
