import {expect,it} from 'vitest';
import {needsLook} from './needsLook';
it('includes weak-only, company conflicts, suspect websites and bounced-only saved recipients',()=>{
 const lead={id:'lead',email:'a@example.com',additional_emails:[],readiness:'ready'};
 expect(needsLook(lead,{weakOnly:true})).toBe(true);
 expect(needsLook(lead,{companyConflict:true})).toBe(true);
 expect(needsLook(lead,{websiteSuspect:true})).toBe(true);
 expect(needsLook(lead,{bounced:['a@example.com']})).toBe(true);
 expect(needsLook({...lead,additional_emails:['safe@example.com']},{bounced:['a@example.com']})).toBe(false);
 expect(needsLook(lead,{})).toBe(false);
});
