import { ImapFlow } from 'npm:imapflow@1';
import PostalMime from 'npm:postal-mime@2.4.3';
import type { ParsedReply, ReplyInbox } from './replyPolling.ts';
import { messageIds } from './replyRules.ts';

/** Bounded INBOX-only adapter. Disable protocol logging, including authentication and message payloads. */
export function makeReplyInbox(host: string, port: number, user: string, pass: string): ReplyInbox {
  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false,
    disableAutoIdle: true, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
  return {
    get highestUid() { return client.mailbox ? Math.max(0, client.mailbox.uidNext - 1) : 0; },
    get uidValidity() {return client.mailbox?client.mailbox.uidValidity.toString():undefined;},
    connect: () => client.connect().then(() => undefined), lock: () => client.getMailboxLock('INBOX'),
    fetch: range => client.fetch(range, { envelope: true, internalDate: true, source: { maxLength: 1_000_000 } }, { uid: true }),
    searchSince: async(since,beforeUid)=>beforeUid===1?[]:(await client.search({since,...(beforeUid?{uid:`1:${beforeUid-1}`}:{})},{uid:true}))||[],
    logout: () => client.logout().then(() => undefined),
    abort: () => client.close(),
  };
}
/** Proper MIME decoding, with a one-megabyte source ceiling and plain-text storage downstream. */
export async function parseReplyMime(source: Uint8Array): Promise<ParsedReply> {
  if (source.byteLength >= 1_000_000) throw new Error('Reply source too large');
  const email = await PostalMime.parse(source);
  const decode=(value:ArrayBuffer|Uint8Array|string)=>typeof value==='string'?value:new TextDecoder().decode(value);
  const deliveryStatus=email.attachments.filter(a=>a.mimeType==='message/delivery-status').slice(0,10).map(a=>decode(a.content).slice(0,100_000));
  const originalMessageIds=email.attachments.filter(a=>a.mimeType==='message/rfc822').slice(0,10).flatMap(a=>{
    const headers=decode(a.content).slice(0,20_000).split(/\r?\n\r?\n/)[0]??'';
    return messageIds(/^message-id:\s*(.+)$/im.exec(headers)?.[1]??'');
  });
  return { ...email, deliveryStatus, originalMessageIds, headers: email.headers.map(h => ({ key: h.key ?? '', value: h.value ?? '' })) };
}
