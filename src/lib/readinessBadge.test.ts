import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ReadinessBadge } from '../components/pipeline/ReadinessBadge';

it('exposes the status and missing reason without relying on colour or hover', () => {
  const html = renderToStaticMarkup(createElement(ReadinessBadge, { readiness: 'almost', missing: ['verified_email'] }));
  expect(html).toContain('Almost: no verified email');
  expect(html).not.toContain('tabindex');
});
it('renders an explicit unchecked label for old leads', () => {
  expect(renderToStaticMarkup(createElement(ReadinessBadge, {}))).toContain('Not checked');
});
