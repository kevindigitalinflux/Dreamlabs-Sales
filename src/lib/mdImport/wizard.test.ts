import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ImportWizardView } from '../../components/mdImport/ImportWizardView';
import { prepareFiles } from './preview';

const base = { files: [], snapshot: { context: '', profiles: [], templates: [], customKeys: [] }, busy: false, reading: false, result: null, onFiles: () => {}, onChange: () => {}, onRemove: () => {}, onApply: () => {} };
function render(props = {}) { return renderToStaticMarkup(createElement(ImportWizardView, { ...base, ...props })); }
it('shows an accessible empty state and disables importing', () => {
  const html = render();
  expect(html).toContain('Choose files'); expect(html).toMatch(/disabled=""[^>]*>Import/);
  expect(html).toContain('Drop .md files');
});
it('shows blocking file errors with removal and a disabled import action', () => {
  const files = prepareFiles([{ filename: 'bad.md', text: 'invalid' }], [], []);
  const html = render({ files });
  expect(html).toContain('bad.md'); expect(html).toContain('role="alert"'); expect(html).toContain('line 1');
  expect(html).toContain('Remove bad.md'); expect(html).toMatch(/disabled=""[^>]*>Import/);
});
it('previews literal text and enables a valid selection', () => {
  const files = prepareFiles([{ filename: 'c.md', text: '---\ntype: company-context\n---\nA & B' }], [], []);
  const html = render({ files });
  expect(html).toContain('A &amp; B'); expect(html).toContain('Replace'); expect(html).not.toMatch(/disabled=""[^>]*>Import/);
});
it('shows unresolved ICP warning and requires an explicit checkbox', () => {
  const files = prepareFiles([{ filename: 't.md', text: '---\ntype: email-templates\nicp: Unknown\n---\n# Intro\nsubject: Hi\n## Body\nHello' }], [], []);
  const html = render({ files });
  expect(html).toContain('ICP not found'); expect(html).toContain('Import without an ICP');
  expect(html).not.toContain('checked=""');
});
it('announces exact success and skipped rows', () => {
  const html = render({ result: { saved: ['Created Template: Intro'], skipped: ['Profile: Schools'], notSaved: [], error: null } });
  expect(html).toContain('role="status"'); expect(html).toContain('Created Template: Intro'); expect(html).toContain('Skipped');
});
it('announces partial failure, saved rows and unsaved rows without offering a silent retry', () => {
  const html = render({ result: { saved: ['Updated company context'], skipped: [], notSaved: ['Template: Intro'], error: 'Refused' } });
  expect(html).toContain('role="alert"'); expect(html).toContain('Refused'); expect(html).toContain('Updated company context');
  expect(html).toContain('Not saved'); expect(html).toContain('Template: Intro'); expect(html).not.toContain('>Import</button>');
});
