import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/smtp', () => ({ sendMail: vi.fn() }));
import { loadSenderMailbox } from '../../supabase/functions/_shared/sendLeadEmail';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function database(reads, secrets = [{ data: 'dummy-password', error: null }]) {
  let read = 0, secret = 0;
  const service = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
    const result = reads[Math.min(read++, reads.length - 1)];
    if (result instanceof Error) throw result;
    return result;
  } }) }) }), rpc: async () => secrets[Math.min(secret++, secrets.length - 1)] };
  return { service, counts: () => ({ read, secret }) };
}
it('retries mailbox database errors rather than declaring the sender unverified', async () => {
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = database([{ data: null, error: { message: 'private-error' } }, { data: { is_verified: true }, error: null }]);
  const pending = loadSenderMailbox(db.service, 'sender');
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: true });
  expect(db.counts().read).toBe(2);
  expect(console.error).toHaveBeenCalled();
  expect(JSON.stringify(console.error.mock.calls)).not.toContain('private-error');
});
it('returns retryable 503 after bounded database failures', async () => {
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = database([{ data: null, error: { message: 'blip' } }]);
  const pending = loadSenderMailbox(db.service, 'sender'); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: false, status: 503 });
  expect(db.counts().read).toBe(3);
});
it('retries a rejected read and a Vault RPC error', async () => {
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = database([new Error('network'), { data: { is_verified: true }, error: null }], [{ data: null, error: { message: 'blip' } }, { data: 'dummy-password', error: null }]);
  const pending = loadSenderMailbox(db.service, 'sender'); await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: true });
  expect(db.counts()).toEqual({ read: 3, secret: 2 });
});
it.each([null, { is_verified: false }])('a genuine unverified mailbox fails safely without retry', async settings => {
  const db = database([{ data: settings, error: null }]);
  expect(await loadSenderMailbox(db.service, 'sender')).toMatchObject({ ok: false, status: 400 });
  expect(db.counts()).toEqual({ read: 1, secret: 0 });
});
it('a genuine missing password is a configuration error', async () => {
  const db = database([{ data: { is_verified: true }, error: null }], [{ data: null, error: null }]);
  expect(await loadSenderMailbox(db.service, 'sender')).toMatchObject({ ok: false, status: 400 });
  expect(db.counts().read).toBe(1);
});
