import { describe, expect, it } from 'vitest';
import { sanitizeDreamAgentActions } from './dreamAgentActions';
import {
  DEFAULT_GENERAL_LABEL, MAX_CONTACT_ACTIONS_PER_LEAD, MAX_CONTACT_ACTIONS_TOTAL, draftChangesContact, draftFromAction, draftProblem, planContactSteps,
} from './dreamAgentContacts';
import type { ContactAction, ContactDraft, ContactIndex } from './dreamAgentContacts';
import { applyContactSteps } from './dreamAgentContactApply';
import type { DecisionMakerCandidate } from '../types';

const LEADS = new Set(['lead-1', 'lead-2']);

function contact(over: Partial<DecisionMakerCandidate>): DecisionMakerCandidate {
  return {
    id: 'c-1', lead_id: 'lead-1', source: 'manual', kind: 'person', label: null, is_primary: false, include_in_sequences: true,
    apollo_person_id: null, first_name: 'Sam', last_name: 'Lee', name_obfuscated: false, title: 'Owner', email: 'sam@acme.com',
    email_revealed: false, phone: null, phone_status: 'not_requested', linkedin_url: null, dismissed_at: null,
    created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
  };
}

const INDEX: ContactIndex = {
  'lead-1': [contact({ id: 'c-1' }), contact({ id: 'c-2', first_name: 'Pat', last_name: 'Jones', email: 'pat@acme.com', is_primary: true })],
  'lead-2': [contact({ id: 'c-9', lead_id: 'lead-2', first_name: 'Zed', email: 'zed@other.com' })],
};

const add = (over: Record<string, unknown> = {}) => ({
  type: 'add_contact', lead_id: 'lead-1', kind: 'person', first_name: 'Ann', last_name: 'Ray', email: 'ann@acme.com', excerpt: 'x', rationale: 'y', ...over,
});
const upd = (over: Record<string, unknown> = {}) => ({
  type: 'update_contact', lead_id: 'lead-1', contact_id: 'c-1', patch: { phone: '020 7946 0000' }, excerpt: 'x', rationale: 'y', ...over,
});
const run = (raw: unknown[], index: ContactIndex = INDEX) => sanitizeDreamAgentActions(raw, LEADS, undefined, undefined, index);

describe('add_contact sanitising', () => {
  it('keeps a valid add and normalises values', () => {
    expect(run([add({ email: ' Ann@Acme.com ', title: 'Office Manager' })])).toEqual([
      { type: 'add_contact', lead_id: 'lead-1', kind: 'person', first_name: 'Ann', last_name: 'Ray', title: 'Office Manager', email: 'ann@acme.com', excerpt: 'x', rationale: 'y' },
    ]);
  });

  it('drops an unknown lead', () => {
    expect(run([add({ lead_id: 'lead-999' })])).toEqual([]);
  });

  it('drops an unknown kind', () => {
    expect(run([add({ kind: 'robot' })])).toEqual([]);
  });

  it('flags an invalid email with a reason instead of trusting it', () => {
    const [a] = run([add({ email: 'not-an-email' })]);
    expect(a).toMatchObject({ type: 'add_contact', invalid: 'That email address does not look right.' });
  });

  it('flags a person with no name and control characters in a name', () => {
    expect(run([add({ first_name: undefined, last_name: undefined })])[0]).toMatchObject({ invalid: 'Add a first or last name for this person.' });
    expect(run([add({ first_name: 'An\nn' })])[0]).toMatchObject({ invalid: 'First name cannot contain line breaks or other control characters.' });
  });

  it('flags markup in names and labels', () => {
    const msg = 'Names, positions and labels must be plain text (no < or >).';
    expect(run([add({ first_name: '<b>Ann</b>' })])[0]).toMatchObject({ invalid: msg });
    expect(run([add({ kind: 'general', label: '<script>x</script>', email: 'a@b.co' })])[0]).toMatchObject({ invalid: msg });
  });

  it('strips unknown and dangerous keys', () => {
    const [a] = run([add({ source: 'hunter', created_by: 'u', id: 'forced', apollo_person_id: 'p', email_revealed: true, is_primary: true, dismissed_at: 'x', linkedin_url: 'https://x.co/in/a' })]);
    expect(Object.keys(a).sort()).toEqual(['email', 'excerpt', 'first_name', 'kind', 'last_name', 'lead_id', 'rationale', 'type']);
  });

  it('gives a general inbox without a label the default label and drops names', () => {
    const [a] = run([add({ kind: 'general', first_name: 'Ignored', last_name: 'Name', email: 'info@acme.com' })]);
    expect(a).toEqual({ type: 'add_contact', lead_id: 'lead-1', kind: 'general', label: DEFAULT_GENERAL_LABEL, email: 'info@acme.com', excerpt: 'x', rationale: 'y' });
    expect(DEFAULT_GENERAL_LABEL).toBe('General inbox');
  });

  it('collapses duplicate emails on one lead but not across leads', () => {
    const out = run([add(), add({ first_name: 'Ann2', email: 'ANN@acme.com' }), add({ lead_id: 'lead-2' })]);
    expect(out.map((a) => (a as ContactAction).lead_id)).toEqual(['lead-1', 'lead-2']);
  });

  it('drops an add for an email the lead already has', () => {
    expect(run([add({ email: 'Sam@Acme.com' })])).toEqual([]);
  });

  it('caps contact actions at 6 per lead and 20 in all', () => {
    const many = (lead: string, n: number) => Array.from({ length: n }, (_, i) => add({ lead_id: lead, email: `p${i}@${lead}.com` }));
    expect(run(many('lead-1', 10)).length).toBe(MAX_CONTACT_ACTIONS_PER_LEAD);
    const leadIds = new Set(Array.from({ length: 5 }, (_, i) => `L${i}`));
    const raw = [...leadIds].flatMap((l) => many(l, 6));
    expect(sanitizeDreamAgentActions(raw, leadIds, undefined, undefined, {}).length).toBe(MAX_CONTACT_ACTIONS_TOTAL);
  });

  it('keeps make_primary for only one contact per lead in a batch', () => {
    const out = run([add({ make_primary: true }), add({ first_name: 'Bo', email: 'bo@acme.com', make_primary: true }), add({ lead_id: 'lead-2', email: 'q@o.com', make_primary: true })]) as ContactAction[];
    expect(out.map((a) => (a.type === 'add_contact' ? a.make_primary === true : false))).toEqual([true, false, true]);
  });

  it('does not let an invalid row claim the main slot', () => {
    const out = run([add({ email: 'bad', make_primary: true }), add({ first_name: 'Bo', email: 'bo@acme.com', make_primary: true })]) as ContactAction[];
    expect(out.map((a) => (a.type === 'add_contact' ? a.make_primary === true : false))).toEqual([false, true]);
  });
});

