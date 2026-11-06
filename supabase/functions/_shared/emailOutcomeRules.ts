import { validEmail } from './contacts.ts';
import { automaticMail } from './replyRules.ts';

export interface BounceMessage {
  headers: {key:string;value:string}[];
  text?: string;
  deliveryStatus?: string[];
  subject?: string;
  from?: {address?:string};
  returnedRecipientHeaders?: string[];
}
/** Restrict permanent failures to recipient failures; policy and capacity failures do not suppress addresses. */
export function hardBounceStatus(block:string): boolean {
  if (/\b4\.\d{1,3}\.\d{1,3}\b|mailbox (?:is )?full|quota exceeded|over quota|gr[ae]ylist|temporar|try again later/i.test(block)) return false;
  const action=/^action:\s*(\S+)/im.exec(block)?.[1];
  if(action&&action.toLowerCase()!=='failed')return false;
  const codes=block.match(/\b[245]\.\d{1,3}\.\d{1,3}\b/g)??[];
  const recipientCode=(code:string)=>/^5\.(?:1\.(?:1|10|2|3|6)|2\.1)$/.test(code)
    || (code==='5.4.1'&&/\b550\s+5\.4\.1\s+Recipient address rejected:\s*Access denied\b/i.test(block));
  if(codes.length)return codes.every(recipientCode);
  return /\buser unknown\b|\bmailbox (?:not found|does not exist)\b/i.test(block);
}
/** Extract only explicitly nonexistent mailboxes from bounded, separate DSN recipient blocks. */
export function hardBounceRecipients(mail: BounceMessage): string[] {
  if (/out[ -]of[ -]office|automatic reply|auto[ -]?reply|delayed|delivery (?:delay|warning)/i.test(mail.subject??'')) return [];
  if (mail.headers.some(h => h.key.toLowerCase()==='auto-submitted' && h.value.trim().toLowerCase()==='auto-replied')
    && automaticMail(mail.headers.map(h=>[h.key,h.value]),mail.subject??'',mail.from?.address??'')!=='bounce') return [];
  const headerText = mail.headers.filter(h=>/^(?:final-recipient|original-recipient|x-failed-recipients|status|diagnostic-code|action)$/i.test(h.key))
    .map(h=>`${h.key}: ${h.value}`).join('\n');
  const text = (mail.text ?? '').slice(0,100_000).split(/\n\s*(?:-+\s*original message|content-type:\s*message\/rfc822)/i)[0] ?? '';
  const fallback = headerText && !/^(?:final-recipient|original-recipient|x-failed-recipients):/im.test(text)
    ? `${headerText}\n${text.replace(/\n\s*\n/g,'\n')}` : `${headerText}\n${text}`;
  const sources = [...(mail.deliveryStatus??[]).slice(0,10),fallback];
  const recipients = new Set<string>();
  let hasRecipientBlock=false;
  for (const source of sources) for (const block of source.slice(0,100_000).replace(/\r\n?/g,'\n').replace(/\n[ \t]+/g,' ').split(/\n\s*\n/)) {
    const field = /^(?:final-recipient):\s*(.+)$/im.exec(block)?.[1]
      ?? /^(?:original-recipient):\s*(.+)$/im.exec(block)?.[1];
    if(!field||!bounceAddresses(field).length||!(/\b[245]\.\d{1,3}\.\d{1,3}\b|^action:|\buser unknown\b|\bmailbox (?:not found|does not exist)\b/im.test(block)))continue;
    hasRecipientBlock=true;
    // Other explicit permanent statuses (for example policy refusal) cannot prove a mailbox is absent.
    if (!hardBounceStatus(block)) continue;
    for (const email of bounceAddresses(field)) recipients.add(email);
  }
  // Structured recipients own their statuses. Never lend one recipient's failure to another.
  if(hasRecipientBlock)return [...recipients].slice(0,100);
  if(!hardBounceStatus(fallback))return [];
  const failed=mail.headers.filter(h=>h.key.toLowerCase()==='x-failed-recipients').flatMap(h=>bounceAddresses(h.value));
  const returned=(mail.returnedRecipientHeaders??[]).slice(0,10).flatMap(bounceAddresses);
  const sentence=[...text.matchAll(/\bYour message wasn['’]t delivered to\s+(<?[^\s<>]+@[^\s<>]+>?)/gi)].flatMap(m=>bounceAddresses(m[1]));
  for(const email of failed.length?failed:returned.length?returned:sentence)recipients.add(email);
  return [...recipients].slice(0,100);
}
/** Parse bounded recipient header tokens without admitting display names or arbitrary body addresses. */
export function bounceAddresses(value:string):string[] {
  return value.slice(0,20_000).replace(/^rfc822\s*;\s*/i,'').split(/[,;\s]+/)
    .flatMap(token=>{const email=validEmail(token.replace(/^<|>$/g,''));return email?[email]:[];}).slice(0,100);
}
