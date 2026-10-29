import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PainPointEditor } from '../components/pipeline/PainPointEditor';
const choice = { pain_point: 'Cleaner cover', source: 'icp_list' as const, reason: 'The lead notes mention staff cover.' };
const props = { choice, points: ['Cleaner cover', 'Paperwork'], loading: false, error: null, onSave: async () => null };
it('shows the chosen angle, factual reason and labelled manual override controls', () => {
  const html = renderToStaticMarkup(createElement(PainPointEditor, props));
  expect(html).toContain('Pain point: Cleaner cover');
  expect(html).toContain('Chosen by AI because The lead notes mention staff cover.');
  expect(html).toContain('Your pain point');
  expect(html).toContain('Customer profile pain point');
  expect(html).toContain('Save manual choice');
});
it('labels manual choices separately and warns existing email text is unchanged', () => {
  const html = renderToStaticMarkup(createElement(PainPointEditor, { ...props, review: true, choice: { ...choice, source: 'manual' } }));
  expect(html).toContain('Chosen by you');
  expect(html).not.toContain('Chosen by AI because');
  expect(html).toContain('Saving a choice does not rewrite this email');
});
it('shows explicit loading and read error states instead of a stale editable choice', () => {
  expect(renderToStaticMarkup(createElement(PainPointEditor, { ...props, loading: true }))).toContain('role="status"');
  const html = renderToStaticMarkup(createElement(PainPointEditor, { ...props, error: 'Could not load pain point notes' }));
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('Save manual choice');
});
