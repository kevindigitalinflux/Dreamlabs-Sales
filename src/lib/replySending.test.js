import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/smtp', () => ({ sendMail: vi.fn(async () => ({ messageId: '<answer@fixture.invalid>' })) }));
import { sendLeadEmail } from '../../supabase/functions/_shared/sendLeadEmail';
import { sendMail } from '../../supabase/functions/_shared/smtp';
import { replyDatabase } from './replyTestDatabase';
beforeEach(() => vi.clearAllMocks());
it('never returns or stores raw SMTP error payloads', async () => {
  sendMail.mockRejectedValueOnce(new Error('secret-server-payload'));
  const db = replyDatabase();
  const result = await sendLeadEmail(db.service, { senderId: 'sender', leadId: 'lead', orgId: 'org', leadStage: 'replied',
    mailbox: { settings: {}, pass: 'dummy' }, to: 'lead@fixture.invalid', subject: 'Re: Hello', body: 'Thanks' });
  expect(JSON.stringify(result)).not.toContain('secret-server-payload');
  expect(JSON.stringify(db.tables.email_logs)).not.toContain('secret-server-payload');
});
it('passes threading headers through the real shared send path and preserves the reply link', async () => {
  const db = replyDatabase();
  await sendLeadEmail(db.service, { senderId: 'sender', leadId: 'lead', orgId: 'org', leadStage: 'replied',
    mailbox: { settings: { smtp_host: 'localhost', smtp_port: 465, smtp_user: 'local@example.invalid' }, pass: 'dummy' },
    to: 'lead@fixture.invalid', subject: 'Re: Hello', body: 'Thanks', replyId: 'reply',
    inReplyTo: '<reply@fixture.invalid>', references: '<sent@fixture.invalid>' });
  expect(sendMail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ inReplyTo: '<reply@fixture.invalid>', references: '<sent@fixture.invalid>' }));
  expect(db.tables.email_logs[0].reply_id).toBe('reply');
});