describe('update_contact sanitising', () => {
  it('keeps a valid update with only changed keys', () => {
    expect(run([upd({ patch: { phone: '020 7946 0000', email: 'SAM@acme.com', title: 'Owner', evil: 'x' } })])).toEqual([
      { type: 'update_contact', lead_id: 'lead-1', contact_id: 'c-1', patch: { phone: '020 7946 0000' }, excerpt: 'x', rationale: 'y' },
    ]);
  });

  it('drops an unknown lead, an unknown contact, and a contact of another lead (cannot move leads)', () => {
    expect(run([upd({ lead_id: 'lead-999' })])).toEqual([]);
    expect(run([upd({ contact_id: 'nope' })])).toEqual([]);
    expect(run([upd({ lead_id: 'lead-1', contact_id: 'c-9' })])).toEqual([]);
    expect(run([upd({ lead_id: 'lead-2', contact_id: 'c-1' })])).toEqual([]);
  });

  it('drops every update when no contacts are known', () => {
    expect(run([upd()], {})).toEqual([]);
  });

  it('drops an update that changes nothing', () => {
    expect(run([upd({ patch: { title: 'Owner' } })])).toEqual([]);
    expect(run([upd({ patch: {} })])).toEqual([]);
  });

  it('flags an invalid email, and an email already on another contact', () => {
    expect(run([upd({ patch: { email: 'nope' } })])[0]).toMatchObject({ invalid: 'That email address does not look right.' });
    expect(run([upd({ patch: { email: 'pat@acme.com' } })])[0]).toMatchObject({ invalid: 'That email is already on another contact of this lead.' });
  });

  it('ignores name patches on a general inbox', () => {
    const idx: ContactIndex = { 'lead-1': [contact({ id: 'g-1', kind: 'general', label: 'Reception', first_name: null, last_name: null, email: 'r@acme.com' })] };
    expect(run([upd({ contact_id: 'g-1', patch: { first_name: 'X' } })], idx)).toEqual([]);
    expect(run([upd({ contact_id: 'g-1', patch: { label: 'Front desk' } })], idx)[0]).toMatchObject({ patch: { label: 'Front desk' } });
  });

  it('keeps make_primary only when the contact is not already main, and only once per lead', () => {
    expect(run([upd({ contact_id: 'c-2', patch: { make_primary: true } })])).toEqual([]);
    const out = run([upd({ patch: { make_primary: true } }), add({ make_primary: true })]) as ContactAction[];
    expect(out[0]).toMatchObject({ patch: { make_primary: true } });
    expect(out[1]).not.toHaveProperty('make_primary');
  });

  it('shares the per-lead cap with adds', () => {
    const raw = [...Array.from({ length: 6 }, (_, i) => add({ email: `a${i}@acme.com` })), upd()];
    expect(run(raw).length).toBe(6);
  });
});

