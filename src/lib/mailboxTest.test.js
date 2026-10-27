import { afterEach, expect, it, vi } from 'vitest';
import { testMailboxConnection } from '../../supabase/functions/_shared/mailboxTest';
import { replyDatabase } from './replyTestDatabase';
afterEach(() => vi.restoreAllMocks());
it('tests only the caller inbox and sets a quiet baseline without fetching messages', async () => {
  const db = replyDatabase({ user_email_settings: [{ user_id: 'user', provider: 'gmail', imap_host: null, imap_port: null, smtp_user: 'local@example.invalid', last_imap_check_uid: null }] });
  const inbox = { highestUid: 50, connect: vi.fn(async () => {}), lock: vi.fn(async () => ({ release: vi.fn() })), logout: vi.fn(async () => {}), fetch: vi.fn() };
  const create = vi.fn(() => inbox);
  expect(await testMailboxConnection(db.service, 'user', create)).toMatchObject({ ok: true });
  expect(create).toHaveBeenCalledWith('imap.gmail.com', 993, 'local@example.invalid', 'dummy-local-password');
  expect(inbox.fetch).not.toHaveBeenCalled();
  expect(db.tables.user_email_settings[0]).toMatchObject({ imap_host: 'imap.gmail.com', last_imap_check_uid: 50, last_imap_error: null });
});
it('returns a fixed wrong-password message and health code without exposing server text', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = replyDatabase({ user_email_settings: [{ user_id: 'user', provider: 'gmail', smtp_user: 'local@example.invalid' }] });
  const create = () => ({ connect: async () => { throw { authenticationFailed: true, message: 'secret-server-payload' }; }, logout: async () => {} });
  const result = await testMailboxConnection(db.service, 'user', create);
  expect(result).toMatchObject({ ok: false, code: 'wrong_password' });
  expect(JSON.stringify(result)).not.toContain('secret-server-payload');
  expect(JSON.stringify(console.error.mock.calls)).not.toContain('secret-server-payload');
});
