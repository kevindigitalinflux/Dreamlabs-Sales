import { expect, it } from 'vitest';
import { duplicateTemplates } from './duplicate';

const source = { id: 's', name: 'Intro', subject: 'Hi', body: 'Text', category: 'Cold', links: [], attachments: [], icp_id: 'p', is_default: true, created_by: null, template_type: 'custom', created_at: '' };
it('persists copies as the signed-in user and returns created templates for the editor', async () => {
  const db = [];
  const client = { from(table) {
    expect(table).toBe('email_templates');
    let payload;
    const q = { select() { return q; }, or(filter) { expect(filter).toBe('org_id.is.null,org_id.eq.org'); return q; }, insert(rows) { payload = rows; return q; }, then(resolve) {
      if (payload) { db.push(...payload.map((r) => ({ ...r, id: 'new' }))); return Promise.resolve({ data: db, error: null }).then(resolve); }
      return Promise.resolve({ data: [{ id: 'taken', name: 'Copy of Intro', icp_id: 'p' }], error: null }).then(resolve);
    } }; return q;
  } };
  const result = await duplicateTemplates(client, [source], 'org', 'user');
  expect(result[0]).toMatchObject({ id: 'new', name: 'Copy of Intro (2)', org_id: 'org', created_by: 'user', is_default: false });
});
it('rejects missing session and refused inserts rather than reporting a copy', async () => {
  await expect(duplicateTemplates({}, [source], '', '')).rejects.toThrow();
  const client = { from() { const q = { select() { return q; }, or() { return q; }, insert() { return q; }, then(resolve) { return Promise.resolve({ data: null, error: { message: 'Refused' } }).then(resolve); } }; return q; } };
  await expect(duplicateTemplates(client, [source], 'org', 'user')).rejects.toThrow('Refused');
});
