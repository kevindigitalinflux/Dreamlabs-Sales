import {expect,it} from 'vitest';
import {prepareRecipientEvidence,supportedTierPattern,outcomeTierEvidence} from '../../supabase/functions/_shared/recipientTierEvidence';
import {recipientTier} from '../../supabase/functions/_shared/recipientTier';
const person={first:'Jane',last:'Smith'};
const proof=(email:string)=>prepareRecipientEvidence(email,{hasMailServer:true,generated:false,publishedByCompany:true});
const samples=[{email:'alex.brown@example.com',first:'Alex',last:'Brown',evidence:proof('alex.brown@example.com')},
 {email:'mary.jones@example.com',first:'Mary',last:'Jones',evidence:proof('mary.jones@example.com')}];
it('builds supported tier evidence with the existing unambiguous pattern and person identity rules',()=>{
 const address='jane.smith@example.com';const pattern=supportedTierPattern(address,person,samples,[]);
 expect(recipientTier(address,prepareRecipientEvidence(address,{generated:true,hasMailServer:true,pattern})).tier).toBe('T2');
});
it('does not use T2/T3 guesses or invalid addresses as T1 supporting samples',()=>{
 const sample={...samples[1],evidence:{...samples[1].evidence,publishedByCompany:false,generated:true}};
 const pattern=supportedTierPattern('jane.smith@example.com',person,[samples[0],sample],[]);
 expect(pattern?.t1Support.length??0).toBeLessThan(2);
});
it('does not count unowned samples as distinct people or accept conflicting formats',()=>{
 expect(supportedTierPattern('jane.smith@example.com',person,samples.map(s=>({...s,first:null,last:null})),[])?.t1Support).toEqual([]);
 expect(supportedTierPattern('jane.smith@example.com',person,[samples[0],{...samples[1],email:'mjones@example.com',evidence:proof('mjones@example.com')}],[])).toBeNull();
});
it('does not silently choose one owner when the same address is attributed to two different people',()=>{
 const duplicate=[{email:'a.brown@example.com',first:'Alex',last:'Brown',evidence:proof('a.brown@example.com')},
  {email:'a.brown@example.com',first:'Amy',last:'Brown',evidence:proof('a.brown@example.com')},
  {email:'m.jones@example.com',first:'Mary',last:'Jones',evidence:proof('m.jones@example.com')}];
 const address='j.smith@example.com';const pattern=supportedTierPattern(address,person,duplicate,[]);
 expect(recipientTier(address,prepareRecipientEvidence(address,{generated:true,hasMailServer:true,pattern})).tier).toBe('T3');
});
it('does not count a T1 role inbox as a different named person supporting a first-name pattern',()=>{
 const address='jane@example.com';const inputs=[{email:'alex@example.com',first:'Alex',last:'Brown',evidence:proof('alex@example.com')},
  {email:'info@example.com',first:'Info',last:'Role',evidence:proof('info@example.com')}];
 const pattern=supportedTierPattern(address,person,inputs,[]);
 expect(recipientTier(address,prepareRecipientEvidence(address,{generated:true,hasMailServer:true,pattern})).tier).toBe('T3');
});
it('declines an oversized evidence set rather than hiding a conflicting format beyond the inference bound',()=>{
 expect(supportedTierPattern('jane.smith@example.com',person,Array.from({length:41},()=>samples[0]),[])).toBeNull();
});
it('uses existing role-address review and syntax checks without weakening them',()=>{
 expect(prepareRecipientEvidence('info@example.com',{provider:'microsoft',hasMailServer:true}).roleNeedsReview).toBe(true);
 expect(prepareRecipientEvidence('jane.smith@example.com',{provider:'microsoft',hasMailServer:true}).roleNeedsReview).toBe(false);
 expect(prepareRecipientEvidence('bad..syntax@example.com',{}).syntaxValid).toBe(false);
});
it('binds reply/hard-bounce outcomes to exact organisation and address; hard bounce still wins',()=>{
 const address='jane.smith@example.com';const rows=[{org_id:'other',address,outcome:'bounced_hard'},
 {org_id:'org',address:'other@example.com',outcome:'bounced_hard'},{org_id:'org',address,outcome:'replied'}];
 const history=outcomeTierEvidence('org',address,rows);expect(history).toEqual({replied:true,bouncedHard:false});
 expect(recipientTier(address,prepareRecipientEvidence(address,{...history})).tier).toBe('T1');
 expect(outcomeTierEvidence('org',address,[...rows,{org_id:'org',address,outcome:'bounced_hard'}]).bouncedHard).toBe(true);
});
