import { describe, expect, it } from 'vitest';
import { automaticMail, replyPreview, htmlReplyText, optOutSuspected, replyLeadPatch, replyRecipients, threadingHeaders, londonDate, mailboxState, imapErrorCode, mailboxDue, uidWindow } from '../../supabase/functions/_shared/replyRules';
import { isSequenceSystemNote } from '../../supabase/functions/_shared/sequenceRecipients';

describe('real reply admission', () => {
  it.each([
    [['Auto-Submitted', 'auto-replied']], [['Auto-Submitted', 'auto-generated']], [['X-Autoreply', 'yes']],
    [['X-Autorespond', 'yes']], [['Precedence', 'bulk']], [['Precedence', 'auto_reply']], [['Precedence', 'junk']],
    [['X-Auto-Response-Suppress', 'All']], [['Content-Type', 'multipart/report; report-type=delivery-status']],
  ])('rejects automatic headers: %j', header => expect(automaticMail([header], 'Hello', 'local@example.invalid')).not.toBeNull());
  it.each(['Out of office', 'Automatic reply: Hello', 'Auto-reply', 'Autoreply', 'Away from the office'])('rejects automatic subject %s', subject => {
    expect(automaticMail([], subject, 'a@example.invalid')).toBe('automatic');
  });
  it('accepts a normal real-looking header set and Auto-Submitted no', () => {
    expect(automaticMail([['Auto-Submitted', 'no'], ['Content-Type', 'text/plain; charset=utf-8'], ['Precedence', 'normal']], 'Re: Hello', 'a@example.invalid')).toBeNull();
  });
  it('retains bounce rules and distinguishes bounces from other automatic mail', () => {
    expect(automaticMail([], 'Delivery Status Notification (Failure)', 'mailer-daemon@example.invalid')).toBe('bounce');
    expect(automaticMail([], 'Undeliverable: Hello', 'postmaster@example.invalid')).toBe('bounce');
  });
});
it('strips quoted history and bounds the first-line preview', () => {
  expect(replyPreview('Thanks, let’s talk.\nTuesday suits me.\n\nOn Mon, Kevin wrote:\nOld pitch')).toBe('Thanks, let’s talk.');
  expect(replyPreview('Hello\n> Old message')).toBe('Hello');
  expect(replyPreview('x'.repeat(500))).toHaveLength(200);
});
it('HTML fallback removes script/style and decodes text without rendering markup', () => {
  expect(htmlReplyText('<style>bad</style><p>Hello &amp; thanks</p><script>bad</script><div>Tuesday works.</div>')).toBe('Hello & thanks\nTuesday works.');
});
it.each(['Please remove me from your list', 'Stop emailing me', 'Unsubscribe', 'Do not contact me again'])('flags opt-out words without performing an opt-out: %s', text => expect(optOutSuspected(text)).toBe(true));
it('quoted opt-out words do not flag the new answer', () => expect(optOutSuspected('Tuesday is good.\n> To unsubscribe, reply remove me')).toBe(false));
it('reply system notes never enter AI context or count as human research context', () => expect(isSequenceSystemNote('Reply received: Thanks')).toBe(true));
it.each(['new_lead', 'contacted'])('moves %s forward without changing last-contacted', stage => {
  expect(replyLeadPatch(stage, '2026-11-01', new Date('2026-10-27T12:00:00Z'))).toEqual({ stage: 'replied', next_action_date: '2026-10-27' });
});
it.each(['replied', 'audit_booked', 'proposal_sent', 'negotiating', 'won', 'lost', 'not_now_nurture'])('never regresses %s or postpones overdue follow-up', stage => {
  expect(replyLeadPatch(stage, '2026-10-01', new Date('2026-10-27T12:00:00Z'))).toEqual({});
});
it('uses the London date across the summer midnight boundary', () => expect(londonDate(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02'));
it('notifies visible current sender/admins once and nobody else', () => {
  expect(replyRecipients('sender', [
    { user_id: 'sender', role: 'admin', can_view: true }, { user_id: 'admin', role: 'admin', can_view: true },
    { user_id: 'admin', role: 'admin', can_view: true }, { user_id: 'hidden', role: 'admin', can_view: false },
    { user_id: 'rep', role: 'contractor', can_view: true },
  ])).toEqual(['sender', 'admin']);
  expect(replyRecipients('departed', [{ user_id: 'rep', role: 'contractor', can_view: true }])).toEqual([]);
});
it('threads under the reply and deduplicates references while rejecting header injection', () => {
  expect(threadingHeaders('<reply@example.invalid>', '<original@example.invalid> <reply@example.invalid>')).toEqual({ 'In-Reply-To': '<reply@example.invalid>', References: '<original@example.invalid> <reply@example.invalid>' });
  expect(() => threadingHeaders('<reply@example.invalid>\r\nBcc: bad', '')).toThrow();
  expect(() => threadingHeaders('not a message id', '')).toThrow();
});
it('reports disconnected, recent working and safe problem states', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  expect(mailboxState(null, now)).toBe('not_connected');
  expect(mailboxState({ imap_host: null }, now)).toBe('not_connected');
  expect(mailboxState({ imap_host: 'imap.example.invalid', last_imap_ok_at: '2026-10-27T11:58:00Z' }, now)).toBe('working');
  expect(mailboxState({ imap_host: 'imap.example.invalid', last_imap_ok_at: '2026-10-01' }, now)).toBe('not_connected');
  expect(mailboxState({ imap_host: 'imap.example.invalid', last_imap_error: 'wrong_password' }, now)).toBe('problem');
});
it('maps IMAP errors to fixed codes without exposing payloads', () => {
  expect(imapErrorCode({ authenticationFailed: true, message: 'private' })).toBe('wrong_password');
  expect(imapErrorCode({ message: 'IMAP access is disabled for user secret@example.invalid' })).toBe('imap_disabled');
  expect(imapErrorCode(new Error('connect ECONNREFUSED secret'))).toBe('cannot_connect');
});
it('bounds UID scans, baselines new mailboxes and skips recently checked mailboxes', () => {
  expect(uidWindow(null, 90)).toEqual({ baseline: true, from: 90, to: 90 });
  expect(uidWindow(90, 90)).toBeNull();
  expect(uidWindow(90, 400)).toEqual({ baseline: false, from: 91, to: 140 });
  expect(mailboxDue('2026-10-27T11:58:00Z', new Date('2026-10-27T12:00:00Z'))).toBe(false);
});
