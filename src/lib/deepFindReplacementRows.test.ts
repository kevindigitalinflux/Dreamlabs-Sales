import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ReplacementRows } from '../components/deepfind/ReplacementRows';
import { unverifiedEmailSuggestions } from '../../supabase/functions/_shared/personEmailFinding';

it('shows the old address struck through, a primary Replace button, and others collapsed', () => {
  const evidence = { contact_id: 'c1', email: 'old@example.com' };
  const suggestions = unverifiedEmailSuggestions('Jane Smith', ['jane.smith@example.com', 'jane@example.com'], 'microsoft').map(s => ({ ...s, replaces_saved_email: evidence }));
  const html = renderToStaticMarkup(createElement(ReplacementRows, { suggestions, busy: false, onAction: () => {} }));
  expect(html).toContain('<s class');
  expect(html).toContain('old@example.com');
  expect(html).toContain('Does not exist');
  expect(html).toContain('Guess, unverified');
  expect(html).toContain('Most likely address');
  expect(html).toContain('Replace with jane.smith@example.com');
  expect(html).toContain('aria-label="Replace for Jane Smith: old@example.com with jane.smith@example.com"');
  expect(html).toContain('<details');
  expect(html).not.toContain(' open=');
  expect(html).toContain('Other possible formats for Jane Smith');
  expect(html.match(/Replace with /g)).toHaveLength(2);
  expect(html).toContain('Dismiss');
});
