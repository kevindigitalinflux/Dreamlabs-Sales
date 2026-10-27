import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ count: 2 }));
vi.mock('../hooks/useReplyAlerts', () => ({ useReplyAlerts: () => ({ count: state.count, alerts: [{ reply_id: 'reply', reply: { preview: 'First line\nPrivate remaining text', lead: { business_name: 'Acme' } } }] }) }));
import { ReplyBanner } from '../components/emails/ReplyAlertParts';
it('links the readable count/banner to Emails Replies and shows only the first line', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ReplyBanner)));
  expect(html).toContain('2 new replies'); expect(html).toContain('/emails?tab=replies');
  expect(html).toContain('First line'); expect(html).not.toContain('Private remaining text'); expect(html).toContain('Dismiss');
  state.count = 0;
  expect(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ReplyBanner)))).toBe('');
});
