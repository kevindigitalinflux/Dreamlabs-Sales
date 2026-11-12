import {expect,it} from 'vitest';
import {isPlaceholderAddress} from '../../supabase/functions/_shared/emailPrecheckRules';
it.each(['a@domain.com','x@fakeemail.com','abc@sentry-next.wixpress.com','noreply@acme.co.uk','firstname.lastname@acme.com'])('%s is a placeholder',address=>expect(isPlaceholderAddress(address)).toBe(true));
it.each(['jo@acme.co.uk','info@acme.com','tester@acme.com'])('%s is not a placeholder',address=>expect(isPlaceholderAddress(address)).toBe(false));
it.each(['example.com','example.org','example.net','domain.com','email.com','test.com','fakeemail.com','mailinator.com','sentry.io','wixpress.com'])('blocks %s and its subdomains',domain=>{
 expect(isPlaceholderAddress(`alex@${domain}`)).toBe(true);expect(isPlaceholderAddress(`ALEX@SUB.${domain.toUpperCase()}`)).toBe(true);
});
it.each(['test','example','noreply','no-reply','donotreply','do-not-reply','user','name','email','yourname','firstname.lastname'])('blocks placeholder local part %s',local=>expect(isPlaceholderAddress(`${local}@acme.co.uk`)).toBe(true));
