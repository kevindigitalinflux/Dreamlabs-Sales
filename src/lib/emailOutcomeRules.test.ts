import { expect, it } from 'vitest';
import { hardBounceRecipients } from '../../supabase/functions/_shared/emailOutcomeRules';

const mail = (text: string, headers: {key:string;value:string}[] = []) => ({text,headers});
it.each(['Final-Recipient','Original-Recipient','X-Failed-Recipients'])('extracts a permanent nonexistent recipient from %s',header=>{
 expect(hardBounceRecipients(mail('Status: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 user unknown',[{key:header,value:'rfc822; Person@Example.com'}]))).toEqual(['person@example.com']);
});
it.each(['Status: 4.1.1\nDiagnostic-Code: smtp; 450 user unknown','Status: 5.2.2\nmailbox full','Status: 5.7.1\naccess denied','Action: delayed\nStatus: 5.1.1','greylisting; try again later'])('declines a soft or non-mailbox failure: %s',text=>{
 expect(hardBounceRecipients(mail(`Final-Recipient: rfc822; person@example.com\n${text}`))).toEqual([]);
});
it('classifies each recipient separately and excludes forwarded-original and successful addresses',()=>{
 expect(hardBounceRecipients(mail('Final-Recipient: rfc822; lost@example.com\nStatus: 5.1.1\n\nFinal-Recipient: rfc822; full@example.com\nStatus: 4.2.2\n\n-- Original message --\nFinal-Recipient: rfc822; unrelated@example.com\nStatus: 5.1.1'))).toEqual(['lost@example.com']);
});
it('keeps structured delivery-status recipient blocks separate',()=>{
 expect(hardBounceRecipients({headers:[],text:'unrelated original user unknown other@example.com',deliveryStatus:[
 'Reporting-MTA: dns; mx.example.com\n\nFinal-Recipient: rfc822; lost@example.com\nAction: failed\nStatus: 5.1.10\n\nFinal-Recipient: rfc822; full@example.com\nStatus: 5.2.2\n\nFinal-Recipient: rfc822; fine@example.com\nStatus: 2.0.0'
 ]})).toEqual(['lost@example.com']);
});
it('can attribute a single header recipient to a plain permanent-failure body with paragraphs',()=>{
 expect(hardBounceRecipients(mail('Delivery failed.\n\n550 5.1.1 user unknown',[{key:'X-Failed-Recipients',value:'missing@example.com'}]))).toEqual(['missing@example.com']);
});
it('prefers the final target over a different original recipient after forwarding',()=>{
 expect(hardBounceRecipients(mail('Original-Recipient: rfc822; working@example.com\nFinal-Recipient: rfc822; missing@forward.example.com\nStatus: 5.1.1'))).toEqual(['missing@forward.example.com']);
});
it('does not extract addresses from an ordinary human or out-of-office reply',()=>{
 expect(hardBounceRecipients(mail('user unknown person@example.com'))).toEqual([]);
 expect(hardBounceRecipients(mail('Final-Recipient: rfc822; person@example.com\nStatus: 5.1.1',[{key:'Auto-Submitted',value:'auto-replied'}]))).toEqual([]);
});
it.each(['5.2.1','5.1.2','5.1.3','5.1.6'])('accepts permanent recipient failure %s',code=>{
 expect(hardBounceRecipients(mail(`Final-Recipient: rfc822; person@example.com\nStatus: ${code}\nDiagnostic-Code: smtp; 550 ${code} recipient unavailable`))).toEqual(['person@example.com']);
});
it('accepts the Microsoft tenant recipient rejection, but not other 5.4.1 failures',()=>{
 expect(hardBounceRecipients(mail('Final-Recipient: rfc822; person@example.com\n550 5.4.1 Recipient address rejected: Access denied'))).toEqual(['person@example.com']);
 expect(hardBounceRecipients(mail('Final-Recipient: rfc822; person@example.com\n550 5.4.1 Routing failure'))).toEqual([]);
});
it.each(['5.2.2','5.2.3','5.3.0','5.3.4','5.7.1','5.7.26','4.1.1','4.2.1'])('does not learn non-recipient status %s despite user-unknown text',code=>{
 expect(hardBounceRecipients(mail(`Final-Recipient: rfc822; person@example.com\nStatus: ${code}\nuser unknown`))).toEqual([]);
});
it.each(['Automatic reply','Out of office','Delayed delivery notification','Delivery Status Notification (Delay)'])('ignores %s despite a quoted permanent failure',subject=>{
 expect(hardBounceRecipients({...mail('Final-Recipient: rfc822; person@example.com\nStatus: 5.2.1'),subject})).toEqual([]);
});
it('allows auto-replied for a DSN report, but not an ordinary auto-reply',()=>{
 const text='Final-Recipient: rfc822; person@example.com\nStatus: 5.1.1';
 expect(hardBounceRecipients(mail(text,[{key:'Auto-Submitted',value:'auto-replied'},{key:'Content-Type',value:'multipart/report; report-type=delivery-status'}]))).toEqual(['person@example.com']);
 expect(hardBounceRecipients(mail(text,[{key:'Auto-Submitted',value:'auto-replied'}]))).toEqual([]);
});
it.each(['450 user unknown','250 user unknown','450 5.2.1 inactive'])('does not treat SMTP response %s as permanent',response=>{
 expect(hardBounceRecipients(mail(`Final-Recipient: rfc822; person@example.com\nDiagnostic-Code: smtp; ${response}`))).toEqual([]);
});
it('does not override a delayed structured recipient with a hard human-readable body',()=>{
 expect(hardBounceRecipients({headers:[{key:'X-Failed-Recipients',value:'person@example.com'}],
  text:'550 5.2.1 inactive',deliveryStatus:['Final-Recipient: rfc822; person@example.com\nAction: delayed']})).toEqual([]);
});
