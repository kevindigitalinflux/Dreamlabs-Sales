import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ImportWizardView } from '../../components/mdImport/ImportWizardView';
import { prepareFiles } from './preview';
const snapshot = { context: '', profiles: [{ id: 'p', name: 'Offices' }], templates: [{ id: 't', name: 'Intro', icp_id: 'p' }], customKeys: [], packages: null, sequences: [] };
const source = (type: string, body: string) => ({ filename: `${type}.md`, text: `---\ntype: ${type}\n---\n${body}` });
const sources = [source('sequences', '# Follow-up\nicp: Offices\n## Steps\n1. template: Intro | wait_days: 0'), source('company-packages', '# Growth £90\nTimeline: two weeks')];
function render(files = prepareFiles(sources, snapshot.profiles, [])) {
  return renderToStaticMarkup(createElement(ImportWizardView, { files, snapshot, busy: false, reading: false, result: null, onFiles() {}, onChange() {}, onRemove() {}, onApply() {} }));
}
it('previews sequence step resolution and inactive state with package details explicitly unstored', () => {
  const html = render();
  expect(html).toContain('Inactive draft'); expect(html).toContain('Intro'); expect(html).toContain('organisation'); expect(html).toContain('0 days');
  expect(html).toContain('Growth £90'); expect(html).toContain('Timeline: two weeks'); expect(html).toContain('Details are shown for review only and are not stored');
  expect(html).toContain('currently uses the built-in list');
});
it('shows per-sequence unresolved references and blocks only selected invalid rows', () => {
  const files = prepareFiles([source('sequences', '# Broken\n## Steps\n1. template: Missing | wait_days: 0')], snapshot.profiles, []);
  const html = render(files); expect(html).toContain('template not found'); expect(html).toContain('role="alert"'); expect(html).toMatch(/disabled=""[^>]*>Import/);
});
it('warns about removed package labels without rewriting any lead', () => {
  const files = prepareFiles([sources[1]], [], []); files[0].replace = true;
  const html = renderToStaticMarkup(createElement(ImportWizardView, { files, snapshot: { ...snapshot, packages: ['Old offer'] }, busy: false, reading: false, result: null, onFiles() {}, onChange() {}, onRemove() {}, onApply() {} }));
  expect(html).toContain('Leads may still use removed labels'); expect(html).toContain('Old offer');
});
