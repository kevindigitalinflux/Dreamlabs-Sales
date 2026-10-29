import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SelectedLeadsPicker } from '../components/autopilot/SelectedLeadsPicker';
import { groupSelectableLeads } from './selectableLeads';
import { emptyPickerFilters } from './autopilotPicker';
const now = new Date('2026-07-07T10:00:00Z');
const leads = [{ id: 'a', pipeline_id: 'p', business_name: 'Acme', stage: 'new_lead', last_contacted_at: null, email: null },
  { id: 'b', pipeline_id: 'q', business_name: 'Blocked business', stage: 'replied', last_contacted_at: null, email: null }];
const byPipeline = groupSelectableLeads([{ id: 'p', name: 'One' }, { id: 'q', name: 'Two' }], leads, new Map(), new Set(), new Date('2026-07-07T23:59:59Z'), now);
const data = { hasOrg: true, loading: false, error: null, byPipeline, pipelines: [{ id: 'p', name: 'One' }, { id: 'q', name: 'Two' }] };
function html(props = {}) {
  return renderToStaticMarkup(createElement(SelectedLeadsPicker, { value: new Set(['a', 'b']), onChange() {}, count: 1,
    data, filters: emptyPickerFilters(), onFiltersChange() {}, now, timeZone: 'Europe/London', ...props }));
}
it('offers labelled search, all pipelines, selection and eligibility controls', () => {
  const markup = html();
  expect(markup).toContain('Search company, owner or email');
  expect(markup).toContain('All pipelines');
  expect(markup).toContain('Hide leads I can&#x27;t pick');
  expect(markup).toContain('Select all matching (1)');
  expect(markup).toContain('2 selected in 2 pipelines');
});
it('keeps disabled rows readable with a reason linked to their checkbox', () => {
  const markup = html();
  expect(markup).toContain('Blocked business');
  expect(markup).toMatch(/<input[^>]*aria-describedby="[^"]+"[^>]*disabled/);
  expect(markup).toContain('Replied');
  expect(markup).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls=/);
});
it('shows no-match and hidden-selection hints without erasing the selected count', () => {
  const markup = html({ filters: { ...emptyPickerFilters(), pipelineIds: [] } });
  expect(markup).toContain('No leads match these filters');
  expect(markup).toContain('2 selected leads are hidden by your filters');
  expect(markup).toContain('2 selected in 2 pipelines');
});
it('caps each initial pipeline render and exposes the remaining count', () => {
  const many = Array.from({ length: 240 }, (_, i) => ({ ...leads[0], id: `lead-${i}`, business_name: `Business ${i}` }));
  const big = groupSelectableLeads([{ id: 'p', name: 'One' }], many, new Map(), new Set(), new Date('2026-07-07T23:59:59Z'), now);
  const markup = html({ data: { ...data, byPipeline: big } });
  expect((markup.match(/Ready to pick/g) ?? []).length).toBe(100);
  expect(markup).toContain('Show more (140 remaining)');
  expect(markup).toContain('Select all matching (240)');
});
it('exposes load and error states without rendering stale picker rows', () => {
  expect(html({ data: { ...data, loading: true } })).toContain('role="status"');
  const failed = html({ data: { ...data, error: 'Local fixture failure' } });
  expect(failed).toContain('role="alert"');
  expect(failed).not.toContain('Blocked business');
});
