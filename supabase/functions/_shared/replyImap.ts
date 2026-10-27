import { ImapFlow } from 'npm:imapflow@1';
import PostalMime from 'npm:postal-mime@2.4.3';
import type { ParsedReply, ReplyInbox } from './replyPolling.ts';

/** Bounded INBOX-only adapter. Disable protocol logging, including authentication and message payloads. */
export function makeReplyInbox(host: string, port: number, user: string, pass: string): ReplyInbox {
  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false,
    disableAutoIdle: true, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
  return {
    get highestUid() { return client.mailbox ? Math.max(0, client.mailbox.uidNext - 1) : 0; },
    connect: () => client.connect().then(() => undefined), lock: () => client.getMailboxLock('INBOX'),
    fetch: range => client.fetch(range, { envelope: true, source: { maxLength: 1_000_000 } }, { uid: true }),
    logout: () => client.logout().then(() => undefined),
  };
}
/** Proper MIME decoding, with a one-megabyte source ceiling and plain-text storage downstream. */
export async function parseReplyMime(source: Uint8Array): Promise<ParsedReply> {
  if (source.byteLength >= 1_000_000) throw new Error('Reply source too large');
  const email = await PostalMime.parse(source);
  return { ...email, headers: email.headers.map(h => ({ key: h.key ?? '', value: h.value ?? '' })) };
}
