import { expect, it, vi } from 'vitest';
import { applyImport } from './apply';
import { parseSetupFile } from './parser';

const parse = (type, body) => parseSetupFile(`---\ntype: ${type}\n---\n${body}`, 'x.md');
const files = () => [
  { id: 't', filename: 't.md', parsed: parse('email-templates', '# Intro\nsubject: Hi\nicp: Offices\n## Body\nHello'), selected: [true], replace: false },
  { id: 'p', filename: 'p.md', parsed: parse('icp-profiles', '# Offices\n## Summary\nCustomers'), selected: [true], replace: false },
  { id: 'c', filename: 'c.md', parsed: parse('company-context', 'New context'), selected: [true], append: false },
];
// In-memory PostgREST boundary: writes mutate real fake rows, reads return current state.
function database(failTable, silentUpdate = false) {
  const tables = { organizations: [{ id: 'org', company_context: 'Old' }], ideal_customer_profiles: [], email_templates: [] };
  const calls = [];
  const client = { from(table) {
    let action = 'read', payload, filters = [];
    const q = { select() { return q; }, insert(rows) { action = 'insert'; payload = rows; return q; }, update(row) { action = 'update'; payload = row; return q; }, eq(k, v) { filters.push([k, v]); return q; }, single() { return q; }, then(resolve) {
      const rows = tables[table].filter((r) => filters.every(([k, v]) => r[k] === v));
      if (action !== 'read') calls.push({ table, action, payload });
      if (table === failTable && action !== 'read') return Promise.resolve({ data: null, error: { message: 'Refused' } }).then(resolve);
      if (action === 'insert') { const added = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ ...r, id: `${table}-${tables[table].length + i}` })); tables[table].push(...added); return Promise.resolve({ data: added, error: null }).then(resolve); }
      if (action === 'update' && !silentUpdate) rows.forEach((r) => Object.assign(r, payload));
      return Promise.resolve({ data: action === 'update' && silentUpdate ? [] : rows, error: null }).then(resolve);
    } }; return q;
  } };
  return { client, tables, calls };
}
const options = { orgId: 'org', userId: 'user', isAdmin: true };
it('applies company then profiles then templates and attaches new profiles; rerun skips matches', async () => {
  const db = database();
  const batch = files();
  const result = await applyImport(db.client, batch, options);
  expect(result.error).toBeNull();
  expect(db.calls.map((c) => c.table)).toEqual(['organizations', 'ideal_customer_profiles', 'email_templates']);
  expect(db.tables.email_templates[0]).toMatchObject({ org_id: 'org', created_by: 'user', template_type: 'custom', is_default: false, icp_id: 'ideal_customer_profiles-0' });
  expect(result.saved).toHaveLength(3);
  db.calls.length = 0;
  const again = await applyImport(db.client, batch.slice(0, 2), options);
  expect(db.calls).toEqual([]);
  expect(again.skipped).toHaveLength(2);
});
it('replaces template fields but preserves default and attachments', async () => {
  const db = database();
  db.tables.ideal_customer_profiles.push({ id: 'p', org_id: 'org', name: 'OFFICES' });
  db.tables.email_templates.push({ id: 't', org_id: 'org', name: 'INTRO', icp_id: 'p', is_default: true, attachments: ['keep'], body: 'Old' });
  const batch = files().slice(0, 1).map((f) => ({ ...f, replace: true }));
  const r = await applyImport(db.client, batch, options);
  expect(r.error).toBeNull();
  expect(db.tables.email_templates[0]).toMatchObject({ body: 'Hello', is_default: true, attachments: ['keep'] });
  expect(db.calls[0].payload).not.toHaveProperty('is_default');
  expect(db.calls[0].payload).not.toHaveProperty('attachments');
});
it('reports exact saved and unsaved work and stops after partial failure', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const db = database('ideal_customer_profiles');
  const r = await applyImport(db.client, files(), options);
  expect(r.saved).toEqual(['Updated company context']);
  expect(r.notSaved).toEqual(['Profile: Offices', 'Template: Intro']);
  expect(r.error).toContain('Refused');
  expect(db.tables.email_templates).toEqual([]);
  expect(log).toHaveBeenCalled(); log.mockRestore();
});
it('detects silently refused updates and does not continue', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const r = await applyImport(database(undefined, true).client, files(), options);
  expect(r.error).toBeTruthy(); expect(r.saved).toEqual([]); log.mockRestore();
});
it('rejects nonadmins and malformed batches before writes', async () => {
  const db = database();
  expect((await applyImport(db.client, files(), { ...options, isAdmin: false })).error).toBeTruthy();
  const bad = files(); bad[0].parsed.errors.push({ line: 1, message: 'Bad' });
  expect((await applyImport(db.client, bad, options)).error).toBeTruthy();
  expect(db.calls).toEqual([]);
});
it('checks appended context length before any save', async () => {
  const db = database(); db.tables.organizations[0].company_context = 'x'.repeat(7995);
  const batch = files(); batch[2].append = true;
  const r = await applyImport(db.client, batch, options);
  expect(r.error).toContain('8,000'); expect(db.calls).toEqual([]);
});
it('replaces profiles by id, skips unticked rows, and imports unresolved ICP only when selected', async () => {
  const db = database(); db.tables.ideal_customer_profiles.push({ id: 'p', org_id: 'org', name: 'offices', summary: 'old' });
  const batch = files().slice(0, 2); batch[1].replace = true;
  batch[0].selected = [false];
  await applyImport(db.client, batch, options);
  expect(db.tables.ideal_customer_profiles[0].summary).toBe('Customers');
  expect(db.tables.email_templates).toEqual([]);
  const lone = files().slice(0, 1);
  const other = database(); await applyImport(other.client, lone, options);
  expect(other.tables.email_templates[0].icp_id).toBeNull();
});
