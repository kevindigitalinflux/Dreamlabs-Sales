import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SuggestionRows } from '../components/deepfind/SuggestionRows';
import { unverifiedEmailSuggestions } from '../../supabase/functions/_shared/personEmailFinding';

it('renders both actions, role mailbox label, and wrapping email text', () => {
  const html = renderToStaticMarkup(createElement(SuggestionRows, { suggestions: [{ name: 'Company contact', value: 'privacy@example.com' }], busy: false, onAction: () => {} }));
  expect(html).toContain('Add to lead');
  expect(html).toContain('Dismiss');
  expect(html).toContain('Role mailbox, not useful for outreach');
  expect(html).toContain('[overflow-wrap:anywhere]');
  expect(html).not.toContain('break-all');
  expect(html).toContain('aria-label="Add to lead: Company contact, privacy@example.com"');
  expect(html).toContain('aria-label="Dismiss: Company contact, privacy@example.com"');
});

it('keeps one most likely address visible and alternatives collapsed with the same review actions', () => {
  const suggestions = unverifiedEmailSuggestions('Jane Smith', ['jane.smith@example.com', 'jane@example.com'], 'microsoft');
  const html = renderToStaticMarkup(createElement(SuggestionRows, { suggestions, busy: false, onAction: () => {} }));
  expect(html).toContain('Most likely address');
  expect(html).toContain('<details');
  expect(html).toContain('Other possible formats');
  expect(html).not.toContain(' open=');
  expect(html.match(/Add to lead<\/button>/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Add to lead: Jane Smith, jane.smith@example.com"');
  expect(html).toContain('aria-label="Add to lead: Jane Smith, jane@example.com"');
  expect(html).toContain('aria-label="Dismiss: Jane Smith, jane@example.com"');
  expect(html).toContain('[overflow-wrap:anywhere]');
  expect(html).not.toContain('break-all');
  const detailsStart = html.indexOf('<details');
  expect(html.indexOf('aria-label="Add to lead: Jane Smith, jane.smith@example.com"')).toBeLessThan(detailsStart);
  expect(html.indexOf('aria-label="Add to lead: Jane Smith, jane@example.com"')).toBeGreaterThan(detailsStart);
});
it('disables actions while saving and describes named people without an email', () => {
  const html = renderToStaticMarkup(createElement(SuggestionRows, { suggestions: [{ name: 'Jane Smith', role: 'Director' }], busy: true, onAction: () => {} }));
  expect(html).toContain('Jane Smith');
  expect(html).toContain('Director');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});

it('links https LinkedIn suggestions safely and rejects unsafe schemes', () => {
  const render = (value: string) => renderToStaticMarkup(createElement(SuggestionRows, { suggestions: [{ name: 'Jane', field: 'linkedin_url', value }], busy: false, onAction: () => {} }));
  const html = render('https://www.linkedin.com/in/jane');
  expect(html).toContain('href="https://www.linkedin.com/in/jane"');
  expect(html).toContain('rel="noreferrer noopener"');
  expect(html).toContain('target="_blank"');
  for (const value of ['javascript:alert(1)', 'http://www.linkedin.com/in/jane']) expect(render(value)).not.toContain('<a ');
});

it('renders the lead result headings at the level it is given', async () => {
  const { Heading } = await import('../components/deepfind/Heading');
  expect(renderToStaticMarkup(createElement(Heading, { level: 5, children: 'x' }))).toBe('<h5>x</h5>');
  expect(renderToStaticMarkup(createElement(Heading, { level: 9, children: 'x' }))).toBe('<h6>x</h6>');
});
