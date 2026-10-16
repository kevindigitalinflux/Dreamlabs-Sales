import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { loadDeepFindReview, rejectDeepFindCompanies, saveDeepFindReview } from './deepFindReview';

function database(options: { email?: string | null; contacts?: object[]; readError?: boolean; writeError?: boolean } = {}) {
  const writes: { table: string; operation: string; patch: Record<string, unknown>; filters: unknown[][] }[] = [];
  const from = vi.fn((table: string) => {
    let write: typeof writes[number] | undefined;
    const result = () => ({ data: options.readError ? null : table === 'leads'
      ? { id: 'lead', updated_at: 'version', email: options.email ?? null, additional_emails: ['old@example.com'], dismissed_suggestions: ['person:old name'], ...write?.patch }
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
  expect(db.writes[0]?.patch).toEqual({ registry_candidates_rejected: true, ...(country === 'unlisted' ? {} : { country }) });
  expect(notice).toContain(country === 'unlisted' ? 'will not ask again' : 'not a UK company');
});
