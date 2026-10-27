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
