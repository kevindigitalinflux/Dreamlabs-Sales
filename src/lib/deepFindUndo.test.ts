import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { undoDeepFindChange } from './deepFindReview';
import type { AutoApplied } from '../../supabase/functions/_shared/deepFindAutoApply';
const change: AutoApplied = { table: 'decision_maker_candidates', id: 'contact', field: 'linkedin_url', before: null, after: 'https://www.linkedin.com/in/jane' };
function db(data: unknown = [{ id: 'contact' }], error: unknown = null) {
  const filters: unknown[] = []; const update = vi.fn();
  const q = { update: (patch: unknown) => { update(patch); return q; }, eq: (...a: unknown[]) => { filters.push(a); return q; },
    select: () => q, maybeSingle: async () => ({ data: { linkedin_url: 'changed' }, error: null }), then: (resolve: (v: unknown) => void) => resolve({ data, error }) };
  const suppression = { select: () => suppression, eq: () => suppression, is: () => suppression,
    update: () => suppression, maybeSingle: async () => ({ data: { dismissed_suggestions: null }, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: [{ id: 'lead' }], error: null }) };
  return { client: { from: () => ({ ...q,
    select: (fields: string) => fields === 'dismissed_suggestions' ? suppression : q,
    update: (patch: Record<string, unknown>) => 'dismissed_suggestions' in patch ? suppression : q.update(patch),
  }) } as unknown as SupabaseClient, filters, update };
}
it('restores only the recorded field through a scoped atomic compare-and-set', async () => {
  const d = db(); expect(await undoDeepFindChange(d.client, 'user', 'lead', change)).toBe('Undone.');
  expect(d.update).toHaveBeenCalledWith({ linkedin_url: null });
  expect(d.filters).toEqual([['id','contact'], ['lead_id','lead'], ['linkedin_url', change.after]]);
});
it('leaves concurrent changes alone and distinguishes errors from a no-row update', async () => {
  expect(await undoDeepFindChange(db([]).client, 'user', 'lead', change)).toBe('Changed since, left as is');
  await expect(undoDeepFindChange(db(null, { code: '42501' }).client, 'user', 'lead', change)).rejects.toThrow('Could not undo');
});
it('refuses unsigned writes, arbitrary fields and another lead identity', async () => {
  const d = db();
  await expect(undoDeepFindChange(d.client, null, 'lead', change)).rejects.toThrow('Sign in');
  await expect(undoDeepFindChange(d.client, 'user', 'lead', { ...change, field: 'org_id' })).rejects.toThrow('Invalid');
  await expect(undoDeepFindChange(d.client, 'user', 'lead', { ...change, table: 'leads', id: 'other', field: 'website' })).rejects.toThrow('Invalid');
  expect(d.update).not.toHaveBeenCalled();
});
it('compares a complete archived-websites array using a Postgres array literal', async () => {
  const d = db();
  await undoDeepFindChange(d.client, 'user', 'lead', { table: 'leads', id: 'lead', field: 'additional_websites', before: null, after: ['old.com', 'https://example.com/?q="x"'] });
  expect(d.filters).toContainEqual(['additional_websites', '{"old.com","https://example.com/?q=\\"x\\""}']);
  expect(d.update).toHaveBeenCalledWith({ additional_websites: null });
});

