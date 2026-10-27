import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/replyDraft', () => ({ composeReply: vi.fn(async () => ({ subject: 'Re: Hello', body: 'Editable answer' })) }));
vi.mock('../../supabase/functions/_shared/sendLeadEmail', () => ({ loadSenderMailbox: vi.fn(async () => ({ ok: true, settings: {}, pass: 'dummy' })), sendLeadEmail: vi.fn(async () => ({ ok: true, logId: null })) }));
import { createClient } from 'npm:@supabase/supabase-js@2';
import { composeReply } from '../../supabase/functions/_shared/replyDraft';
import { sendLeadEmail } from '../../supabase/functions/_shared/sendLeadEmail';
import { replyDatabase } from './replyTestDatabase';
let handler, db, visible, signedIn;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); visible = true; signedIn = true;
  vi.stubGlobal('Deno', { env: { get: () => 'dummy-local' }, serve: fn => { handler = fn; } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network'); }));
  db = replyDatabase({ org_members: [{ org_id: 'org', user_id: 'user' }],
    leads: [{ id: 'lead', org_id: 'org', stage: 'replied' }],
    email_replies: [{ id: 'reply', lead_id: 'lead', org_id: 'org', email_log_id: 'original', message_id: '<reply@fixture.invalid>', thread_references: '<sent@fixture.invalid>', body: 'Private reply', subject: 'Hello' }],
    email_logs: [{ id: 'original', lead_id: 'lead', org_id: 'org', to_email: 'trusted@fixture.invalid', sent_by: 'user', sequence_enrollment_id: null }] });
  const caller = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'user' } : null } }) }, rpc: async () => ({ data: visible, error: null }) };
  createClient.mockImplementation((_url, _key, options) => options ? caller : db.service);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = body => new Request('http://localhost/function', { method: 'POST', headers: { Authorization: 'Bearer dummy-local', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('draft-reply checks a JWT and visibility and returns an editable draft without writing or sending', async () => {
  await import('../../supabase/functions/draft-reply/index');
  expect((await handler(request({ reply_id: 'reply' }))).status).toBe(200);
  expect(composeReply).toHaveBeenCalledOnce(); expect(db.writes).toEqual([]); expect(sendLeadEmail).not.toHaveBeenCalled();
});
it.each(['signed_out', 'hidden', 'not_member'])('draft-reply denies %s before using AI', async mode => {
  if (mode === 'signed_out') signedIn = false;
  if (mode === 'hidden') visible = false;
  if (mode === 'not_member') db.tables.org_members = [];
  await import('../../supabase/functions/draft-reply/index');
  expect((await handler(request({ reply_id: 'reply' }))).status).toBe(mode === 'signed_out' ? 401 : 404);
  expect(composeReply).not.toHaveBeenCalled();
});
it('send-email derives headers from the authorised stored reply and marks it handled only after sending', async () => {
  await import('../../supabase/functions/send-email/index');
  const response = await handler(request({ lead_id: 'lead', reply_id: 'reply', to_email: 'trusted@fixture.invalid', subject: 'Hello', body: 'Edited answer', in_reply_to: '<forged@fixture.invalid>' }));
  expect(response.status).toBe(200);
  expect(sendLeadEmail).toHaveBeenCalledWith(db.service, expect.objectContaining({ replyId: 'reply', inReplyTo: '<reply@fixture.invalid>', references: '<sent@fixture.invalid>' }));
  expect(db.tables.email_replies[0].handled_at).toBeTruthy();
});
it('changing a reply recipient cannot send to an arbitrary address', async () => {
  await import('../../supabase/functions/send-email/index');
  expect((await handler(request({ lead_id: 'lead', reply_id: 'reply', to_email: 'wrong@fixture.invalid', subject: 'Hi', body: 'Hi' }))).status).toBe(404);
  expect(sendLeadEmail).not.toHaveBeenCalled(); expect(db.tables.email_replies[0].handled_at).toBeUndefined();
});
