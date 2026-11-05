import { expect, it } from 'vitest';
import { parseReplyMime } from '../../supabase/functions/_shared/replyImap';

it('parses real multipart MIME and quoted-printable into readable text and threading headers', async () => {
  const source = ['From: Lead <local@example.invalid>', 'To: Sender <sender@example.invalid>', 'Message-ID: <reply@example.invalid>',
    'In-Reply-To: <sent@example.invalid>', 'References: <sent@example.invalid>', 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary=fixture', '',
    '--fixture', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'Thanks=2C Tuesday works.',
    '--fixture', 'Content-Type: text/html; charset=utf-8', '', '<p>Thanks, Tuesday works.</p>', '--fixture--', ''].join('\r\n');
  const parsed = await parseReplyMime(new TextEncoder().encode(source));
  expect(parsed.text.trim()).toBe('Thanks, Tuesday works.');
  expect(parsed.messageId).toBe('<reply@example.invalid>');
  expect(parsed.from.address).toBe('local@example.invalid');
  expect(parsed.inReplyTo).toBe('<sent@example.invalid>');
});
it('retains only decoded delivery-status and returned-message header evidence for bounce learning',async()=>{
 const source=['From: Mailer-Daemon <mailer-daemon@example.com>','Message-ID: <dsn@example.com>','MIME-Version: 1.0','Content-Type: multipart/report; report-type=delivery-status; boundary=dsn','',
 '--dsn','Content-Type: text/plain','','Delivery failed.','--dsn','Content-Type: message/delivery-status','','Reporting-MTA: dns; mx.example.com','','Final-Recipient: rfc822; missing@example.com','Status: 5.1.1',
 '--dsn','Content-Type: message/rfc822','','Message-ID: <original@example.com>','From: sender@example.com','To: missing@example.com','','PRIVATE ORIGINAL BODY','--dsn--',''].join('\r\n');
 const parsed=await parseReplyMime(new TextEncoder().encode(source));
 expect(parsed.deliveryStatus).toEqual([expect.stringContaining('Final-Recipient: rfc822; missing@example.com')]);
 expect(parsed.originalMessageIds).toEqual(['<original@example.com>']);
});