describe('HOK example end to end', () => {
  it('turns the Andrea Manning note into a person and a general contact', () => {
    const hok: ContactIndex = { 'lead-1': [] };
    const model = [
      { type: 'add_contact', lead_id: 'lead-1', kind: 'person', first_name: 'Andrea', last_name: 'Manning', title: 'Office Manager', email: 'andrea.manning@hok.com', make_primary: true, excerpt: 'I found Andrea Manning\'s email', rationale: 'Named person with email' },
      { type: 'add_contact', lead_id: 'lead-1', kind: 'general', email: 'london@hok.com', label: 'General reception', source: 'hunter', excerpt: 'email london@hok.com for reception', rationale: 'Shared inbox' },
    ];
    expect(run(model, hok)).toEqual([
      { type: 'add_contact', lead_id: 'lead-1', kind: 'person', first_name: 'Andrea', last_name: 'Manning', title: 'Office Manager', email: 'andrea.manning@hok.com', make_primary: true, excerpt: 'I found Andrea Manning\'s email', rationale: 'Named person with email' },
      { type: 'add_contact', lead_id: 'lead-1', kind: 'general', label: 'General reception', email: 'london@hok.com', excerpt: 'email london@hok.com for reception', rationale: 'Shared inbox' },
    ]);
  });
});

const draft = (over: Partial<ContactDraft> = {}): ContactDraft => ({
  first_name: 'A', last_name: 'B', title: '', label: '', email: 'a@b.co', phone: '', make_primary: false, include_in_sequences: true, ...over,
});

describe('planContactSteps', () => {
  const item = (index: number, type: 'add' | 'update', leadId: string, over: Partial<ContactDraft> = {}) => ({
    index, type, leadId, kind: 'person' as const, contactId: type === 'update' ? `c${index}` : undefined, draft: draft(over),
  });

  it('runs adds before updates for the same lead and keeps leads in first-seen order', () => {
    const steps = planContactSteps([item(0, 'update', 'L1'), item(1, 'add', 'L2'), item(2, 'add', 'L1'), item(3, 'update', 'L2'), item(4, 'add', 'L1')]);
    expect(steps.map((s) => s.index)).toEqual([2, 4, 0, 1, 3]);
  });

  it('makes only the first main-contact request per lead main', () => {
    const steps = planContactSteps([item(0, 'add', 'L1', { make_primary: true }), item(1, 'update', 'L1', { make_primary: true }), item(2, 'add', 'L2', { make_primary: true })]);
    expect(steps.map((s) => [s.index, s.makePrimary, s.primaryDeclined])).toEqual([[0, true, false], [1, false, true], [2, true, false]]);
  });
});

describe('draft helpers', () => {
  const addAction = run([add({ title: 'Boss' })])[0] as ContactAction;

  it('builds a draft from an add and from an update merged over the existing contact', () => {
    expect(draftFromAction(addAction)).toMatchObject({ first_name: 'Ann', title: 'Boss', email: 'ann@acme.com', make_primary: false, include_in_sequences: true });
    const upAction = run([upd()])[0] as ContactAction;
    expect(draftFromAction(upAction, INDEX['lead-1'][0])).toMatchObject({ first_name: 'Sam', phone: '020 7946 0000', email: 'sam@acme.com' });
  });

  it('reports a plain-English problem for an edited draft', () => {
    expect(draftProblem('person', draft({ email: 'bad' }))).toBe('That email address does not look right.');
    expect(draftProblem('person', draft())).toBeNull();
    expect(draftProblem('general', draft({ label: '' }))).toBe('Add a label for this inbox, for example Accounts.');
  });

  it('detects whether a draft changes the contact', () => {
    const c = contact({});
    expect(draftChangesContact(c, draft({ first_name: 'Sam', last_name: 'Lee', title: 'Owner', email: 'SAM@acme.com' }))).toBe(false);
    expect(draftChangesContact(c, draft({ first_name: 'Sam', last_name: 'Lee', title: 'Owner', email: 'sam@acme.com', phone: '020 7946 0000' }))).toBe(true);
  });
});

