import { expect, it, vi } from 'vitest';
const delivered = vi.hoisted(() => vi.fn());
vi.mock('https://deno.land/x/denomailer@1.6.0/mod.ts', () => ({ SMTPClient: class { send(message) { delivered(message); } async close() {} } }));
import { sendMail } from '../../supabase/functions/_shared/smtp';
it('emits valid threading headers at the final SMTP boundary without calling a mail server', async () => {
  await sendMail({ host: 'localhost', port: 465, user: 'local@fixture.invalid', pass: 'dummy', fromName: null },
    { to: 'lead@fixture.invalid', subject: 'Re: Hi', body: 'Answer', inReplyTo: '<reply@fixture.invalid>', references: '<sent@fixture.invalid>' });
  expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.objectContaining({ 'In-Reply-To': '<reply@fixture.invalid>', References: '<sent@fixture.invalid> <reply@fixture.invalid>' }) }));
});
