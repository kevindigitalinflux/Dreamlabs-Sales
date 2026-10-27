import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { processReplyMessage, pollMailbox } from '../../supabase/functions/_shared/replyPolling';
import { replyDatabase } from './replyTestDatabase';
let db, draft;
const mail = { messageId: '<reply@fixture.invalid>', inReplyTo: '<sent@fixture.invalid>', from: { address: 'lead@fixture.invalid' },
  subject: 'Re: Hello', text: 'Please remove me.\n> Old pitch', headers: [{ key: 'auto-submitted', value: 'no' }], attachments: [] };
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); draft = vi.fn(async () => 'draft');
  db = replyDatabase({ email_logs: [{ id: 'log', org_id: 'org', lead_id: 'lead', sent_by: 'sender', status: 'sent', message_id: '<sent@fixture.invalid>', to_email: 'lead@fixture.invalid', sequence_enrollment_id: null }],
    leads: [{ id: 'lead', org_id: 'org', stage: 'contacted', next_action_date: '2099-01-01', email: 'lead@fixture.invalid', last_contacted_at: 'old' }] });
});
afterEach(() => vi.restoreAllMocks());
const process = (message = mail, user = 'sender') => processReplyMessage(db.service, user, message, draft, new Date('2026-10-27T12:00:00Z'));
it('stores a real one-off reply and effects once, with safe opt-out suggestion only', async () => {
  expect((await process()).matched).toBe(1);
  expect(db.tables.email_replies[0]).toMatchObject({ body: mail.text, preview: 'Please remove me.', opt_out_suspected: true });
  expect(db.tables.leads[0]).toMatchObject({ stage: 'replied', next_action_date: '2026-10-27', last_contacted_at: 'old' });
  expect(db.tables.leads[0].opted_out).toBeUndefined();
  expect(db.tables.reply_notifications.map(n => n.user_id)).toEqual(['sender', 'admin']);
  await process();
  expect(db.tables.email_replies).toHaveLength(1);
  expect(db.tables.reply_notifications).toHaveLength(2);
  expect(db.tables.lead_notes).toHaveLength(1);
  expect(draft).not.toHaveBeenCalled();
});
it.each([
  [{ ...mail, from: { address: 'forged@fixture.invalid' } }, 'sender'],
  [mail, 'other-mailbox'], [{ ...mail, inReplyTo: '<unknown@fixture.invalid>' }, 'sender'],
])('forged/unmatched mail cannot move or store any lead data', async (message, user) => {
  expect((await process(message, user)).matched).toBe(0);
  expect(db.writes).toEqual([]);
});
it('matches a References ancestor and pauses only an existing linked enrollment', async () => {
  db.tables.email_logs[0].sequence_enrollment_id = 'enr';
  db.tables.sequence_enrollments.push({ id: 'enr', lead_id: 'lead', status: 'active', sequence: { auto_draft_on_reply: true, icp_id: null } });
  await process({ ...mail, inReplyTo: '<newer@fixture.invalid>', references: '<sent@fixture.invalid>' });
  expect(db.tables.sequence_enrollments[0].status).toBe('paused');
  expect(draft).toHaveBeenCalledOnce();
});
it('a note failure does not prevent alerts or optional auto-drafting and never logs reply payloads', async () => {
  db.failures.add('lead_notes:insert');
  await process();
  expect(db.tables.reply_notifications).toHaveLength(2);
  expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/remove me|fixture.invalid|private-payload/);
});
it('automatic mail never becomes a reply, note or alert', async () => {
  expect((await process({ ...mail, headers: [{ key: 'auto-submitted', value: 'auto-replied' }] })).automatic).toBe(1);
  expect(db.writes).toEqual([]);
});
it('save failure stops effects so the watermark can retry', async () => {
  db.failures.add('email_replies:upsert');
  await expect(process()).rejects.toThrow();
  expect(db.writes).toEqual([]);
});
it('retains the complete readable text of an admitted message while keeping its preview short', async () => {
  const body = 'A'.repeat(100_100);
  await process({ ...mail, text: body });
  expect(db.tables.email_replies[0].body).toBe(body);
  expect(db.tables.email_replies[0].preview).toHaveLength(200);
});
function inbox(messages) {
  return { highestUid: 101, connect: vi.fn(async () => {}), lock: vi.fn(async () => ({ release: vi.fn() })), logout: vi.fn(async () => {}),
    fetch: vi.fn(async function* () { for (const row of messages) yield row; }) };
}
it('first mailbox check baselines without fetching historical messages', async () => {
  const client = inbox([]); db.tables.user_email_settings.push({ user_id: 'sender' });
  await pollMailbox(db.service, { user_id: 'sender', last_imap_check_uid: null }, client, async () => mail, draft, Date.now() + 60_000);
  expect(client.fetch).not.toHaveBeenCalled();
  expect(db.tables.user_email_settings[0]).toMatchObject({ last_imap_check_uid: 101, last_imap_error: null });
});
it('fetches by bounded UID range, not date, and records mailbox success', async () => {
  const client = inbox([{ uid: 101, source: new Uint8Array([1]) }]); db.tables.user_email_settings.push({ user_id: 'sender' });
  await pollMailbox(db.service, { user_id: 'sender', last_imap_check_uid: 100 }, client, async () => mail, draft, Date.now() + 60_000);
  expect(client.fetch).toHaveBeenCalledWith('101:101');
  expect(db.tables.user_email_settings[0].last_imap_ok_at).toBeTruthy();
});
it('mail that arrived before the release cutoff advances the watermark silently without parsing or alerts', async () => {
  const client = inbox([{ uid: 101, source: new Uint8Array([1]), internalDate: new Date('2026-10-26T12:00:00Z') }]);
  const parse = vi.fn(async () => mail); db.tables.user_email_settings.push({ user_id: 'sender' });
  await pollMailbox(db.service, { user_id: 'sender', last_imap_check_uid: 100, reply_alerts_after: '2026-10-27T00:00:00Z' }, client, parse, draft, Date.now() + 60_000);
  expect(parse).not.toHaveBeenCalled(); expect(db.tables.email_replies).toEqual([]);
  expect(db.tables.user_email_settings[0].last_imap_check_uid).toBe(101);
});
it('a parse failure leaves the failed UID for a later tick and stores only a safe health code', async () => {
  const client = inbox([{ uid: 101, source: new Uint8Array([1]) }]); db.tables.user_email_settings.push({ user_id: 'sender', last_imap_check_uid: 100 });
  await pollMailbox(db.service, { user_id: 'sender', last_imap_check_uid: 100 }, client, async () => { throw new Error('private-mailbox-text'); }, draft, Date.now() + 60_000);
  expect(db.tables.user_email_settings[0]).toMatchObject({ last_imap_check_uid: 100, last_imap_error: 'check_failed' });
});
