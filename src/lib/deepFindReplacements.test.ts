import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { groupReplacements, replaceSavedEmail, replaceNotice } from './deepFindReplacements';
import { visibleSuggestions } from '../../supabase/functions/_shared/deepFindSuggestions';

const ev = { contact_id: 'c1', email: 'Jane.Smith@Example.com' };
const mk = (value: string, rank: 'most_likely' | 'other', over = {}) => ({ name: 'Jane Smith', field: 'email', value, label: 'x', guess_rank: rank, replaces_saved_email: ev, ...over });

it('groups replacements per person, top candidate first, and leaves the rest alone', () => {
  const other = { name: 'Bob', value: 'bob@example.com', label: 'y' };
  const g = groupReplacements([other, mk('jane@example.com', 'other'), mk('jane.smith@example.org', 'most_likely'), mk('j@example.com', 'other', { replaces_saved_email: { contact_id: 'c2', email: 'z@x.com' }, name: 'Zed' })]);
  expect(g.rest).toEqual([other]);
  expect(g.groups.map(x => x.name)).toEqual(['Jane Smith', 'Zed']);
  expect(g.groups[0]!.primary.value).toBe('jane.smith@example.org');
  expect(g.groups[0]!.others.map(s => s.value)).toEqual(['jane@example.com']);
  expect(g.groups[0]!.oldEmail).toBe(ev.email);
  expect(g.groups[1]!.primary.value).toBe('j@example.com');
});

it('keeps a replacement visible when the saved email differs only by case', () => {
  const contacts = [{ id: 'c1', first_name: 'Jane', last_name: 'Smith', email: 'jane.smith@example.com' }];
  expect(visibleSuggestions([mk('jane@example.com', 'most_likely')], {}, contacts)).toHaveLength(1);
});

function db(contact: object | null, updated = true, writeError = false) {
  const writes: { patch: Record<string, unknown>; filters: unknown[][] }[] = [];
  const from = vi.fn(() => {
    let w: (typeof writes)[number] | undefined;
    const q: Record<string, unknown> = {
      select: () => q,
      update: (patch: Record<string, unknown>) => { w = { patch, filters: [] }; writes.push(w); return q; },
      eq: (...a: unknown[]) => { w?.filters.push(a); return q; },
      is: (...a: unknown[]) => { w?.filters.push(a); return q; },
      maybeSingle: async () => ({ data: contact, error: null }),
      then: (r: (v: unknown) => void) => r({ data: writeError ? null : updated ? [{ id: 'c1' }] : [], error: writeError ? { code: 'x' } : null }),
    };
    return q;
  });
  return { client: { from } as unknown as SupabaseClient, writes };
}
const saved = { id: 'c1', email: 'jane.smith@example.com', dismissed_at: null };

it('replaces only when the current email still equals the old one, touching nothing else', async () => {
  const d = db(saved);
  expect(await replaceSavedEmail(d.client, 'u', 'lead', mk('jane@example.com', 'most_likely'))).toBe('replaced');
  expect(d.writes).toEqual([{ patch: { email: 'jane@example.com' }, filters: [['id', 'c1'], ['lead_id', 'lead'], ['dismissed_at', null], ['email', 'jane.smith@example.com']] }]);
});
it('leaves it as is when changed since, missing, dismissed or the write matches no row', async () => {
  for (const d of [db({ ...saved, email: 'new@example.com' }), db(null), db({ ...saved, dismissed_at: 'now' }), db(saved, false)]) {
    expect(await replaceSavedEmail(d.client, 'u', 'lead', mk('jane@example.com', 'most_likely'))).toBe('changed');
  }
  expect(db(saved).writes).toEqual([]);
});
it('needs sign-in, evidence, and surfaces write errors', async () => {
  await expect(replaceSavedEmail(db(saved).client, null, 'lead', mk('a@b.co', 'other'))).rejects.toThrow('Sign in');
  await expect(replaceSavedEmail(db(saved).client, 'u', 'lead', { name: 'A', value: 'a@b.co' })).rejects.toThrow();
  await expect(replaceSavedEmail(db(saved, true, true).client, 'u', 'lead', mk('a@b.co', 'other'))).rejects.toThrow('Could not save');
});
it('notices', () => {
  expect(replaceNotice('replaced')).toBe('Replaced');
  expect(replaceNotice('changed')).toBe('Changed since, left as is.');
});
