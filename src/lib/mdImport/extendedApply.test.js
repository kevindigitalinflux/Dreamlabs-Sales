import { expect, it, vi } from 'vitest';
import { prepareFiles } from './preview';
import { applyImport } from './apply';
import { resolveSequence } from './extendedMatching';
import { readFileSync } from 'node:fs';
const source = (type, body) => ({ filename: `${type}.md`, text: `---\ntype: ${type}\n---\n${body}` });
const seq = source('sequences', '# Follow-up\nicp: Offices\n## Steps\n1. template: Intro | wait_days: 0\n2. template: Reminder | wait_days: 4');
const packages = source('company-packages', '# Growth $250\nDetails\n# Support £90');
function database() {
  const tables = { organizations: [{ id: 'org', company_context: '', custom_packages: null }], ideal_customer_profiles: [{ id: 'p', org_id: 'org', name: 'Offices' }],
    email_templates: [{ id: 't', org_id: 'org', name: 'INTRO', icp_id: 'p' }, { id: 'r', org_id: 'org', name: 'Reminder', icp_id: 'p' }], email_sequences: [], leads: [{ package_tier: 'Old' }] };
  const writes = [];
  const client = { from(table) {
    let action = 'read', payload, filters = [];
    const q = { select() { return q; }, insert(rows) { action = 'insert'; payload = rows; return q; }, update(row) { action = 'update'; payload = row; return q; }, eq(key, value) { filters.push([key, value]); return q; },
      then(resolve) {
        let rows = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
        if (action !== 'read') writes.push({ table, action, payload });
        if (action === 'insert') { rows = (Array.isArray(payload) ? payload : [payload]).map((row, i) => ({ ...row, id: `${table}-${tables[table].length + i}` })); tables[table].push(...rows); }
        if (action === 'update') rows.forEach(row => Object.assign(row, payload));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      } }; return q;
  } };
  return { tables, writes, client };
}
const options = { orgId: 'org', userId: 'user', isAdmin: true };
it('matches exact names case-insensitively, batch first, organisation second, and refuses missing or ambiguous templates', () => {
  const files = prepareFiles([seq, source('email-templates', '# Intro\nicp: Offices\nsubject: Hi\n## Body\nHello')], [{ id: 'p', name: 'Offices' }], []);
  const snapshot = { profiles: [{ id: 'p', name: 'Offices' }], templates: [{ id: 'old', name: 'intro', icp_id: 'p' }, { id: 'r', name: 'Reminder', icp_id: 'p' }] };
  expect(resolveSequence(files[0].parsed.data[0], files, snapshot).steps.map(step => step.source)).toEqual(['batch', 'organisation']);
  expect(resolveSequence(files[0].parsed.data[0], files.slice(0, 1), { ...snapshot, templates: [] }).errors.join(' ')).toContain('Intro');
  expect(resolveSequence(files[0].parsed.data[0], files.slice(0, 1), { ...snapshot, templates: [...snapshot.templates, { id: 'dup', name: 'intro', icp_id: null }] }).errors.join(' ')).toContain('ambiguous');
});
it('creates a complete inactive sequence with resolved template IDs; add-only rerun writes nothing', async () => {
  const db = database(); const files = prepareFiles([seq], db.tables.ideal_customer_profiles, []);
  const result = await applyImport(db.client, files, options);
  expect(result.error).toBeNull(); expect(db.tables.email_sequences).toHaveLength(1);
  expect(db.tables.email_sequences[0]).toMatchObject({ is_active: false, is_default: false, org_id: 'org', icp_id: 'p', steps: [
    { template_id: 't', template_type: 'custom', delay_days: 0 }, { template_id: 'r', template_type: 'custom', delay_days: 4 } ] });
  db.writes.length = 0; await applyImport(db.client, files, options); expect(db.writes).toEqual([]);
});
it('replace changes only the named sequence and leaves it inactive', async () => {
  const db = database(); db.tables.email_sequences.push({ id: 's', org_id: 'org', name: 'FOLLOW-UP', steps: [], is_active: true }, { id: 'other', org_id: 'org', name: 'Other', steps: ['keep'] });
  const files = prepareFiles([seq], db.tables.ideal_customer_profiles, []); files[0].replace = true;
  await applyImport(db.client, files, options);
  expect(db.tables.email_sequences[0].steps).toHaveLength(2); expect(db.tables.email_sequences[0].is_active).toBe(false);
  expect(db.tables.email_sequences[1].steps).toEqual(['keep']);
  db.tables.email_sequences[0].steps = db.tables.email_sequences[0].steps.map(step => ({ subject_override: step.subject_override, delay_days: step.delay_days, template_type: step.template_type, template_id: step.template_id }));
  db.writes.length = 0; await applyImport(db.client, files, options); expect(db.writes).toEqual([]);
});
it('reports partial sequence failure without a half-built row', async () => {
  const db = database(); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const files = prepareFiles([source('sequences', seq.text.split('---\n')[2] + '\n# Broken\n## Steps\n1. template: Missing | wait_days: 0')], db.tables.ideal_customer_profiles, []);
    const result = await applyImport(db.client, files, options);
    expect(result.error).toContain('Missing'); expect(result.saved).toContain('Created Sequence: Follow-up');
    expect(db.tables.email_sequences).toHaveLength(1); expect(result.notSaved).toContain('Sequence: Broken');
  } finally { log.mockRestore(); }
});
it('appends packages, handles NULL, replaces exactly, skips reruns and never changes leads', async () => {
  const db = database(); const files = prepareFiles([packages], [], []);
  expect((await applyImport(db.client, files, options)).error).toBeNull(); expect(db.tables.organizations[0].custom_packages).toEqual(['Growth $250', 'Support £90']);
  db.writes.length = 0; await applyImport(db.client, files, options); expect(db.writes).toEqual([]);
  db.tables.organizations[0].custom_packages = ['Existing', 'growth $250'];
  await applyImport(db.client, files, options); expect(db.tables.organizations[0].custom_packages).toEqual(['Existing', 'growth $250', 'Support £90']);
  files[0].replace = true; await applyImport(db.client, files, options); expect(db.tables.organizations[0].custom_packages).toEqual(['Growth $250', 'Support £90']);
  expect(db.tables.leads).toEqual([{ package_tier: 'Old' }]); expect(db.writes.some(call => call.table === 'leads')).toBe(false);
});
it('refuses both new import types for nonadmins before any read/write', async () => {
  const client = { from() { throw Error('Must not access data'); } };
  expect((await applyImport(client, prepareFiles([packages, seq], [], []), { ...options, isAdmin: false })).error).toContain('admin');
});
it('refreshes the package cache after a confirmed save and leaves it unchanged on rerun', async () => {
  const db = database(); const changed = vi.fn(); const files = prepareFiles([packages], [], []);
  await applyImport(db.client, files, { ...options, onPackagesChanged: changed });
  expect(changed).toHaveBeenCalledExactlyOnceWith(['Growth $250', 'Support £90']);
  await applyImport(db.client, files, { ...options, onPackagesChanged: changed }); expect(changed).toHaveBeenCalledTimes(1);
});
it('does not insert any partial sequence when the single row write is refused', async () => {
  const db = database(); const from = db.client.from; const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let attempts = 0;
  db.client.from = table => {
    if (table !== 'email_sequences') return from(table);
    let insert = false;
    return { select() { return this; }, eq() { return this; }, insert() { insert = true; attempts++; return this; },
      then(resolve) { return Promise.resolve(insert ? { data: null, error: { message: 'Refused' } } : { data: [], error: null }).then(resolve); } };
  };
  try {
    const result = await applyImport(db.client, prepareFiles([seq], db.tables.ideal_customer_profiles, []), options);
    expect(result.error).toContain('Refused'); expect(db.tables.email_sequences).toEqual([]); expect(result.notSaved).toContain('Sequence: Follow-up');
    expect(attempts).toBe(1);
  } finally { log.mockRestore(); }
});
it('imports 120 synthetic templates and all 32 shipped sequences in order, then reruns without writes', async () => {
  const db = database(); db.tables.email_templates = []; db.tables.ideal_customer_profiles = [];
  const sequenceText = readFileSync('docs/setup-pack/sequences.md', 'utf8');
  const parsed = prepareFiles([{ filename: 'sequences.md', text: sequenceText }], [], [])[0].parsed.data;
  const profiles = [...new Set(parsed.map(seq => seq.icp))];
  const templates = profiles.map((name, index) => source('email-templates', [...new Set(parsed.filter(seq => seq.icp === name).flatMap(seq => seq.steps.map(step => step.template))),
    ...Array.from({ length: 5 }, (_, n) => `Extra ${index}-${n}`)].map(name => `# ${name}\nicp: ${profiles[index]}\nsubject: Hi\n## Body\n{{unsubscribe_url}}`).join('\n')));
  const files = prepareFiles([{ filename: 'sequences.md', text: sequenceText }, ...templates, packages, source('icp-profiles', profiles.map(name => `# ${name}\n## Summary\nCustomers`).join('\n')), source('company-context', 'Company facts')], [], []);
  expect((await applyImport(db.client, files, options)).error).toBeNull();
  expect(db.tables.email_templates).toHaveLength(120); expect(db.tables.email_sequences).toHaveLength(32);
  expect(db.tables.email_sequences.every(sequence => sequence.is_active === false)).toBe(true);
  expect(db.writes.slice(0, 4).map(write => write.table)).toEqual(['organizations', 'ideal_customer_profiles', 'organizations', 'email_templates']);
  db.writes.length = 0; expect((await applyImport(db.client, files, options)).error).toBeNull(); expect(db.writes).toEqual([]);
});
