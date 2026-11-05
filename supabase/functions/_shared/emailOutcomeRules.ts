import { validEmail } from './contacts.ts';

export interface BounceMessage {
  headers: {key:string;value:string}[];
  text?: string;
  deliveryStatus?: string[];
}
/** Extract only explicitly nonexistent mailboxes from bounded, separate DSN recipient blocks. */
export function hardBounceRecipients(mail: BounceMessage): string[] {
  if (mail.headers.some(h => h.key.toLowerCase()==='auto-submitted' && h.value.trim().toLowerCase()==='auto-replied')) return [];
  const headerText = mail.headers.filter(h=>/^(?:final-recipient|original-recipient|x-failed-recipients|status|diagnostic-code|action)$/i.test(h.key))
    .map(h=>`${h.key}: ${h.value}`).join('\n');
  const text = (mail.text ?? '').slice(0,100_000).split(/\n\s*(?:-+\s*original message|content-type:\s*message\/rfc822)/i)[0] ?? '';
  const fallback = headerText && !/^(?:final-recipient|original-recipient|x-failed-recipients):/im.test(text)
    ? `${headerText}\n${text.replace(/\n\s*\n/g,'\n')}` : `${headerText}\n${text}`;
  const sources = mail.deliveryStatus?.length ? mail.deliveryStatus.slice(0,10) : [fallback];
  const recipients = new Set<string>();
  for (const source of sources) for (const block of source.slice(0,100_000).replace(/\r\n?/g,'\n').replace(/\n[ \t]+/g,' ').split(/\n\s*\n/)) {
    if (/\b4\.\d{1,3}\.\d{1,3}\b|mailbox (?:is )?full|quota exceeded|over quota|gr[ae]ylist|temporar|try again later/i.test(block)) continue;
    const action = /^action:\s*(\S+)/im.exec(block)?.[1];
    if (action && action.toLowerCase()!=='failed') continue;
    if (!/\b5\.1\.(?:1|10)\b|\buser unknown\b|\bmailbox (?:not found|does not exist)\b/i.test(block)) continue;
    // Other explicit permanent statuses (for example policy refusal) cannot prove a mailbox is absent.
    if (/^status:\s*(?!5\.1\.(?:1|10)\b)\d+\.\d+\.\d+/im.test(block)) continue;
    const field = /^(?:final-recipient):\s*(.+)$/im.exec(block)?.[1]
      ?? /^(?:original-recipient|x-failed-recipients):\s*(.+)$/im.exec(block)?.[1];
    for (const token of field?.replace(/^rfc822\s*;\s*/i,'').split(/[,;\s]+/) ?? []) {
      const email = validEmail(token.replace(/^<|>$/g,''));
      if (email) recipients.add(email);
    }
  }
  return [...recipients].slice(0,100);
}
