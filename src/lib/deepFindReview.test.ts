import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { planTitleUpgrade } from '../../supabase/functions/_shared/deepFindSuggestions';
import { loadDeepFindReview, rejectDeepFindCompanies, reviewNotice, saveDeepFindReview } from './deepFindReview';

it('replaces an invalid saved email only after Add, with exact-value CAS and sequences disabled', async () => {
  const contact = { id: 'c', first_name: 'Jane', last_name: 'Smith', email: 'jane.smith@example.com' };
  const suggestion = { name: 'Jane Smith', field: 'email', value: 'jane@example.com',
    replaces_saved_email: { contact_id: 'c', email: contact.email } };
  const db = database({ contacts: [contact] });
  expect(await saveDeepFindReview(db.client, 'user', 'lead', suggestion, 'add')).toBe('saved');
  expect(db.writes).toEqual([{ table: 'decision_maker_candidates', operation: 'update',
    patch: { email: 'jane@example.com', include_in_sequences: false },
    filters: [['id', 'c'], ['lead_id', 'lead'], ['dismissed_at', null], ['email', contact.email]] }]);
  const changed = database({ contacts: [{ ...contact, email: 'new@example.com' }] });
  expect(await saveDeepFindReview(changed.client, 'user', 'lead', suggestion, 'add')).toBe('none');
  expect(changed.writes).toEqual([]);
  const denied = database({ contacts: [contact], writeError: true });
  await expect(saveDeepFindReview(denied.client, 'user', 'lead', suggestion, 'add')).rejects.toThrow('Could not save');
});
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
it('adds a reviewed phone only to the still-blank named contact, with phone CAS and no sequence edits', async () => {
  const suggestion = { name: 'Jane Smith', field: 'person_phone', value: '+442079460958', label: 'Company line',
    phone: { value: '+442079460958', original: '020 7946 0958', kind: 'company_line' as const, source: 'own_site' as const, source_url: 'https://acme.test/team', found_at: '2026-10-26T12:00:00Z' } };
  const contact = { id: 'c', first_name: 'Jane', last_name: 'Smith', phone: null };
  const db = database({ contacts: [contact] });
  expect(await saveDeepFindReview(db.client, 'user', 'lead', suggestion, 'add')).toBe('saved');
  expect(db.writes).toEqual([{ table: 'decision_maker_candidates', operation: 'update', patch: {
    phone: '+442079460958', phone_kind: 'company_line', phone_source: 'own_site', phone_source_url: 'https://acme.test/team', phone_found_at: '2026-10-26T12:00:00Z',
  }, filters: [['id', 'c'], ['lead_id', 'lead'], ['dismissed_at', null], ['phone', null]] }]);
  await expect(saveDeepFindReview(database({ contacts: [contact], writeError: true }).client, 'user', 'lead', suggestion, 'add')).rejects.toThrow('Could not save');
});
it('saves provider title proposals only through the session with exact blank-value CAS', async () => {
  const db = database({ contacts: [{ id: 'c', first_name: 'Jane', last_name: 'Smith', title: '' }] });
  await saveDeepFindReview(db.client, 'user', 'lead', { name: 'Jane Smith', field: 'title', value: 'Founder' }, 'add');
  expect(db.writes[0]).toMatchObject({ table: 'decision_maker_candidates', patch: { title: 'Founder' }, filters: [['id','c'],['lead_id','lead'],['dismissed_at',null],['title','']] });
});
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
it('adds a LinkedIn suggestion through the session without changing email or sequences', async () => {
  const db = database({ contacts: [{ id: 'c', first_name: 'Jane', last_name: 'Smith', email: 'saved@example.com', linkedin_url: '' }] });
  const suggestion = { name: 'Jane Smith', field: 'linkedin_url', value: 'https://www.linkedin.com/in/jane', label: 'Evidence to check' };
  expect(await saveDeepFindReview(db.client, 'user', 'lead', suggestion, 'add')).toBe('saved');
  expect(db.writes).toEqual([{ table: 'decision_maker_candidates', operation: 'update', patch: { linkedin_url: suggestion.value }, filters: [['id','c'],['lead_id','lead'],['dismissed_at',null],['linkedin_url','']] }]);
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
const jane = (title: unknown, extra: object = {}) => ({ id: 'c', first_name: 'Valentina', last_name: 'Antunovic', title, email: null, ...extra });
describe('planTitleUpgrade', () => {
  it.each([
    [null, 'Founder', 'Founder'], ['  ', 'Co-founder', 'Co-founder'], ['Director', 'Managing Director', 'Managing Director'], ['Manager', 'CEO', 'CEO'],
    ['Owner', 'Founder', null], ['Co-founder & CEO', 'Owner', null],
    [null, null, null], [null, '', null], ['Manager', 'Marketing Manager', null], [null, 'Director', null],
  ])('title %j with role %j -> %j', (title, role, expected) => {
    expect(planTitleUpgrade(jane(title) as never, role as string | null)).toBe(expected);
  });
  it('never touches a dismissed contact', () => {
    expect(planTitleUpgrade(jane(null, { dismissed_at: '2026-01-01' }) as never, 'Founder')).toBeNull();
  });
});
describe('title upgrade save flow', () => {
  it('upgrades a non-owner title while filling the email, with a compare-and-set on the old title', async () => {
    const db = database({ contacts: [jane('Director')] });
    expect(await saveDeepFindReview(db.client, 'user', 'lead', val, 'add', founder)).toBe('owner_title_set');
    expect(db.writes[0]).toMatchObject({ patch: { email: 'val@example.com', include_in_sequences: false } });
    expect(db.writes[1]).toMatchObject({ table: 'decision_maker_candidates', patch: { title: 'Founder' }, filters: [['id','c'],['lead_id','lead'],['dismissed_at',null],['title','Director']] });
    expect(db.writes[2]).toMatchObject({ table: 'leads', patch: { owner_name: 'Valentina Antunovic' } });
  });
  it('upgrades a blank title only when still blank, and reports title_set when the owner is already known', async () => {
    const db = database({ owner: 'Someone Else', contacts: [jane(null)] });
    expect(await saveDeepFindReview(db.client, 'user', 'lead', val, 'add', founder)).toBe('title_set');
    expect(db.writes[1]).toMatchObject({ patch: { title: 'Founder' }, filters: [['id','c'],['lead_id','lead'],['dismissed_at',null],['title',null]] });
    expect(Object.keys(db.writes[1]!.patch)).toEqual(['title']);
  });
  it('upgrades the title of a named person who already has an email, without any other write', async () => {
    const db = database({ owner: 'Someone Else', contacts: [jane('Manager', { email: 'val@example.com' })] });
    expect(await saveDeepFindReview(db.client, 'user', 'lead', { name: val.name }, 'add', founder)).toBe('title_set');
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ patch: { title: 'Founder' } });
  });
  it('leaves an owner-like title, an unknown role and a dismissed contact alone', async () => {
    const a = database({ owner: 'X', contacts: [jane('CEO')] });
    expect(await saveDeepFindReview(a.client, 'user', 'lead', val, 'add', founder)).toBe('saved');
    expect(a.writes).toHaveLength(1);
    const b = database({ owner: 'X', contacts: [jane('Manager')] });
    expect(await saveDeepFindReview(b.client, 'user', 'lead', val, 'add', [])).toBe('saved');
    expect(b.writes).toHaveLength(1);
    const c = database({ owner: 'X', contacts: [jane(null, { dismissed_at: 'x' })] });
    expect(await saveDeepFindReview(c.client, 'user', 'lead', { name: val.name }, 'add', founder)).toBe('none');
    expect(c.writes).toEqual([]);
  });
  it('keeps a newly created contact on the existing insert path (role as title, no extra update)', async () => {
    const db = database({ owner: 'X' });
    expect(await saveDeepFindReview(db.client, 'user', 'lead', val, 'add', founder)).toBe('saved');
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ operation: 'insert', patch: { title: 'Founder' } });
  });
  it('throws the coded error when the title write fails', async () => {
    const db = database({ owner: 'X', contacts: [jane('Manager', { email: 'v@example.com' })], writeError: true });
    await expect(saveDeepFindReview(db.client, 'user', 'lead', { name: val.name }, 'add', founder)).rejects.toMatchObject({ code: 'PGRST116' });
  });
});
describe('reviewNotice', () => {
  it.each([
    ['title_set', 'Added to lead. Contact title updated to Founder.'],
    ['owner_title_set', "Added to lead. Also set as the lead's owner and updated their title."],
    ['owner_set', "Added to lead. Also set as the lead's owner."],
    ['saved', 'Added to lead. No sequence enrolment was added.'],
    ['none', 'Already on this lead'],
  ] as const)('%s', (result, text) => { expect(reviewNotice(result, 'add', 'Founder')).toBe(text); });
});
