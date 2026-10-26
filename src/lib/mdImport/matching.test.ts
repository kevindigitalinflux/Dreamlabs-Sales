import { expect, it } from 'vitest';
import { matchProfile, matchTemplate, resolveProfile, copyTemplateRows } from './matching';
import type { EmailTemplate } from '../../types';

it('matches profile names case-insensitively and resolves selected batch profiles', () => {
  expect(matchProfile('SCHOOLS', [{ id: 's', name: 'Schools' }])?.id).toBe('s');
  expect(resolveProfile('Offices', [], ['OFFICES'])).toBe('pending');
  expect(resolveProfile('Missing', [], [])).toBe('unresolved');
  expect(resolveProfile(null, [], [])).toBeNull();
});
it('matches templates only inside the same ICP', () => {
  const rows = [{ id: 'a', name: 'Intro', icp_id: 's' }, { id: 'b', name: 'INTRO', icp_id: null }];
  expect(matchTemplate('intro', 's', rows)?.id).toBe('a');
  expect(matchTemplate('intro', null, rows)?.id).toBe('b');
  expect(matchTemplate('intro', 'x', rows)).toBeUndefined();
});
const source: EmailTemplate = { id: 'shared', name: 'Intro', subject: 'Hi', body: 'Body', template_type: 'custom', is_default: true, created_by: null, created_at: '', category: 'Cold', icp_id: 's', links: [{ label: 'Visit', url: 'https://example.com' }], attachments: [{ name: 'Guide', path: 'org/file.pdf', type: 'application/pdf', size: 10 }] };
it('duplicates shared templates into current org and user with safe naming and attachment references', () => {
  const existing = [{ id: 'a', name: 'Copy of Intro', icp_id: 's' }, { id: 'b', name: 'COPY OF INTRO (2)', icp_id: 's' }];
  const [row] = copyTemplateRows([source], existing, 'org', 'user');
  expect(row).toEqual({ name: 'Copy of Intro (3)', subject: 'Hi', body: 'Body', template_type: 'custom', org_id: 'org', created_by: 'user', is_default: false, category: 'Cold', icp_id: 's', links: source.links, attachments: source.attachments });
});
it('previews set names in target ICP and handles collisions within the batch', () => {
  const rows = copyTemplateRows([source, { ...source, id: 'two' }], [], 'org', 'user', { id: 't', name: 'Offices' });
  expect(rows.map((r) => [r.name, r.icp_id])).toEqual([['Intro — Offices', 't'], ['Intro — Offices (2)', 't']]);
});
