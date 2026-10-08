import { describe, expect, it } from 'vitest';
import { addContactRow, setPrimaryContact, updateContactRow } from './contactWrites';
import type { ContactWriteCtx } from './contactWrites';
import { emptyContactForm } from './leadContacts';
import type { DecisionMakerCandidate } from '../types';

function row(over: Partial<DecisionMakerCandidate>): DecisionMakerCandidate {
  return {
    id: 'r1', lead_id: 'L1', source: 'manual', kind: 'person', label: null, is_primary: false, include_in_sequences: true,
    apollo_person_id: null, first_name: 'Sam', last_name: 'Lee', name_obfuscated: false, title: null, email: 'sam@acme.com',
    email_revealed: false, phone: null, phone_status: 'not_requested', linkedin_url: null, dismissed_at: null,
    created_at: 'x', updated_at: 'x', ...over,
  };
}

interface Opts { failUpdate?: (id: string, patch: Record<string, unknown>) => boolean; failDelete?: boolean }

/** Minimal fake of the supabase calls the writes make; `log` records every call in order. */
function fake(rows: DecisionMakerCandidate[], log: string[], opts: Opts = {}) {
  let n = 0;
  const table = {
    insert: (r: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          const made = row({ ...(r as Partial<DecisionMakerCandidate>), id: `new-${++n}` });
          rows.push(made);
          log.push(`insert:${made.id}`);
          return { data: made, error: null };
        },
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (_c: string, id: string) => ({
        select: () => ({
          single: async () => {
            if (opts.failUpdate?.(id, patch)) { log.push(`update-failed:${id}`); return { data: null, error: { code: '23505', message: 'decision_maker_candidates_one_primary' } }; }
            const target = rows.find((x) => x.id === id);
            Object.assign(target ?? {}, patch);
            log.push(`update:${id}:${JSON.stringify(patch)}`);
            return { data: { ...target }, error: null };
          },
        }),
      }),
    }),
    delete: () => ({ eq: async (_c: string, id: string) => { log.push(`delete:${id}`); return { error: opts.failDelete ? { message: 'no' } : null }; } }),
  };
  return { from: () => table } as unknown as ContactWriteCtx['client'];
}

function ctx(client: ContactWriteCtx['client'], over: Partial<ContactWriteCtx> = {}): ContactWriteCtx {
  return { client, userId: 'u1', dismiss: async () => null, ...over };
}

describe('setPrimaryContact', () => {
  const list = () => [row({ id: 'A', is_primary: true }), row({ id: 'B', email: 'b@acme.com' })];

  it('clears the old main contact first, then sets the new one', async () => {
    const rows = list(); const log: string[] = [];
    const r = await setPrimaryContact(ctx(fake(rows, log)), rows, 'B');
    expect(r).toEqual({ error: null });
    expect(log).toEqual(['update:A:{"is_primary":false}', 'update:B:{"is_primary":true}']);
  });

  it('restores the old main contact when setting the new one fails', async () => {
    const rows = list(); const log: string[] = [];
    const r = await setPrimaryContact(ctx(fake(rows, log, { failUpdate: (id, p) => id === 'B' && p.is_primary === true })), rows, 'B');
    expect(r.error).toBe('Another contact is already marked as main. Unmark it first.. Your previous main contact was kept.');
    expect(log).toEqual(['update:A:{"is_primary":false}', 'update-failed:B', 'update:A:{"is_primary":true}']);
    expect(rows[0].is_primary).toBe(true);
  });

  it('says so when the old main contact cannot be restored', async () => {
    const rows = list(); const log: string[] = [];
    const r = await setPrimaryContact(ctx(fake(rows, log, { failUpdate: (id, p) => p.is_primary === true && (id === 'B' || id === 'A') })), rows, 'B');
    expect(r.error).toContain('could not be restored, so no contact is marked as main');
  });

  it('does nothing when the contact is already main', async () => {
    const rows = list(); const log: string[] = [];
    expect(await setPrimaryContact(ctx(fake(rows, log)), rows, 'A')).toEqual({ error: null });
    expect(log).toEqual([]);
  });
});

describe('updateContactRow compensating delete', () => {
  const provider = () => row({ id: 'H', source: 'hunter', email: 'old@acme.com' });
  const form = (email: string) => ({ ...emptyContactForm('person'), first_name: 'Sam', last_name: 'Lee', email });

  it('removes the new copy again when the provider row cannot be dismissed', async () => {
    const rows = [provider()]; const log: string[] = []; const removed: string[] = [];
    const r = await updateContactRow(ctx(fake(rows, log), { dismiss: async () => 'Could not remove', onRemoved: (id) => removed.push(id) }), rows[0], form('new@acme.com'));
    expect(r.error).toBe('Could not remove');
    expect(log).toEqual(['insert:new-1', 'delete:new-1']);
    expect(removed).toEqual(['new-1']);
  });

  it('warns about a possible duplicate when the compensating delete fails too', async () => {
    const rows = [provider()]; const log: string[] = [];
    const r = await updateContactRow(ctx(fake(rows, log, { failDelete: true }), { dismiss: async () => 'Could not remove' }), rows[0], form('new@acme.com'));
    expect(r.error).toBe('A duplicate contact may exist; refresh and delete the extra one');
  });

  it('keeps a main provider row main after replacing it', async () => {
    const rows = [{ ...provider(), is_primary: true }]; const log: string[] = [];
    const r = await updateContactRow(ctx(fake(rows, log)), rows[0], form('new@acme.com'));
    expect(r.error).toBeNull();
    expect(log).toEqual(['insert:new-1', 'update:new-1:{"is_primary":true}']);
  });
});

describe('addContactRow', () => {
  it('refuses to write without a signed-in user and rejects an invalid form', async () => {
    const log: string[] = [];
    const form = { ...emptyContactForm('person'), first_name: 'A', email: 'a@b.co' };
    expect((await addContactRow(ctx(fake([], log), { userId: null }), 'L1', form)).error).toBe('You need to be signed in to add a contact.');
    expect((await addContactRow(ctx(fake([], log)), 'L1', { ...form, email: 'bad' })).error).toBe('That email address does not look right.');
    expect(log).toEqual([]);
  });
});
