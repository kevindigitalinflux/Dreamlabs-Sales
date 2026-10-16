import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SuggestionRows } from '../components/deepfind/SuggestionRows';

it('renders both actions, role mailbox label, and wrapping email text', () => {
  const html = renderToStaticMarkup(createElement(SuggestionRows, { suggestions: [{ name: 'Company contact', value: 'privacy@example.com' }], busy: false, onAction: () => {} }));
  expect(html).toContain('Add to lead');
  expect(html).toContain('Dismiss');
  expect(html).toContain('Role mailbox, not useful for outreach');
  expect(html).toContain('break-all');
});
it('disables actions while saving and describes named people without an email', () => {
  const html = renderToStaticMarkup(createElement(SuggestionRows, { suggestions: [{ name: 'Jane Smith', role: 'Director' }], busy: true, onAction: () => {} }));
  expect(html).toContain('Jane Smith');
  expect(html).toContain('Director');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});
