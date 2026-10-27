import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MailboxStatusView } from '../components/settings/MailboxStatusView';
import { ReplyCountBadge } from '../components/emails/ReplyAlertParts';
const now = new Date('2026-10-27T12:00:00Z');
it('labels a verified but disconnected inbox and links to setup', () => {
  const html = renderToStaticMarkup(createElement(MailboxStatusView, { settings: { is_verified: true, imap_host: null }, now, warningOnly: true }));
  expect(html).toContain('Not connected'); expect(html).toContain('connect your inbox'); expect(html).toContain('/settings/email');
});
it('only warns verified senders, never shows raw error payloads', () => {
  expect(renderToStaticMarkup(createElement(MailboxStatusView, { settings: null, warningOnly: true, now }))).toBe('');
  const html = renderToStaticMarkup(createElement(MailboxStatusView, { settings: { is_verified: true, imap_host: 'host', last_imap_error: 'private' }, now }));
  expect(html).toContain('Problem'); expect(html).not.toContain('private');
});
it('recent working inboxes need no warning', () => {
  expect(renderToStaticMarkup(createElement(MailboxStatusView, { settings: { is_verified: true, imap_host: 'host', last_imap_ok_at: '2026-10-27T11:59:00Z' }, warningOnly: true, now }))).toBe('');
});
it('unread badge is explicit for screen readers and absent at zero', () => {
  expect(renderToStaticMarkup(createElement(ReplyCountBadge, { count: 2 }))).toContain('2 unread replies');
  expect(renderToStaticMarkup(createElement(ReplyCountBadge, { count: 0 }))).toBe('');
});
it('the composer warning is one short note pointing to inbox setup', () => {
  const html = renderToStaticMarkup(createElement(MailboxStatusView, { settings: { is_verified: true, imap_host: null }, warningOnly: true, compact: true, now }));
  expect(html).toContain('Replies to this email will not be picked up:');
  expect(html).not.toContain('Reply detection:');
});
