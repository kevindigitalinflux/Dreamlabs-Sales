import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { loadDeepFindReview, rejectDeepFindCompanies, saveDeepFindReview } from './deepFindReview';

function database(options: { owner?: string | null; email?: string | null; contacts?: object[]; readError?: boolean; writeError?: boolean } = {}) {
  const writes: { table: string; operation: string; patch: Record<string, unknown>; filters: unknown[][] }[] = [];
  const from = vi.fn((table: string) => {
    let write: typeof writes[number] | undefined;
    const result = () => ({ data: options.readError ? null : table === 'leads'
      ? { id: 'lead', updated_at: 'version', email: options.email ?? null, owner_name: options.owner ?? null, additional_emails: ['old@example.com'], dismissed_suggestions: ['person:old name'], ...write?.patch }
      : write ? { id: 'contact', ...write.patch } : options.contacts ?? [], error: options.readError || (write && options.writeError) ? { code: 'PGRST116' } : null });
    const q = {
      select: () => q,
      eq: (...args: unknown[]) => { write?.filters.push(args); return q; },
      is: (...args: unknown[]) => { write?.filters.push(args); return q; },
      update: (patch: Record<string, unknown>) => { write = { table, operation: 'update', patch, filters: [] }; writes.push(write); return q; },
      insert: (patch: Record<string, unknown>) => { write = { table, operation: 'insert', patch, filters: [] }; writes.push(write); return q; },
      single: async () => result(), then: (resolve: (v: ReturnType<typeof result>) => void) => resolve(result()),
    };
    return q;
  });
  return { client: { from } as unknown as SupabaseClient, writes };
}
const s = { name: 'Company contact', value: 'hello@example.com' };
it('saves a dismissal without dropping earlier keys and guards against concurrent lead edits', async () => {
  const db = database();
  await saveDeepFindReview(db.client, 'user', 'lead', s, 'dismiss');
  expect(db.writes).toEqual([{ table: 'leads', operation: 'update', patch: { dismissed_suggestions: ['person:old name','email:hello@example.com'] }, filters: [['id','lead'],['updated_at','version']] }]);
});
it('fails closed on read errors, no session and RLS-blocked writes', async () => {
  const db = database({ readError: true });
  await expect(loadDeepFindReview(db.client, 'lead')).rejects.toThrow('Could not load');
  await expect(saveDeepFindReview(db.client, 'user', 'lead', s, 'add')).rejects.toThrow();
  expect(db.writes).toEqual([]);
  await expect(saveDeepFindReview(database().client, null, 'lead', s, 'add')).rejects.toThrow('Sign in');
  await expect(saveDeepFindReview(database({ writeError: true }).client, 'user', 'lead', s, 'add')).rejects.toThrow('Could not save');
  await expect(saveDeepFindReview(database({ writeError: true }).client, 'user', 'lead', s, 'add')).rejects.toMatchObject({ code: 'PGRST116' });
});
it('creates a contact under the current user with sequences off', async () => {
  const db = database();
  await saveDeepFindReview(db.client, 'user', 'lead', { name: 'Jane Smith', role: 'Director' }, 'add');
  expect(db.writes[0]).toMatchObject({ table: 'decision_maker_candidates', operation: 'insert', patch: { lead_id: 'lead', created_by: 'user', source: 'manual', email: null, include_in_sequences: false } });
});
it('fills only a still-blank, non-dismissed contact email', async () => {
  const db = database({ contacts: [{ id: 'c', first_name: 'Jane', last_name: 'Smith', email: null }] });
  await saveDeepFindReview(db.client, 'user', 'lead', { ...s, name: 'Jane Smith' }, 'add');
  expect(db.writes[0]).toMatchObject({ patch: { email: 'hello@example.com', include_in_sequences: false }, filters: [['id','c'],['lead_id','lead'],['dismissed_at',null],['email',null]] });
});
it('appends company emails and never writes sequence tables', async () => {
  const db = database({ email: 'primary@example.com' });
  await saveDeepFindReview(db.client, 'user', 'lead', s, 'add');
  expect(db.writes).toHaveLength(1);
  expect(db.writes[0]).toMatchObject({ table: 'leads', patch: { additional_emails: ['old@example.com','hello@example.com'] } });
});
it.each(['IE','US','OTHER','unlisted'] as const)('persists rejection %s without changing country for unlisted UK', async (country) => {
  const db = database();
  const notice = await rejectDeepFindCompanies(db.client, 'lead', country);
  expect(db.writes[0]?.patch).toEqual({ registry_candidates_rejected: country === 'unlisted', ...(country === 'unlisted' ? {} : { country }) });
  expect(notice).toContain(country === 'unlisted' ? 'will not ask again' : 'not a UK company');
});
it('reports an already-present suggestion without writing', async () => {
  const db = database({ email: s.value });
  expect(await saveDeepFindReview(db.client, 'user', 'lead', s, 'add')).toBe('none');
  expect(db.writes).toEqual([]);
});
const val = { name: 'Valentina Antunovic', value: 'val@example.com', label: 'Found on site' };
const founder = [{ name: 'Valentína  Antunovic', role: 'Founder' }];
it('sets a blank lead owner from an owner-like role and fills the contact title', async () => {
  const db = database();
  expect(await saveDeepFindReview(db.client, 'user', 'lead', val, 'add', founder)).toBe('owner_set');
  expect(db.writes[0]).toMatchObject({ table: 'decision_maker_candidates', operation: 'insert', patch: { title: 'Founder', include_in_sequences: false } });
  expect(db.writes[1]).toMatchObject({ table: 'leads', patch: { owner_name: 'Valentina Antunovic' }, filters: [['id','lead'],['updated_at','version']] });
});
it('never overwrites an existing owner, and does nothing extra without a known or owner-like role', async () => {
  const a = database({ owner: 'Someone Else' });
  expect(await saveDeepFindReview(a.client, 'user', 'lead', val, 'add', founder)).toBe('saved');
  expect(a.writes.some((w) => w.table === 'leads')).toBe(false);
  const b = database();
  expect(await saveDeepFindReview(b.client, 'user', 'lead', val, 'add', [])).toBe('saved');
  expect(await saveDeepFindReview(b.client, 'user', 'lead', { ...val, name: 'Jo Bloggs', value: 'jo@example.com' }, 'add', [{ name: 'Jo Bloggs', role: 'Marketing Manager' }])).toBe('saved');
  expect(b.writes.some((w) => w.table === 'leads')).toBe(false);
});
it('uses a blank-trimmed owner as blank and an existing contact title as the role', async () => {
  const db = database({ owner: '   ', contacts: [{ id: 'c', first_name: 'Valentina', last_name: 'Antunovic', title: 'CEO', email: null }] });
  expect(await saveDeepFindReview(db.client, 'user', 'lead', val, 'add')).toBe('owner_set');
  expect(db.writes[0]?.table).toBe('decision_maker_candidates');
});
it('throws a coded error when the owner write fails', async () => {
  const db = database();
  await expect(saveDeepFindReview({ from: (t: string) => t === 'leads' ? { ...db.client.from(t), update: () => { throw Object.assign(new Error('boom'), { code: 'X' }); } } : db.client.from(t) } as unknown as SupabaseClient, 'user', 'lead', val, 'add', founder)).rejects.toThrow();
});
