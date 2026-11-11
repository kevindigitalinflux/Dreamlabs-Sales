import {expect,it} from 'vitest';
import {evaluateReadiness,readinessText} from '../../supabase/functions/_shared/leadReadiness';
import {prepareRecipientEvidence} from '../../supabase/functions/_shared/recipientTierEvidence';
const address='person@example.com';const base={lead:{business_name:'Example',email:address},contacts:[],domains:[],validEmails:[],websiteSuspect:false};
it('readiness needs a company name and a T1 or T2 saved recipient, not a named person or site',()=>{
 expect(evaluateReadiness({...base,recipientEvidence:{[address]:prepareRecipientEvidence(address,{publishedByCompany:true})}}).readiness).toBe('ready');
 expect(evaluateReadiness({...base,validEmails:[address],lead:{email:address}}).readiness).toBe('almost');
});
it('T2 is sendable while T3 and hard-negative recipients are not',()=>{
 const evidence=prepareRecipientEvidence(address,{generated:true,hasMailServer:true,pattern:{domain:'example.com',candidateMatches:true,t1Support:[{address:'a@example.com',personKey:'alex brown'},{address:'b@example.com',personKey:'mary jones'}]}});
 expect(evaluateReadiness({...base,recipientEvidence:{[address]:evidence}}).readiness).toBe('ready');
 expect(evaluateReadiness({...base,recipientEvidence:{[address]:{...evidence,bouncedHard:true}}}).readiness_missing).toContain('sendable_email');
 expect(evaluateReadiness(base).readiness).toBe('almost');
});
it('keeps suspicion/foreign-phone overrides and ignores dismissed-only recipients',()=>{
 expect(evaluateReadiness({...base,validEmails:[address],websiteSuspect:true}).readiness).toBe('needs_work');
 expect(evaluateReadiness({...base,validEmails:[address],lead:{...base.lead,country:'GB',phone:'+35312345678'}}).readiness).toBe('needs_work');
 expect(evaluateReadiness({...base,lead:{business_name:'Example'},contacts:[{email:address,dismissed_at:'date'}],validEmails:[address]}).readiness_missing).toContain('sendable_email');
});
it('formats new counts and old missing keys',()=>{
 expect(readinessText('ready',[],2)).toBe('Ready: 2 supported addresses');expect(readinessText('almost',['sendable_email'])).toBe('Almost: no sendable email');
 expect(readinessText('almost',['verified_email'])).toBe('Almost: no verified email');
});