/** A tiny fake of the supabase calls the contact writes make, recording each one. */
function fakeClient(rows: DecisionMakerCandidate[], log: string[], failInsertFor?: string) {
  let n = 0;
  const table = {
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          if (row.email === failInsertFor) return { data: null, error: { code: '23505', message: 'x decision_maker_candidates_lead_dedupe_key' } };
          const made = contact({ ...(row as Partial<DecisionMakerCandidate>), id: `new-${++n}` });
          log.push(`insert:${made.id}:${row.source}:${row.created_by}:primary=${row.is_primary}`);
          rows.push(made);
          return { data: made, error: null };
        },
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (_c: string, id: string) => ({
        select: () => ({
          single: async () => {
            const row = rows.find((r) => r.id === id);
            if (!row) return { data: null, error: { code: 'PGRST116', message: 'none' } };
            Object.assign(row, patch);
            log.push(`update:${id}:${JSON.stringify(patch)}`);
            return { data: { ...row }, error: null };
          },
        }),
      }),
    }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  };
  return { from: () => table } as unknown as Parameters<typeof applyContactSteps>[0]['client'];
}

describe('applyContactSteps', () => {
  it('adds with source dream_agent, then makes the new contact main after clearing the old one', async () => {
    const rows = [contact({ id: 'c-2', first_name: 'Pat', is_primary: true, email: 'pat@acme.com' })];
    const log: string[] = [];
    const steps = planContactSteps([{ index: 0, type: 'add', leadId: 'lead-1', kind: 'person', draft: draft({ first_name: 'Andrea', last_name: 'Manning', email: 'andrea@hok.com', make_primary: true }) }]);
    const res = await applyContactSteps({ client: fakeClient(rows, log), userId: 'u-1', dismiss: async () => null }, steps, { 'lead-1': [...rows] });
    expect(res).toEqual([{ index: 0, ok: true, message: undefined }]);
    expect(log).toEqual([
      'insert:new-1:dream_agent:u-1:primary=false',
      'update:c-2:{"is_primary":false}',
      'update:new-1:{"is_primary":true}',
    ]);
  });

  it('reports a failed row in plain English and still applies the others', async () => {
    const rows: DecisionMakerCandidate[] = [];
    const log: string[] = [];
    const steps = planContactSteps([
      { index: 0, type: 'add', leadId: 'lead-1', kind: 'person', draft: draft({ email: 'dup@hok.com' }) },
      { index: 1, type: 'add', leadId: 'lead-1', kind: 'general', draft: draft({ first_name: '', last_name: '', label: 'Reception', email: 'london@hok.com' }) },
    ]);
    const res = await applyContactSteps({ client: fakeClient(rows, log, 'dup@hok.com'), userId: 'u-1', dismiss: async () => null }, steps, {});
    expect(res[0]).toEqual({ index: 0, ok: false, message: 'That email is already on this lead' });
    expect(res[1].ok).toBe(true);
    expect(log).toEqual(['insert:new-1:dream_agent:u-1:primary=false']);
  });

  it('fails an update whose contact has gone, and writes nothing for an unchanged update', async () => {
    const rows = [contact({ id: 'c-1' })];
    const log: string[] = [];
    const steps = planContactSteps([
      { index: 0, type: 'update', leadId: 'lead-1', contactId: 'gone', kind: 'person', draft: draft() },
      { index: 1, type: 'update', leadId: 'lead-1', contactId: 'c-1', kind: 'person', draft: draft({ first_name: 'Sam', last_name: 'Lee', title: 'Owner', email: 'sam@acme.com' }) },
    ]);
    const res = await applyContactSteps({ client: fakeClient(rows, log), userId: 'u-1', dismiss: async () => null }, steps, { 'lead-1': [...rows] });
    expect(res[0]).toEqual({ index: 0, ok: false, message: 'That contact is no longer on this lead.' });
    expect(res[1].ok).toBe(true);
    expect(log).toEqual([]);
  });

  it('uses dismiss and insert for a provider row whose email changes', async () => {
    const rows = [contact({ id: 'h-1', source: 'hunter', email: 'old@acme.com' })];
    const log: string[] = [];
    const dismissed: string[] = [];
    const steps = planContactSteps([{ index: 0, type: 'update', leadId: 'lead-1', contactId: 'h-1', kind: 'person', draft: draft({ first_name: 'Sam', last_name: 'Lee', title: 'Owner', email: 'new@acme.com' }) }]);
    const res = await applyContactSteps({ client: fakeClient(rows, log), userId: 'u-1', dismiss: async (id) => { dismissed.push(id); return null; } }, steps, { 'lead-1': [...rows] });
    expect(res[0]).toMatchObject({ index: 0, ok: true, message: 'Saved as your own contact so it is not replaced by a new search' });
    expect(dismissed).toEqual(['h-1']);
    expect(log).toEqual(['insert:new-1:dream_agent:u-1:primary=false']);
  });
});
