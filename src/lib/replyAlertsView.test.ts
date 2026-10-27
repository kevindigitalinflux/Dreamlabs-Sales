import { expect, it } from 'vitest';
import { replyPopups, unreadReplies, orderReplies, replyTab } from './replyAlertsView';
const alert = { id: 'n', reply_id: 'r', read_at: null, reply: { preview: 'Tuesday works.', lead: { business_name: 'Acme' } } };
it('counts unread replies once and prefers the Replies tab only without an explicit tab', () => {
  expect(unreadReplies([alert, { ...alert, id: 'duplicate' }, { ...alert, reply_id: 'read', read_at: 'now' }])).toBe(1);
  expect(replyTab(null, 1)).toBe('replies');
  expect(replyTab('templates', 1)).toBe('templates');
});
it('orders unread first and retains chronological newest-first order within groups', () => {
  const rows = [{ id: 'read', received_at: '2026-10-27' }, { id: 'unread', received_at: '2026-10-26' }];
  expect(orderReplies(rows, new Set(['unread'])).map(r => r.id)).toEqual(['unread', 'read']);
});
it('popups use a silent first-load baseline, the existing opt-in and background-only delivery', () => {
  const base = { previous: null, next: [alert], hidden: true, enabled: true, permission: 'granted' };
  expect(replyPopups(base)).toEqual([]);
  expect(replyPopups({ ...base, previous: [], hidden: false })).toEqual([]);
  expect(replyPopups({ ...base, previous: [], enabled: false })).toEqual([]);
  expect(replyPopups({ ...base, previous: [] })).toEqual([{ key: 'r', title: 'Reply: Acme', body: 'Tuesday works.', href: '/emails?tab=replies&reply=r' }]);
  expect(replyPopups({ ...base, previous: [alert] })).toEqual([]);
});
