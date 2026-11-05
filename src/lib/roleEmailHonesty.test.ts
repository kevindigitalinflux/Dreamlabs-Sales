import {expect,it} from 'vitest';
import {roleAddressNeedsReview,isRoleAddress,ROLE_ADDRESS_LABEL} from '../../supabase/functions/_shared/emailPrecheckRules';
it.each(['info','hello','contact','office','enquiries','admin','sales'])('recognises %s without confusing a named mailbox',local=>{
 expect(isRoleAddress(`${local}@example.com`)).toBe(true);
 expect(roleAddressNeedsReview(`${local}@example.com`,'hosted',false)).toBe(true);
 expect(roleAddressNeedsReview(`${local}@example.com`,'unknown',true)).toBe(true);
 expect(roleAddressNeedsReview(`${local}@example.com`,'unknown',false)).toBe(false);
});
it('keeps named SMTP-valid addresses separate from generic role addresses',()=>{
 expect(roleAddressNeedsReview('jane.smith@example.com','microsoft',true)).toBe(false);
 expect(ROLE_ADDRESS_LABEL).toBe('Role address, not confirmed');
});