function stateDb(row: Record<string, unknown> | null, blocked = false, race?: (row: Record<string, unknown>) => void) {
  const writes: Record<string, unknown>[] = [];
  if (row) row.dismissed_suggestions = null;
  const lead = { id: 'lead', dismissed_suggestions: null };
  const client = { from: (table: string) => {
    const target: Record<string, unknown> | null = table === 'leads' && row?.lead_id ? lead : row;
    let patch: Record<string, unknown> | undefined; const filters: [string, unknown][] = [];
    const q = { select: () => q, update: (p: Record<string, unknown>) => { patch = p; return q; }, eq: (k: string, v: unknown) => { filters.push([k,v]); return q; }, is: (k: string, v: unknown) => { filters.push([k,v]); return q; },
      maybeSingle: async () => ({ data: target && { ...target }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch && row && race && !('dismissed_suggestions' in patch)) race(row);
        const same = target && filters.every(([k,v]) => Array.isArray(target[k]) ? v === '{' + (target[k] as string[]).map(x => JSON.stringify(x)).join(',') + '}' : target[k] === v);
        if (patch) writes.push(patch);
        if (patch && same && !blocked) Object.assign(target!, patch);
        resolve({ data: same && !blocked ? [{ ...target }] : [], error: null });
      } };
    return q;
  } } as unknown as SupabaseClient;
  return { client, writes };
}
it('distinguishes RLS-blocked writes from concurrent value changes', async () => {
  const row = { id: 'contact', lead_id: 'lead', linkedin_url: change.after };
  expect(await undoDeepFindChange(stateDb(row, true).client, 'user', 'lead', change)).toBe('You cannot change this lead');
  expect(await undoDeepFindChange(stateDb(null, true).client, 'user', 'lead', change)).toBe('You cannot change this lead');
  expect(await undoDeepFindChange(stateDb({ ...row, linkedin_url: 'different' }).client, 'user', 'lead', change)).toBe('Changed since, left as is');
});
it('undoes the website and only its exact archived addition in one guarded write', async () => {
  const website: AutoApplied = { table: 'leads', id: 'lead', field: 'website', before: 'old.com', after: 'https://acme.com', archivedWebsite: 'old.com' };
  const row = { id: 'lead', website: website.after, additional_websites: ['other.com', 'old.com', 'later.com'] };
  const d = stateDb(row);
  expect(await undoDeepFindChange(d.client, 'user', 'lead', website)).toBe('Undone.');
  expect(d.writes).toContainEqual({ website: 'old.com', additional_websites: ['other.com', 'later.com'] });
  expect((row as Record<string, unknown>).dismissed_suggestions).toEqual(['website:acme.com']);
  expect(row.additional_websites).toEqual(['other.com', 'later.com']);
  const raced = stateDb({ ...row, website: website.after }, false, r => { r.additional_websites = ['concurrent.com']; });
  expect(await undoDeepFindChange(raced.client, 'user', 'lead', website)).toBe('Changed since, left as is');
});
it('does not remove an archive value which differs in case or was already removed', async () => {
  const website: AutoApplied = { table: 'leads', id: 'lead', field: 'website', before: 'old.com', after: 'https://acme.com', archivedWebsite: 'old.com' };
  const row = { id: 'lead', website: website.after, additional_websites: ['OLD.com'] };
  expect(await undoDeepFindChange(stateDb(row).client, 'user', 'lead', website)).toBe('Undone.');
  expect(row.additional_websites).toEqual(['OLD.com']);
});

it('reports RLS denial without partially undoing the website or archive', async () => {
  const website: AutoApplied = { table: 'leads', id: 'lead', field: 'website', before: 'old.com', after: 'https://acme.com', archivedWebsite: 'old.com' };
  const row = { id: 'lead', website: website.after, additional_websites: ['old.com'] };
  expect(await undoDeepFindChange(stateDb(row, true).client, 'user', 'lead', website)).toBe('You cannot change this lead');
  expect(row).toEqual({ id: 'lead', website: website.after, additional_websites: ['old.com'], dismissed_suggestions: null });
});
it('dedupes suppression on repeated Undo without gating the append on the restored field', async () => {
  const row: Record<string, unknown> = { id: 'lead', phone: '+442079460958' };
  const d = stateDb(row);
  const phone: AutoApplied = { table: 'leads', id: 'lead', field: 'phone', before: null, after: '+442079460958' };
  expect(await undoDeepFindChange(d.client, 'user', 'lead', phone)).toBe('Undone.');
  expect(await undoDeepFindChange(d.client, 'user', 'lead', phone)).toBe('Changed since, left as is');
  expect(row.dismissed_suggestions).toEqual(['phone:442079460958']);
});
it('retries a dismissal-array race and preserves the other dismissal', async () => {
  const row: Record<string, unknown> = { id: 'lead', phone: '+442079460958', dismissed_suggestions: ['person:old name'] };
  let raced = false;
  const client = { from: () => {
    let patch: Record<string, unknown> | undefined; const filters: [string, unknown][] = [];
    const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k,v]); return q; }, is: (k: string, v: unknown) => { filters.push([k,v]); return q; },
      update: (p: Record<string, unknown>) => { patch = p; return q; }, maybeSingle: async () => ({ data: { ...row }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch?.dismissed_suggestions && !raced) { row.dismissed_suggestions = ['person:old name', 'email:other@acme.com']; raced = true; }
        const matched = filters.every(([k,v]) => Array.isArray(row[k]) ? v === '{' + (row[k] as string[]).map(x => JSON.stringify(x)).join(',') + '}' : row[k] === v);
        if (patch && matched) Object.assign(row, patch);
        resolve({ data: matched ? [{ id: 'lead' }] : [], error: null });
      } };
    return q;
  } } as unknown as SupabaseClient;
  expect(await undoDeepFindChange(client, 'user', 'lead', { table: 'leads', id: 'lead', field: 'phone', before: null, after: '+442079460958' })).toBe('Undone.');
  expect(row.dismissed_suggestions).toEqual(['person:old name', 'email:other@acme.com', 'phone:442079460958']);
});
